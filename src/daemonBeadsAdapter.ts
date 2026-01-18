import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
  BoardData,
  BoardColumn,
  BoardCard,
  EnrichedCard,
  FullCard,
  IssueStatus,
  DependencyInfo,
  Comment
} from './types';

/**
 * BeadsAdapter implementation that uses the bd CLI daemon instead of sql.js
 * This eliminates the need for in-memory SQLite and provides better real-time sync
 */
export class DaemonBeadsAdapter {
  private workspaceRoot: string;
  private output: vscode.OutputChannel;
  private lastMutationTime: number = 0;
  private lastInteractionTime: number = 0;

  // Circuit breaker state for batch failure recovery
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures: number = 0;
  private circuitOpenedAt: number = 0;
  private circuitRecoveryTimer: NodeJS.Timeout | null = null;
  private circuitAutoRetryCount: number = 0;
  private readonly CIRCUIT_FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_RESET_TIMEOUT_MS = 60000; // 1 minute
  private readonly MAX_AUTO_RETRIES = 3;

  // Column data cache for pagination optimization
  // WORKAROUND: bd CLI doesn't support --offset, so we cache large result sets
  // and slice them in memory to avoid repeatedly fetching the same data
  private columnDataCache: Map<string, { data: unknown[]; timestamp: number }> = new Map();
  private readonly COLUMN_CACHE_TTL_MS = 30000; // 30 seconds
  private readonly COLUMN_CACHE_MAX_SIZE = 1000; // Max items to cache per column

  constructor(workspaceRoot: string, output: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  /**
   * Sanitize CLI argument to prevent command injection and parsing issues
   * Removes null bytes which can cause command truncation
   *
   * Note: We preserve newlines and whitespace to maintain markdown formatting.
   * This is safe because:
   * 1. We use shell:false when spawning processes (no shell interpretation)
   * 2. We use '--' separators to prevent flag injection
   * 3. We use validateFlagValue() to check for flag injection attempts
   */
  private sanitizeCliArg(arg: string): string {
    if (typeof arg !== 'string') {
      return String(arg);
    }

    // Only remove null bytes - preserve newlines and whitespace for markdown
    return arg.replace(/\0/g, '');
  }

  /**
   * Validates issue ID to prevent command injection
   * @param issueId Issue ID to validate
   * @throws Error if issue ID is invalid or potentially dangerous
   */
  private validateIssueId(issueId: string): void {
    if (typeof issueId !== 'string' || !issueId) {
      throw new Error('Issue ID must be a non-empty string');
    }

    // Prevent flag injection - IDs starting with hyphens could be interpreted as CLI flags
    if (issueId.startsWith('-')) {
      throw new Error(`Invalid issue ID: cannot start with hyphen (${issueId})`);
    }

    // Defense-in-depth: reject whitespace that could enable argument injection
    if (issueId.includes(' ') || issueId.includes('\t') || issueId.includes('\n') || issueId.includes('\r')) {
      throw new Error(`Invalid issue ID: whitespace not allowed (${issueId})`);
    }

    // Validate format: beads-xxxx or project.beads-xxxx
    // This prevents arbitrary strings from being passed to bd commands
    // Allow hyphens and dots in the ID suffix (e.g., beads-kanban-3ae, beads-hct.2)
    // BUT prevent consecutive special characters to avoid argument injection
    const validPattern = /^([a-z0-9]+([._-][a-z0-9]+)*\.)?beads-[a-z0-9]+([._-][a-z0-9]+)*$/i;
    if (!validPattern.test(issueId)) {
      throw new Error(`Invalid issue ID format: ${issueId}. Expected format: beads-xxxx or project.beads-xxxx`);
    }

    // Defense in depth: reject shell metacharacters
    const dangerousChars = /[;&|`$(){}[\]<>\\'"]/;
    if (dangerousChars.test(issueId)) {
      throw new Error(`Invalid issue ID: contains dangerous characters (${issueId})`);
    }
  }

  /**
   * Validates a CLI flag value to prevent flag injection attacks
   * @param value Value to validate
   * @param fieldName Name of the field for error messages
   * @throws Error if value starts with hyphen (could be interpreted as CLI flag)
   */
  private validateFlagValue(value: string | null | undefined, fieldName: string): void {
    if (value && typeof value === 'string' && value.startsWith('-')) {
      throw new Error(`${fieldName} cannot start with hyphen (possible flag injection attempt)`);
    }
  }

  /**
   * Check if the circuit breaker is currently open.
   * Automatically transitions from OPEN to HALF_OPEN after timeout.
   */
  private isCircuitOpen(): boolean {
    if (this.circuitBreakerState === 'CLOSED') {
      return false;
    }

    if (this.circuitBreakerState === 'OPEN') {
      // Check if timeout has elapsed to transition to HALF_OPEN
      const now = Date.now();
      if (now - this.circuitOpenedAt >= this.CIRCUIT_RESET_TIMEOUT_MS) {
        this.circuitBreakerState = 'HALF_OPEN';
        this.output.appendLine('[DaemonBeadsAdapter] Circuit breaker: Transitioning to HALF_OPEN (testing recovery)');
        return false; // Allow the request through
      }
      return true; // Still open, block the request
    }

    // HALF_OPEN state - allow request through to test recovery
    return false;
  }

  /**
   * Record a successful batch operation.
   * Closes the circuit if in HALF_OPEN state, resets failure counter.
   */
  private recordCircuitSuccess(): void {
    if (this.circuitBreakerState === 'HALF_OPEN') {
      this.output.appendLine('[DaemonBeadsAdapter] Circuit breaker: Recovery successful, closing circuit');
      this.circuitBreakerState = 'CLOSED';
      this.cancelCircuitRecovery();
    }
    this.consecutiveFailures = 0;
    this.circuitAutoRetryCount = 0; // Reset retry counter on successful recovery
  }

  /**
   * Record a failed batch operation.
   * Opens the circuit after threshold failures, shows user-friendly error.
   */
  private recordCircuitFailure(): void {
    this.consecutiveFailures++;

    if (this.circuitBreakerState === 'HALF_OPEN') {
      // Failed during recovery test - reopen circuit
      this.circuitBreakerState = 'OPEN';
      this.circuitOpenedAt = Date.now();
      this.output.appendLine('[DaemonBeadsAdapter] Circuit breaker: Recovery test failed, reopening circuit');
      this.scheduleCircuitRecovery();
      return;
    }

    if (this.consecutiveFailures >= this.CIRCUIT_FAILURE_THRESHOLD) {
      this.circuitBreakerState = 'OPEN';
      this.circuitOpenedAt = Date.now();
      this.output.appendLine(`[DaemonBeadsAdapter] Circuit breaker: OPENED after ${this.consecutiveFailures} consecutive failures`);

      // Schedule automatic recovery attempt
      this.scheduleCircuitRecovery();

      // Show user-friendly error with actionable guidance
      vscode.window.showErrorMessage(
        'Beads: Unable to load issues due to repeated errors. The system will retry automatically in 1 minute.',
        'View Logs',
        'Reload Now'
      ).then(action => {
        if (action === 'View Logs') {
          this.output.show();
        } else if (action === 'Reload Now') {
          // Force reset circuit breaker and try again
          this.circuitBreakerState = 'CLOSED';
          this.consecutiveFailures = 0;
          this.cancelCircuitRecovery();
          vscode.commands.executeCommand('beads.refresh');
        }
      });
    }
  }

  /**
   * Schedule automatic circuit recovery attempt after timeout.
   * This ensures the circuit breaker transitions to HALF_OPEN even if no requests come in.
   */
  private scheduleCircuitRecovery(): void {
    // Check if we've exceeded maximum auto-retry attempts
    if (this.circuitAutoRetryCount >= this.MAX_AUTO_RETRIES) {
      this.output.appendLine(`[DaemonBeadsAdapter] Circuit breaker: Max auto-retries (${this.MAX_AUTO_RETRIES}) reached, giving up automatic recovery`);
      vscode.window.showWarningMessage(
        'Beads: Unable to auto-recover from errors. Please check the logs and manually reload when ready.',
        'View Logs',
        'Reload Now'
      ).then(action => {
        if (action === 'View Logs') {
          this.output.show();
        } else if (action === 'Reload Now') {
          // Allow manual reload to bypass retry limit
          this.circuitBreakerState = 'CLOSED';
          this.consecutiveFailures = 0;
          this.circuitAutoRetryCount = 0;
          this.cancelCircuitRecovery();
          vscode.commands.executeCommand('beads.refresh');
        }
      });
      return;
    }

    // Clear any existing timer
    this.cancelCircuitRecovery();

    // Increment retry counter
    this.circuitAutoRetryCount++;

    // Schedule recovery attempt after timeout
    this.circuitRecoveryTimer = setTimeout(() => {
      if (this.circuitBreakerState === 'OPEN') {
        this.output.appendLine(`[DaemonBeadsAdapter] Circuit breaker: Automatic recovery attempt ${this.circuitAutoRetryCount}/${this.MAX_AUTO_RETRIES} triggered`);
        // Trigger a board reload which will check the circuit and transition to HALF_OPEN
        vscode.commands.executeCommand('beads.refresh');
      }
    }, this.CIRCUIT_RESET_TIMEOUT_MS);

    this.output.appendLine(`[DaemonBeadsAdapter] Circuit breaker: Scheduled automatic recovery ${this.circuitAutoRetryCount}/${this.MAX_AUTO_RETRIES} in ${this.CIRCUIT_RESET_TIMEOUT_MS / 1000}s`);
  }

  /**
   * Cancel any pending circuit recovery timer.
   */
  private cancelCircuitRecovery(): void {
    if (this.circuitRecoveryTimer) {
      clearTimeout(this.circuitRecoveryTimer);
      this.circuitRecoveryTimer = null;
    }
  }

  /**
   * Execute a bd CLI command and return parsed JSON output
   * @param args Command arguments to pass to bd (will be sanitized)
   * @param timeoutMs Timeout in milliseconds (default: 30000ms = 30s)
   */
  private async execBd(args: string[], timeoutMs: number = 30000): Promise<unknown> {
    // Sanitize all arguments before passing to CLI
    const sanitizedArgs = args.map(arg => this.sanitizeCliArg(arg));
    return new Promise((resolve, reject) => {
      const command = `bd ${sanitizedArgs.join(' ')}`;
      const child = spawn('bd', sanitizedArgs, {
        cwd: this.workspaceRoot,
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      // Buffer size limit: 50MB to handle large bd list queries
      // Note: bd list --limit 10000 can produce ~8-12MB of JSON output
      // With default initialLoadLimit of 100, we use ~100KB
      const MAX_BUFFER_SIZE = 50 * 1024 * 1024;

      // Set up timeout
      const timeoutHandle = setTimeout(() => {
        if (!killed) {
          killed = true;
          child.kill('SIGTERM');
          this.output.appendLine(`[DaemonBeadsAdapter] Command timed out after ${timeoutMs}ms: ${command}`);
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
        }
      }, timeoutMs);

      child.stdout.on('data', (data) => {
        // Check buffer size limit BEFORE concatenation to prevent memory spikes
        // If data arrives in large chunks (e.g., 15MB), checking after would temporarily exceed limit
        const dataStr = data.toString();
        if (stdout.length + dataStr.length > MAX_BUFFER_SIZE) {
          if (!killed) {
            killed = true;
            clearTimeout(timeoutHandle);
            child.kill('SIGTERM');
            this.output.appendLine(`[DaemonBeadsAdapter] Command exceeded buffer limit (${MAX_BUFFER_SIZE} bytes): ${command}`);
            reject(new Error(`Command output exceeded ${MAX_BUFFER_SIZE} bytes limit`));
          }
          return; // Don't append the data
        }
        stdout += dataStr;
      });

      child.stderr.on('data', (data) => {
        // Check buffer size limit BEFORE concatenation to prevent memory spikes
        const dataStr = data.toString();
        if (stderr.length + dataStr.length > MAX_BUFFER_SIZE) {
          if (!killed) {
            killed = true;
            clearTimeout(timeoutHandle);
            child.kill('SIGTERM');
            this.output.appendLine(`[DaemonBeadsAdapter] Command error output exceeded buffer limit: ${command}`);
            reject(new Error(`Command error output exceeded ${MAX_BUFFER_SIZE} bytes limit`));
          }
          return; // Don't append the data
        }
        stderr += dataStr;
      });

      child.on('error', (error) => {
        if (!killed) {
          clearTimeout(timeoutHandle);
          this.output.appendLine(`[DaemonBeadsAdapter] Command error: ${error.message}`);
          this.output.appendLine(`[DaemonBeadsAdapter] Command context: ${command} (cwd: ${this.workspaceRoot})`);
          this.output.appendLine(`[DaemonBeadsAdapter] PATH: ${process.env.PATH ?? ''}`);
          this.output.appendLine(`[DaemonBeadsAdapter] PATHEXT: ${process.env.PATHEXT ?? ''}`);
          reject(error);
        }
      });

      child.on('close', (code) => {
        if (!killed) {
          clearTimeout(timeoutHandle);

          if (code === 0) {
            const trimmed = stdout.trim();
            if (!trimmed) {
              // No output - success for mutation commands
              resolve(null);
              return;
            }

            try {
              // Try parsing as JSON (for query commands like list/show)
              const result = JSON.parse(trimmed);
              resolve(result);
            } catch {
              // Not JSON - likely a friendly message from mutation commands
              // This is fine, just return null to indicate success
              this.output.appendLine(`[DaemonBeadsAdapter] Non-JSON output: ${trimmed}`);
              resolve(null);
            }
          } else {
            this.output.appendLine(`[DaemonBeadsAdapter] Command context: ${command} (cwd: ${this.workspaceRoot})`);
            this.output.appendLine(`[DaemonBeadsAdapter] Command failed (exit ${code}): ${stderr || stdout}`);
            reject(new Error(`bd command failed with exit code ${code}: ${stderr || stdout}`));
          }
        }
      });
    });
  }

  /**
   * Ensure the daemon is connected and workspace is initialized
   */
  public async ensureConnected(): Promise<void> {
    try {
      // Check daemon status using 'bd info --json'
      const info = await this.execBd(['info', '--json']) as { daemon_connected?: boolean; daemon_status?: string } | null;

      if (!info || !info.daemon_connected) {
        throw new Error('Beads daemon is not running. Please start the daemon with: bd daemons start');
      }

      if (info.daemon_status !== 'healthy') {
        this.output.appendLine(`[DaemonBeadsAdapter] Warning: Daemon status is ${info.daemon_status}`);
      }

      this.output.appendLine('[DaemonBeadsAdapter] Connected to beads daemon successfully');
    } catch (error) {
      const msg = `Failed to connect to beads daemon: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Get the workspace root path
   */
  public getConnectedDbPath(): string | null {
    return this.workspaceRoot;
  }

  /**
   * Reload database (no-op for daemon adapter, always reads from daemon)
   */
  public async reloadDatabase(): Promise<void> {
    // Database reload - daemon automatically provides fresh data
    this.output.appendLine('[DaemonBeadsAdapter] Database reload requested');
  }

  /**
   * Track that a mutation occurred and invalidate cache
   */
  private trackMutation(): void {
    this.lastMutationTime = Date.now();
    // Invalidate column data cache on mutation
    this.columnDataCache.clear();
  }

  /**
   * Track that an interaction (read or write) occurred that might touch the DB file
   */
  private trackInteraction(): void {
    this.lastInteractionTime = Date.now();
  }

  /**
   * Check if we recently modified or interacted with the DB
   * This is used to suppress file watcher loops
   */
  public isRecentSelfSave(): boolean {
    // Consider a mutation/interaction "recent" if it happened within the last 5 seconds
    const now = Date.now();
    const mutationDiff = now - this.lastMutationTime;
    const interactionDiff = now - this.lastInteractionTime;
    
    const isRecent = (mutationDiff < 5000) || (interactionDiff < 5000);
    
    if (isRecent) {
       this.output.appendLine(`[DaemonBeadsAdapter] isRecentSelfSave: TRUE (mutation: ${mutationDiff}ms, interaction: ${interactionDiff}ms)`);
    }
    
    return isRecent;
  }

  /**
   * Get board data from bd daemon
   */
  public async getBoard(): Promise<BoardData> {
    this.trackInteraction();
    // Load fresh data from daemon

    // Read pagination limit from configuration
    const maxIssues = vscode.workspace.getConfiguration('beadsKanban').get<number>('maxIssues', 1000);

    try {
      // Step 1: Get limited issues (basic data)
      // Request maxIssues + 1 to detect if there are more
      const basicIssues = await this.execBd(['list', '--json', '--all', '--limit', String(maxIssues + 1)]);
      
      if (!Array.isArray(basicIssues) || basicIssues.length === 0) {
        // Return empty board if no issues
        const emptyBoard: BoardData = {
          columns: [
            { key: 'ready', title: 'Ready' },
            { key: 'in_progress', title: 'In Progress' },
            { key: 'blocked', title: 'Blocked' },
            { key: 'closed', title: 'Closed' }
          ],
          cards: []
        };
        return emptyBoard;
      }

      // Check if we hit the pagination limit
      const hasMoreIssues = basicIssues.length > maxIssues;
      if (hasMoreIssues) {
        // Trim to the actual limit
        basicIssues.length = maxIssues;
        this.output.appendLine(`[DaemonBeadsAdapter] Loaded ${maxIssues} issues (more available). Increase beadsKanban.maxIssues setting to show more.`);
        vscode.window.showInformationMessage(
          `Beads Kanban: Showing ${maxIssues} most recent issues. Increase the maxIssues setting to show more.`,
          'Open Settings'
        ).then(action => {
          if (action === 'Open Settings') {
            vscode.commands.executeCommand('workbench.action.openSettings', 'beadsKanban.maxIssues');
          }
        });
      }

      // Step 2: Get full details for all issues (includes dependents/relationships)
      // Batch the requests to avoid command-line length overflow on Windows (~8191 chars)
      const issueIds = basicIssues.map((issue: unknown) => (issue as { id: string }).id);
      const BATCH_SIZE = 50; // Conservative batch size to stay well under CLI limits
      const detailedIssues: unknown[] = [];

      for (let i = 0; i < issueIds.length; i += BATCH_SIZE) {
        const batch = issueIds.slice(i, i + BATCH_SIZE);
        
        try {
          const batchResults = await this.execBd(['show', '--json', ...batch]);

          if (!Array.isArray(batchResults)) {
            throw new Error('Expected array from bd show --json <ids>');
          }

          detailedIssues.push(...batchResults);
          
          // Record successful batch
          this.recordCircuitSuccess();
        } catch (error) {
          // Check circuit breaker before retrying
          if (this.isCircuitOpen()) {
            this.recordCircuitFailure();
            throw new Error('Circuit breaker is open - too many consecutive failures. System will retry automatically in 1 minute.');
          }

          // If batch fails (likely due to missing/invalid ID), try each issue individually
          // Use parallel execution to avoid N+1 sequential query problem (50 issues: 50ms vs 2500ms)
          this.output.appendLine(`[DaemonBeadsAdapter] Batch show failed, retrying ${batch.length} issues in parallel: ${error instanceof Error ? error.message : String(error)}`);

          const individualResults = await Promise.allSettled(
            batch.map(id => this.execBd(['show', '--json', id]))
          );

          let batchFailureCount = 0;
          for (const result of individualResults) {
            if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
              detailedIssues.push(...result.value);
            } else {
              batchFailureCount++;
              // Skip this issue - it may have been deleted or is invalid
              if (result.status === 'rejected') {
                this.output.appendLine(`[DaemonBeadsAdapter] Skipping missing issue: ${result.reason}`);
              }
            }
          }

          // Record batch result based on failure rate
          if (batchFailureCount === batch.length) {
            // Entire batch failed - record as circuit failure
            this.recordCircuitFailure();
          } else if (batchFailureCount > 0) {
            // Partial failure - don't count as full failure
            this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
          } else {
            // All succeeded on retry - record success
            this.recordCircuitSuccess();
          }
        }
      }

      const boardData = this.mapIssuesToBoardData(detailedIssues);
      
      return boardData;
    } catch (error) {
      throw new Error(`Failed to get board data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * NEW: Get minimal board data for fast initial load (Tier 1)
   * Uses single bd list query without bd show - expected 100-300ms for 400 issues
   * Returns only essential fields for displaying cards in kanban columns
   */
  /**
   * Get minimal board data for fast initial load
   * @param limit Maximum number of issues to load (default: 5000 to stay under 10MB buffer)
   */
  public async getBoardMinimal(limit: number = 5000): Promise<EnrichedCard[]> {
    try {
      this.trackInteraction();
      // Single fast query - no batching needed
      // Note: Default limit of 5000 keeps us safely under the 10MB buffer limit
      // Callers should pass config.initialLoadLimit to honor user preferences
      const issues = await this.execBd(['list', '--json', '--all', '--limit', limit.toString()]);

      if (!Array.isArray(issues)) {
        this.output.appendLine('[DaemonBeadsAdapter] getBoardMinimal: bd list returned non-array');
        return [];
      }

      // Map to EnrichedCard - includes labels, assignee for better card display
      const enrichedCards: EnrichedCard[] = issues.map((issue: unknown) => {
        const i = issue as Record<string, unknown>;
        return {
          id: i.id as string,
          title: (i.title as string) || '',
          description: (i.description as string) || '',
          status: (i.status as IssueStatus) || 'open',
          priority: typeof i.priority === 'number' ? i.priority : 2,
          issue_type: (i.issue_type as string) || 'task',
          created_at: (i.created_at as string) || new Date().toISOString(),
          created_by: (i.created_by as string) || 'unknown',
          updated_at: (i.updated_at as string) || (i.created_at as string) || new Date().toISOString(),
          closed_at: (i.closed_at as string | null) || null,
          close_reason: (i.close_reason as string | null) || null,
          dependency_count: (i.dependency_count as number) || 0,
          dependent_count: (i.dependent_count as number) || 0,
          assignee: (i.assignee as string | null) || null,
          estimated_minutes: (i.estimated_minutes as number | null) || null,
          labels: Array.isArray(i.labels) ? i.labels as string[] : [],
          external_ref: (i.external_ref as string | null) || null,
          pinned: (i.pinned as boolean) || false,
          blocked_by_count: (i.blocked_by_count as number) || 0,
          is_ready: i.status === 'open' && ((i.blocked_by_count as number) || 0) === 0
        };
      });

      this.output.appendLine(`[DaemonBeadsAdapter] getBoardMinimal: Loaded ${enrichedCards.length} enriched cards`);
      return enrichedCards;
    } catch (error) {
      throw new Error(`Failed to get minimal board data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * NEW: Get full details for a single issue on-demand (Tier 3)
   * Uses single bd show query - expected 50ms per issue
   * Returns all fields including relationships, comments, and event/agent metadata
   */
  public async getIssueFull(issueId: string): Promise<FullCard> {
    try {
      this.validateIssueId(issueId);
      this.trackInteraction();

      // Single fast query for one issue
      let result;
      try {
        result = await this.execBd(['show', '--json', issueId]);
      } catch (error) {
        // bd returns error for non-existent issues - normalize to consistent error message
        if (error instanceof Error && error.message.includes('no issue found')) {
          throw new Error(`Issue not found: ${issueId}`);
        }
        throw error;
      }

      if (!Array.isArray(result) || result.length === 0) {
        throw new Error(`Issue not found: ${issueId}`);
      }

      const issue = result[0] as Record<string, unknown>;

      // Build dependency information
      const parent = this.extractParentDependency(issue);
      const children = this.extractChildrenDependencies(issue);
      const blocks = this.extractBlocksDependencies(issue);
      const blocked_by = this.extractBlockedByDependencies();

      // Map labels
      let labels: string[] = [];
      if (issue.labels && Array.isArray(issue.labels)) {
        labels = issue.labels.map((l: unknown) => typeof l === 'string' ? l : (l as { label: string }).label);
      }

      // Map comments
      const comments: Comment[] = [];
      if (issue.comments && Array.isArray(issue.comments)) {
        comments.push(...issue.comments.map((c: unknown) => {
          const comment = c as Record<string, unknown>;
          return {
            id: typeof comment.id === 'string' ? parseInt(comment.id, 10) : (comment.id as number),
            issue_id: issueId,
            author: (comment.author as string) || 'unknown',
            text: (comment.text as string) || '',
            created_at: comment.created_at as string
          };
        }));
      }

      const fullCard: FullCard = {
        // MinimalCard fields
        id: issue.id as string,
        title: (issue.title as string) || '',
        description: (issue.description as string) || '',
        status: (issue.status as string) || 'open',
        priority: typeof issue.priority === 'number' ? issue.priority : 2,
        issue_type: (issue.issue_type as string) || 'task',
        created_at: (issue.created_at as string) || new Date().toISOString(),
        created_by: (issue.created_by as string) || 'unknown',
        updated_at: (issue.updated_at as string) || (issue.created_at as string) || new Date().toISOString(),
        closed_at: (issue.closed_at as string | null) || null,
        close_reason: (issue.close_reason as string | null) || null,
        dependency_count: (issue.dependency_count as number) || 0,
        dependent_count: (issue.dependent_count as number) || 0,

        // EnrichedCard fields
        assignee: (issue.assignee as string | null) || null,
        estimated_minutes: (issue.estimated_minutes as number | null) || null,
        labels,
        external_ref: (issue.external_ref as string | null) || null,
        pinned: issue.pinned === 1 || issue.pinned === true,
        blocked_by_count: blocked_by.length,

        // FullCard fields
        acceptance_criteria: (issue.acceptance_criteria as string) || '',
        design: (issue.design as string) || '',
        notes: (issue.notes as string) || '',
        due_at: (issue.due_at as string | null) || null,
        defer_until: (issue.defer_until as string | null) || null,
        is_ready: issue.status === 'open' && blocked_by.length === 0,
        is_template: issue.is_template === 1 || issue.is_template === true,
        ephemeral: issue.ephemeral === 1 || issue.ephemeral === true,

        // Event/Agent metadata
        event_kind: (issue.event_kind as string | null) || null,
        actor: (issue.actor as string | null) || null,
        target: (issue.target as string | null) || null,
        payload: (issue.payload as string | null) || null,
        sender: (issue.sender as string | null) || null,
        mol_type: (issue.mol_type as string | null) || null,
        role_type: (issue.role_type as string | null) || null,
        rig: (issue.rig as string | null) || null,
        agent_state: (issue.agent_state as string | null) || null,
        last_activity: (issue.last_activity as string | null) || null,
        hook_bead: (issue.hook_bead as string | null) || null,
        role_bead: (issue.role_bead as string | null) || null,
        await_type: (issue.await_type as string | null) || null,
        await_id: (issue.await_id as string | null) || null,
        timeout_ns: (issue.timeout_ns as number | null) || null,
        waiters: (issue.waiters as string | null) || null,

        // Relationships
        parent,
        children,
        blocks,
        blocked_by,
        comments
      };

      this.output.appendLine(`[DaemonBeadsAdapter] getIssueFull: Loaded full details for ${issueId}`);
      return fullCard;
    } catch (error) {
      throw new Error(`Failed to get full issue details: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract parent dependency from issue data
   */
  private extractParentDependency(issue: Record<string, unknown>): DependencyInfo | undefined {
    if (!issue.dependents || !Array.isArray(issue.dependents)) {
      return undefined;
    }

    // Find parent-child dependency where this issue is the child
    for (const d of issue.dependents) {
      const dep = d as Record<string, unknown>;
      if (dep.dependency_type === 'parent-child' && dep.id !== issue.id) {
        return {
          id: dep.id as string,
          title: dep.title as string,
          created_at: dep.created_at as string,
          created_by: (dep.created_by as string) || 'unknown',
          metadata: dep.metadata as string | undefined,
          thread_id: dep.thread_id as string | undefined
        };
      }
    }

    return undefined;
  }

  /**
   * Extract children dependencies from issue data
   */
  private extractChildrenDependencies(issue: Record<string, unknown>): DependencyInfo[] {
    const children: DependencyInfo[] = [];

    if (!issue.dependents || !Array.isArray(issue.dependents)) {
      return children;
    }

    for (const d of issue.dependents) {
      const dep = d as Record<string, unknown>;
      if (dep.dependency_type === 'parent-child' && dep.id !== issue.id) {
        children.push({
          id: dep.id as string,
          title: dep.title as string,
          created_at: dep.created_at as string,
          created_by: (dep.created_by as string) || 'unknown',
          metadata: dep.metadata as string | undefined,
          thread_id: dep.thread_id as string | undefined
        });
      }
    }

    return children;
  }

  /**
   * Extract blocks dependencies from issue data
   */
  private extractBlocksDependencies(issue: Record<string, unknown>): DependencyInfo[] {
    const blocks: DependencyInfo[] = [];

    if (!issue.dependents || !Array.isArray(issue.dependents)) {
      return blocks;
    }

    for (const d of issue.dependents) {
      const dep = d as Record<string, unknown>;
      if (dep.dependency_type === 'blocks' && dep.id !== issue.id) {
        blocks.push({
          id: dep.id as string,
          title: dep.title as string,
          created_at: dep.created_at as string,
          created_by: (dep.created_by as string) || 'unknown',
          metadata: dep.metadata as string | undefined,
          thread_id: dep.thread_id as string | undefined
        });
      }
    }

    return blocks;
  }

  /**
   * Extract blocked_by dependencies from issue data
   */
  private extractBlockedByDependencies(): DependencyInfo[] {
    // Note: bd show returns "dependents" which are issues that depend on THIS issue
    // To get blocked_by, we need to look at dependencies where this issue is blocked
    // This information might not be in the response, so we return empty for now
    // TODO: Check if bd show provides this information
    return [];
  }

  /**
   * Get board metadata (columns only, no cards) for incremental loading
   */
  public async getBoardMetadata(): Promise<BoardData> {
    const columns: BoardColumn[] = [
      { key: 'ready', title: 'Ready' },
      { key: 'in_progress', title: 'In Progress' },
      { key: 'blocked', title: 'Blocked' },
      { key: 'closed', title: 'Closed' }
    ];

    // Return only columns, no cards - cards will be loaded via getColumnData
    return { columns, cards: [] };
  }

  /**
   * Get comments for a specific issue (lazy-loaded on demand).
   * This method is called when the user opens the detail dialog for an issue.
   */
  public async getIssueComments(issueId: string): Promise<Comment[]> {
    try {
      this.validateIssueId(issueId);
      this.trackInteraction();
      // Fetch full issue details including comments
      const result = await this.execBd(['show', '--json', issueId]);

      if (!Array.isArray(result) || result.length === 0) {
        return [];
      }

      const issue = result[0] as Record<string, unknown>;

      // Extract and map comments
      if (issue.comments && Array.isArray(issue.comments)) {
        return issue.comments.map((c: unknown) => {
          const comment = c as Record<string, unknown>;
          return {
            id: typeof comment.id === 'string' ? parseInt(comment.id, 10) : (comment.id as number),
            issue_id: issueId,
            author: (comment.author as string) || 'unknown',
            text: (comment.text as string) || '',
            created_at: comment.created_at as string
          };
        });
      }

      return [];
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] Failed to get comments for ${issueId}: ${error}`);
      return [];
    }
  }

  /**
   * Get the count of issues in a specific column.
   * Uses bd stats for O(1) performance instead of loading all issues.
   */
  public async getColumnCount(column: string): Promise<number> {
    try {
      this.trackInteraction();
      // Use bd stats --json for instant counts (no issue loading required)
      const statsResult = await this.execBd(['stats', '--json']);
      const stats = statsResult as { summary?: { ready_issues?: number; in_progress_issues?: number; blocked_issues?: number; closed_issues?: number; open_issues?: number } } | null;

      if (!stats || !stats.summary) {
        this.output.appendLine('[DaemonBeadsAdapter] bd stats returned invalid data, falling back to list queries');
        return this.getColumnCountFallback(column);
      }

      const summary = stats.summary;

      switch (column) {
        case 'ready':
          return summary.ready_issues || 0;

        case 'in_progress':
          return summary.in_progress_issues || 0;

        case 'blocked':
          return summary.blocked_issues || 0;

        case 'closed':
          return summary.closed_issues || 0;

        case 'open':
          return summary.open_issues || 0;

        default:
          throw new Error(`Unknown column: ${column}`);
      }
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] bd stats failed: ${error}, falling back to list queries`);
      return this.getColumnCountFallback(column);
    }
  }

  /**
   * Fallback method for getColumnCount when bd stats is unavailable
   * (for older bd versions or when stats fails)
   */
  private async getColumnCountFallback(column: string): Promise<number> {
    try {
      let result: unknown;

      switch (column) {
        case 'ready':
          result = await this.execBd(['ready', '--json', '--limit', '0']);
          break;

        case 'in_progress':
          result = await this.execBd(['list', '--status=in_progress', '--json', '--limit', '0']);
          break;

        case 'blocked':
          result = await this.execBd(['list', '--status=blocked', '--json', '--limit', '0']);
          break;

        case 'closed':
          result = await this.execBd(['list', '--status=closed', '--json', '--limit', '0']);
          break;

        case 'open':
          result = await this.execBd(['list', '--status=open', '--json', '--limit', '0']);
          break;

        default:
          throw new Error(`Unknown column: ${column}`);
      }

      return Array.isArray(result) ? result.length : 0;
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] Failed to get column count for ${column}: ${error}`);
      return 0;
    }
  }

  /**
   * Get paginated issues for a specific column.
   * Returns BoardCard[] matching the same format as getBoard().
   * OPTIMIZATION: Uses column-level caching to avoid repeated fetches for pagination.
   */
  public async getColumnData(
    column: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<BoardCard[]> {
    try {
      this.trackInteraction();

      // Check if we have valid cached data that covers this range
      const cached = this.columnDataCache.get(column);
      const now = Date.now();

      if (cached &&
          now - cached.timestamp < this.COLUMN_CACHE_TTL_MS &&
          cached.data.length >= offset + limit) {
        // Cache hit - slice from cached data
        this.output.appendLine(`[DaemonBeadsAdapter] Cache hit for ${column} (offset=${offset}, limit=${limit})`);
        const basicIssues = cached.data.slice(offset, offset + limit);

        if (basicIssues.length === 0) {
          return [];
        }
        // Skip to enrichment step below (after the switch statement)
        return this.enrichColumnIssues(basicIssues);
      }

      // Cache miss - fetch data
      // Strategy: Fetch a larger chunk (up to COLUMN_CACHE_MAX_SIZE) to serve future pagination requests
      // This turns O(N*M) performance (where N=pages, M=page number) into O(1) for cached pages
      const fetchLimit = Math.min(
        Math.max(offset + limit, this.COLUMN_CACHE_MAX_SIZE),
        this.COLUMN_CACHE_MAX_SIZE
      );

      this.output.appendLine(`[DaemonBeadsAdapter] Cache miss for ${column}, fetching ${fetchLimit} items (offset=${offset}, limit=${limit})`);

      let basicIssues: unknown[];

      switch (column) {
        case 'ready': {
          // Use bd ready - it returns issues with no blockers
          // WORKAROUND: bd ready doesn't support --offset, so we fetch a large chunk and cache it
          // This eliminates the O(N) performance issue for subsequent page requests
          const readyResult = await this.execBd(['ready', '--json', '--limit', String(fetchLimit)]);
          basicIssues = Array.isArray(readyResult) ? readyResult : [];
          break;
        }

        case 'in_progress': {
          // Use bd list with status filter
          const inProgressResult = await this.execBd(['list', '--status=in_progress', '--json', '--limit', String(fetchLimit)]);
          basicIssues = Array.isArray(inProgressResult) ? inProgressResult : [];
          break;
        }

        case 'blocked': {
          // Use bd list --status=blocked for efficient pagination
          const blockedResult = await this.execBd(['list', '--status=blocked', '--json', '--limit', String(fetchLimit)]);
          basicIssues = Array.isArray(blockedResult) ? blockedResult : [];
          break;
        }

        case 'closed': {
          // Use bd list with status filter (supports --limit)
          const closedResult = await this.execBd(['list', '--status=closed', '--json', '--limit', String(fetchLimit)]);
          basicIssues = Array.isArray(closedResult) ? closedResult : [];
          break;
        }

        case 'open': {
          // Use bd list with status filter (supports --limit)
          const openResult = await this.execBd(['list', '--status=open', '--json', '--limit', String(fetchLimit)]);
          basicIssues = Array.isArray(openResult) ? openResult : [];
          break;
        }

        default:
          throw new Error(`Unknown column: ${column}`);
      }

      // Cache the fetched data for future requests
      this.columnDataCache.set(column, {
        data: basicIssues,
        timestamp: now
      });

      // Slice to get the requested page
      const pageData = basicIssues.slice(offset, offset + limit);

      if (pageData.length === 0) {
        return [];
      }

      // Enrich the page data with full issue details
      return this.enrichColumnIssues(pageData);
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] Failed to get column data for ${column}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /**
   * Helper method to enrich basic issue data with full details.
   * Used by getColumnData to fetch complete issue information.
   */
  private async enrichColumnIssues(basicIssues: unknown[]): Promise<BoardCard[]> {
    // Step 2: Get full details for all issues using bd show (in batches)
    const issueIds = basicIssues.map((issue: unknown) => (issue as { id: string }).id);
    const BATCH_SIZE = 50;
    const detailedIssues: unknown[] = [];

    for (let i = 0; i < issueIds.length; i += BATCH_SIZE) {
      const batch = issueIds.slice(i, i + BATCH_SIZE);

      try {
        const batchResults = await this.execBd(['show', '--json', ...batch]);

        if (!Array.isArray(batchResults)) {
          throw new Error('Expected array from bd show --json <ids>');
        }

        detailedIssues.push(...batchResults);

        // Record successful batch
        this.recordCircuitSuccess();
      } catch (error) {
        // Check circuit breaker before retrying
        if (this.isCircuitOpen()) {
          this.recordCircuitFailure();
          throw new Error('Circuit breaker is open - too many consecutive failures. System will retry automatically in 1 minute.');
        }

        // If batch fails, try each issue individually
        // Use parallel execution to avoid N+1 sequential query problem (50 issues: 50ms vs 2500ms)
        this.output.appendLine(`[DaemonBeadsAdapter] Batch show failed, retrying ${batch.length} issues in parallel: ${error instanceof Error ? error.message : String(error)}`);

        const individualResults = await Promise.allSettled(
          batch.map(id => this.execBd(['show', '--json', id]))
        );

        let batchFailureCount = 0;
        for (const result of individualResults) {
          if (result.status === 'fulfilled' && Array.isArray(result.value) && result.value.length > 0) {
            detailedIssues.push(...result.value);
          } else {
            batchFailureCount++;
            // Skip this issue - it may have been deleted or is invalid
            if (result.status === 'rejected') {
              this.output.appendLine(`[DaemonBeadsAdapter] Skipping missing issue: ${result.reason}`);
            }
          }
        }

        // Record batch result based on failure rate
        if (batchFailureCount === batch.length) {
          // Entire batch failed - record as circuit failure
          this.recordCircuitFailure();
        } else if (batchFailureCount > 0) {
          // Partial failure - don't count as full failure
          this.consecutiveFailures = Math.max(0, this.consecutiveFailures - 1);
        } else {
          // All succeeded on retry - record success
          this.recordCircuitSuccess();
        }
      }
    }

    // Map to BoardCard format using existing helper
    const boardData = this.mapIssuesToBoardData(detailedIssues);
    return boardData.cards || [];
  }

    /**
     * Get paginated table data with server-side filtering and sorting.
     * For daemon adapter, we fetch and filter in memory but on the server side.
     * 
     * @param filters Object containing filter criteria
     * @param sorting Array of { id: string, dir: 'asc'|'desc' } for sorting
     * @param offset Starting row index (0-based)
     * @param limit Number of rows to return
     * @returns Object containing filtered/sorted cards and total count
     */
    public async getTableData(
        filters: {
            search?: string;
            priority?: string;
            type?: string;
            status?: string;
            assignee?: string;
            labels?: string[];
        },
        sorting: Array<{ id: string; dir: 'asc' | 'desc' }>,
        offset: number,
        limit: number
    ): Promise<{ cards: BoardCard[]; totalCount: number }> {
        await this.ensureConnected();
        this.trackInteraction();

        this.output.appendLine(`[DaemonBeadsAdapter] getTableData: offset=${offset}, limit=${limit}, filters=${JSON.stringify(filters)}, sorting=${JSON.stringify(sorting)}`);

        // Get all issues from board (uses cache if available)
        const board = await this.getBoard();
        let allCards = board.cards || [];

        this.output.appendLine(`[DaemonBeadsAdapter] Fetched ${allCards.length} total cards from board`);

        // Apply filters
        if (filters.search || filters.priority || filters.type || filters.status || filters.assignee || filters.labels) {
            allCards = allCards.filter(card => {
                // Search filter
                if (filters.search) {
                    const searchLower = filters.search.toLowerCase();
                    const matchesSearch = 
                        card.title.toLowerCase().includes(searchLower) ||
                        card.id.toLowerCase().includes(searchLower) ||
                        (card.description && card.description.toLowerCase().includes(searchLower));
                    if (!matchesSearch) {return false;}
                }

                // Priority filter
                if (filters.priority && String(card.priority) !== filters.priority) {
                    return false;
                }

                // Type filter
                if (filters.type && card.issue_type !== filters.type) {
                    return false;
                }

                // Status filter
                if (filters.status) {
                    if (filters.status === 'not_closed') {
                        if (card.status === 'closed') {return false;}
                    } else if (filters.status === 'active') {
                        if (card.status !== 'in_progress' && card.status !== 'open') {return false;}
                    } else if (filters.status === 'blocked') {
                        if (card.status !== 'blocked') {return false;}
                    } else if (filters.status !== 'all') {
                        if (card.status !== filters.status) {return false;}
                    }
                }

                // Assignee filter
                if (filters.assignee) {
                    if (filters.assignee === 'unassigned') {
                        if (card.assignee) {return false;}
                    } else {
                        if (card.assignee !== filters.assignee) {return false;}
                    }
                }

                // Labels filter (must have ALL specified labels)
                if (filters.labels && filters.labels.length > 0) {
                    if (!card.labels || card.labels.length === 0) {return false;}
                    const hasAllLabels = filters.labels.every(label => 
                        card.labels.includes(label)
                    );
                    if (!hasAllLabels) {return false;}
                }

                return true;
            });

            this.output.appendLine(`[DaemonBeadsAdapter] After filtering: ${allCards.length} cards`);
        }

        // Apply sorting
        if (sorting && sorting.length > 0) {
            allCards.sort((a, b) => {
                for (const sortSpec of sorting) {
                    let cmp = 0;
                    
                    switch (sortSpec.id) {
                        case 'id':
                            cmp = a.id.localeCompare(b.id);
                            break;
                        case 'title':
                            cmp = a.title.localeCompare(b.title);
                            break;
                        case 'status':
                            cmp = a.status.localeCompare(b.status);
                            break;
                        case 'priority':
                            cmp = a.priority - b.priority;
                            break;
                        case 'type':
                            cmp = a.issue_type.localeCompare(b.issue_type);
                            break;
                        case 'assignee': {
                            const aAssignee = a.assignee || '';
                            const bAssignee = b.assignee || '';
                            cmp = aAssignee.localeCompare(bAssignee);
                            break;
                        }
                        case 'created': {
                            const aCreated = new Date(a.created_at).getTime();
                            const bCreated = new Date(b.created_at).getTime();
                            cmp = aCreated - bCreated;
                            break;
                        }
                        case 'updated': {
                            const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                            const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                            cmp = aUpdated - bUpdated;
                            break;
                        }
                        case 'closed': {
                            const aClosed = a.closed_at ? new Date(a.closed_at).getTime() : 0;
                            const bClosed = b.closed_at ? new Date(b.closed_at).getTime() : 0;
                            cmp = aClosed - bClosed;
                            break;
                        }
                        default: {
                            // Fallback to updated_at
                            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                            cmp = aTime - bTime;
                        }
                    }

                    if (cmp !== 0) {
                        return sortSpec.dir === 'desc' ? -cmp : cmp;
                    }
                }

                // Fallback: sort by updated_at desc
                const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                return bTime - aTime;
            });
        } else {
            // Default sort: updated_at desc
            allCards.sort((a, b) => {
                const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                return bTime - aTime;
            });
        }

        const totalCount = allCards.length;

        // Apply pagination
        const paginatedCards = allCards.slice(offset, offset + limit);

        this.output.appendLine(`[DaemonBeadsAdapter] Returning ${paginatedCards.length} cards (page ${Math.floor(offset / limit) + 1}, total: ${totalCount})`);

        return { cards: paginatedCards, totalCount };
    }

  /**
   * Map daemon issue data to BoardData format
   * This implements the data mapping task (beads-nm3)
   */
  private mapIssuesToBoardData(issues: unknown[]): BoardData {
    const cards: BoardCard[] = [];
    
    // Build dependency maps from dependents structure
    // Note: bd show returns "dependents" which are issues that depend on THIS issue
    const parentMap = new Map<string, DependencyInfo>(); // Maps child_id -> parent_info
    const childrenMap = new Map<string, DependencyInfo[]>(); // Maps parent_id -> children_info[]
    const blockedByMap = new Map<string, DependencyInfo[]>(); // Maps issue_id -> blocker_info[]
    const blocksMap = new Map<string, DependencyInfo[]>(); // Maps blocker_id -> blocked_info[]

    // First pass: build dependency maps
    for (const i of issues) {
      const issue = i as Record<string, unknown>;
      if (issue.dependents && Array.isArray(issue.dependents)) {
        for (const d of issue.dependents) {
          const dependent = d as Record<string, unknown>;
          const dependentInfo: DependencyInfo = {
            id: dependent.id as string,
            title: dependent.title as string,
            created_at: dependent.created_at as string,
            created_by: (dependent.created_by as string) || 'unknown',
            metadata: dependent.metadata as string | undefined,
            thread_id: dependent.thread_id as string | undefined
          };

          if (dependent.dependency_type === 'parent-child') {
            // This issue (issue) is the PARENT
            // The dependent is the CHILD
            // So: child.parent = this issue, and this issue.children includes child

            parentMap.set(dependent.id as string, {
              id: issue.id as string,
              title: issue.title as string,
              created_at: issue.created_at as string,
              created_by: (issue.created_by as string) || 'unknown',
              metadata: issue.metadata as string | undefined,
              thread_id: issue.thread_id as string | undefined
            });

            const siblings = childrenMap.get(issue.id as string) || [];
            siblings.push(dependentInfo);
            childrenMap.set(issue.id as string, siblings);
          } else if (dependent.dependency_type === 'blocks') {
            // This issue (issue) BLOCKS the dependent
            // So: dependent.blocked_by includes this issue, and this issue.blocks includes dependent

            const blockers = blockedByMap.get(dependent.id as string) || [];
            blockers.push({
              id: issue.id as string,
              title: issue.title as string,
              created_at: issue.created_at as string,
              created_by: (issue.created_by as string) || 'unknown',
              metadata: issue.metadata as string | undefined,
              thread_id: issue.thread_id as string | undefined
            });
            blockedByMap.set(dependent.id as string, blockers);

            const blocked = blocksMap.get(issue.id as string) || [];
            blocked.push(dependentInfo);
            blocksMap.set(issue.id as string, blocked);
          }
        }
      }
    }

    // Second pass: create cards with relationships
    for (const i of issues) {
      const issue = i as Record<string, unknown>;
      const blockedBy = blockedByMap.get(issue.id as string) || [];
      const isReady = issue.status === 'open' && blockedBy.length === 0;

      // Map labels
      let labels: string[] = [];
      if (issue.labels && Array.isArray(issue.labels)) {
        labels = issue.labels.map((l: unknown) => typeof l === 'string' ? l : (l as { label: string }).label);
      }

      // Comments are lazy-loaded on demand (see getIssueComments method)
      // bd show returns comments, but we don't include them in board data
      const comments: Comment[] = [];

      const card: BoardCard = {
        id: issue.id as string,
        title: issue.title as string,
        description: (issue.description as string) || '',
        status: issue.status as IssueStatus,
        priority: (issue.priority as number) ?? 2,
        issue_type: (issue.issue_type as string) || 'task',
        assignee: (issue.assignee as string | null) || null,
        estimated_minutes: (issue.estimated_minutes as number | null) || null,
        created_at: issue.created_at as string,
        updated_at: issue.updated_at as string,
        closed_at: (issue.closed_at as string | null) || null,
        external_ref: (issue.external_ref as string | null) || null,
        is_ready: isReady,
        blocked_by_count: blockedBy.length,
        acceptance_criteria: (issue.acceptance_criteria as string) || '',
        design: (issue.design as string) || '',
        notes: (issue.notes as string) || '',
        due_at: (issue.due_at as string | null) || null,
        defer_until: (issue.defer_until as string | null) || null,
        labels,
        pinned: issue.pinned === true || issue.pinned === 1,
        is_template: issue.is_template === true || issue.is_template === 1,
        ephemeral: issue.ephemeral === true || issue.ephemeral === 1,
        event_kind: (issue.event_kind as string | null) || null,
        actor: (issue.actor as string | null) || null,
        target: (issue.target as string | null) || null,
        payload: (issue.payload as string | null) || null,
        sender: (issue.sender as string | null) || null,
        mol_type: (issue.mol_type as string | null) || null,
        role_type: (issue.role_type as string | null) || null,
        rig: (issue.rig as string | null) || null,
        agent_state: (issue.agent_state as string | null) || null,
        last_activity: (issue.last_activity as string | null) || null,
        hook_bead: (issue.hook_bead as string | null) || null,
        role_bead: (issue.role_bead as string | null) || null,
        await_type: (issue.await_type as string | null) || null,
        await_id: (issue.await_id as string | null) || null,
        timeout_ns: (issue.timeout_ns as number | null) || null,
        waiters: (issue.waiters as string | null) || null,
        parent: parentMap.get(issue.id as string),
        children: childrenMap.get(issue.id as string),
        blocked_by: blockedBy.length > 0 ? blockedBy : undefined,
        blocks: blocksMap.get(issue.id as string),
        comments
      };

      cards.push(card);
    }

    const columns: BoardColumn[] = [
      { key: 'ready', title: 'Ready' },
      { key: 'in_progress', title: 'In Progress' },
      { key: 'blocked', title: 'Blocked' },
      { key: 'closed', title: 'Closed' }
    ];

    return { columns, cards };
  }

  /**
   * Create a new issue using bd CLI
   */
  public async createIssue(input: {
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: number;
    issue_type?: string;
    assignee?: string | null;
    estimated_minutes?: number | null;
    acceptance_criteria?: string;
    design?: string;
    notes?: string;
    external_ref?: string | null;
    due_at?: string | null;
    defer_until?: string | null;
    labels?: string[];
    pinned?: boolean;
    is_template?: boolean;
    ephemeral?: boolean;
    parent_id?: string;
    blocked_by_ids?: string[];
    children_ids?: string[];
  }): Promise<{ id: string }> {
    const title = (input.title ?? '').trim();
    if (!title) {
      throw new Error('Title is required');
    }

    // Validate all string fields to prevent flag injection
    this.validateFlagValue(title, 'title');
    this.validateFlagValue(input.description, 'description');
    this.validateFlagValue(input.issue_type, 'issue_type');
    this.validateFlagValue(input.assignee, 'assignee');
    this.validateFlagValue(input.acceptance_criteria, 'acceptance_criteria');
    this.validateFlagValue(input.design, 'design');
    this.validateFlagValue(input.external_ref, 'external_ref');
    this.validateFlagValue(input.notes, 'notes');
    this.validateFlagValue(input.due_at, 'due_at');
    this.validateFlagValue(input.defer_until, 'defer_until');
    this.validateFlagValue(input.status, 'status');

    // Validate parent and dependency IDs
    if (input.parent_id) {this.validateIssueId(input.parent_id);}
    if (input.blocked_by_ids) {
      input.blocked_by_ids.forEach(id => this.validateIssueId(id));
    }
    if (input.children_ids) {
      input.children_ids.forEach(id => this.validateIssueId(id));
    }

    // Validate labels don't start with '-'
    if (input.labels) {
      input.labels.forEach(label => this.validateFlagValue(label, 'label'));
    }

    // Build bd create command args
    const args = ['create', '--title', title];

    if (input.description) {args.push('--description', input.description);}
    // NOTE: bd create doesn't support --status, issues are always created as "open"
    // If a different status is needed, it must be updated after creation
    if (input.priority !== undefined) {args.push('--priority', String(input.priority));}
    if (input.issue_type) {args.push('--type', input.issue_type);}
    if (input.assignee) {args.push('--assignee', input.assignee);}
    if (input.estimated_minutes !== null && input.estimated_minutes !== undefined) {
      args.push('--estimate', String(input.estimated_minutes));
    }
    if (input.acceptance_criteria) {args.push('--acceptance', input.acceptance_criteria);}
    if (input.design) {args.push('--design', input.design);}
    if (input.notes) {args.push('--notes', input.notes);}
    if (input.external_ref) {args.push('--external-ref', input.external_ref);}
    if (input.due_at) {args.push('--due', input.due_at);}
    if (input.defer_until) {args.push('--defer', input.defer_until);}
    if (input.labels && input.labels.length > 0) {args.push('--labels', input.labels.join(','));}
    if (input.ephemeral) {args.push('--ephemeral');}
    // Note: bd create doesn't support --pinned or --template flags yet
    // These would need to be set after creation if needed
    
    // Build dependencies string for --deps flag
    const deps: string[] = [];
    if (input.parent_id) {
      deps.push(`parent-child:${input.parent_id}`);
    }
    if (input.blocked_by_ids && input.blocked_by_ids.length > 0) {
      for (const blockerId of input.blocked_by_ids) {
        deps.push(`blocks:${blockerId}`);
      }
    }
    if (deps.length > 0) {
      args.push('--deps', deps.join(','));
    }

    args.push('--json');

    try {
      const result = await this.execBd(args);

      // Track mutation and invalidate cache
      this.trackMutation();

      // bd create returns the created issue with id
      let issueId: string;
      const resultObj = result as { id?: string } | { id?: string }[] | null;
      if (resultObj && !Array.isArray(resultObj) && resultObj.id) {
        issueId = resultObj.id;
      } else if (resultObj && Array.isArray(resultObj) && resultObj[0]?.id) {
        issueId = resultObj[0].id;
      } else {
        throw new Error('bd create did not return issue id');
      }

      // If a non-default status was requested, update it after creation
      if (input.status && input.status !== 'open') {
        await this.setIssueStatus(issueId, input.status);
      }
      
      // Set pinned and is_template flags if needed (bd create doesn't support these)
      const updateArgs = [];
      if (input.pinned) {updateArgs.push('--pinned', 'true');}
      if (input.is_template) {updateArgs.push('--template', 'true');}
      
      if (updateArgs.length > 0) {
        await this.execBd(['update', issueId, ...updateArgs]);
        this.trackMutation();
      }

      // Set children (add parent-child relationship from child side)
      if (input.children_ids && input.children_ids.length > 0) {
        for (const childId of input.children_ids) {
          try {
            await this.execBd(['dep', 'add', childId, issueId, '--type', 'parent-child']);
            this.trackMutation();
          } catch (childErr) {
            this.output.appendLine(`[DaemonBeadsAdapter] WARNING: Failed to set parent on child ${childId}: ${childErr}`);
            // Don't fail the whole operation if a child link fails
          }
        }
      }

      return { id: issueId };
    } catch (error) {
      const msg = `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Update issue status using bd CLI
   */
  public async setIssueStatus(id: string, toStatus: IssueStatus): Promise<void> {
    try {
      this.validateIssueId(id);
      await this.execBd(['update', id, '--status', toStatus]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to update status: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Update issue fields using bd CLI
   */
  public async updateIssue(id: string, updates: {
    title?: string;
    description?: string;
    priority?: number;
    issue_type?: string;
    assignee?: string | null;
    estimated_minutes?: number | null;
    acceptance_criteria?: string;
    design?: string;
    external_ref?: string | null;
    notes?: string;
    due_at?: string | null;
    defer_until?: string | null;
    status?: string;
  }): Promise<void> {
    this.validateIssueId(id);

    // Validate all string fields to prevent flag injection
    this.validateFlagValue(updates.title, 'title');
    this.validateFlagValue(updates.description, 'description');
    this.validateFlagValue(updates.issue_type, 'issue_type');
    this.validateFlagValue(updates.assignee, 'assignee');
    this.validateFlagValue(updates.acceptance_criteria, 'acceptance_criteria');
    this.validateFlagValue(updates.design, 'design');
    this.validateFlagValue(updates.external_ref, 'external_ref');
    this.validateFlagValue(updates.notes, 'notes');
    this.validateFlagValue(updates.due_at, 'due_at');
    this.validateFlagValue(updates.defer_until, 'defer_until');
    this.validateFlagValue(updates.status, 'status');

    // WORKAROUND: Use --no-daemon to bypass daemon bug with --due flag
    // TODO: Test if this is still needed with bd 0.47.1+ and remove if fixed
    const args = ['update', id, '--no-daemon'];

    if (updates.title !== undefined) {args.push('--title', updates.title);}
    if (updates.description !== undefined) {args.push('--description', updates.description);}
    if (updates.priority !== undefined) {args.push('--priority', String(updates.priority));}
    if (updates.issue_type !== undefined) {args.push('--type', updates.issue_type);}
    if (updates.assignee !== undefined) {
      if (updates.assignee) {
        args.push('--assignee', updates.assignee);
      } else {
        args.push('--assignee', '');
      }
    }
    if (updates.estimated_minutes !== undefined) {
      args.push('--estimate', String(updates.estimated_minutes || 0));
    }
    if (updates.acceptance_criteria !== undefined) {args.push('--acceptance', updates.acceptance_criteria);}
    if (updates.design !== undefined) {args.push('--design', updates.design);}
    if (updates.external_ref !== undefined) {
      if (updates.external_ref) {
        args.push('--external-ref', updates.external_ref);
      }
    }
    if (updates.notes !== undefined) {args.push('--notes', updates.notes);}
    if (updates.due_at !== undefined) {
      if (updates.due_at) {
        args.push('--due', updates.due_at);
      }
    }
    if (updates.defer_until !== undefined) {
      if (updates.defer_until) {
        args.push('--defer', updates.defer_until);
      }
    }
    if (updates.status !== undefined) {args.push('--status', updates.status);}

    try {
      await this.execBd(args);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to update issue: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Add a comment to an issue
   */
  public async addComment(issueId: string, text: string, author: string): Promise<void> {
    try {
      this.validateIssueId(issueId);

      // Validate author doesn't start with '-' to prevent flag injection
      if (author.startsWith('-')) {
        throw new Error('Author name cannot start with hyphen');
      }

      // Use '--' separator before user-controlled text to prevent flag injection
      // bd comments add expects text as positional argument, not --text flag
      await this.execBd(['comments', 'add', issueId, '--', text, '--author', author]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to add comment: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Add a label to an issue
   */
  public async addLabel(issueId: string, label: string): Promise<void> {
    try {
      this.validateIssueId(issueId);

      // Use '--' separator before user-controlled label to prevent flag injection
      await this.execBd(['label', 'add', issueId, '--', label]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to add label: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Remove a label from an issue
   */
  public async removeLabel(issueId: string, label: string): Promise<void> {
    try {
      this.validateIssueId(issueId);

      // Use '--' separator before user-controlled label to prevent flag injection
      await this.execBd(['label', 'remove', issueId, '--', label]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to remove label: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Add a dependency between issues
   */
  public async addDependency(issueId: string, dependsOnId: string, type: 'parent-child' | 'blocks' = 'blocks'): Promise<void> {
    try {
      this.validateIssueId(issueId);
      this.validateIssueId(dependsOnId);

      // Validate type is one of the allowed values to prevent injection
      if (type !== 'parent-child' && type !== 'blocks') {
        throw new Error('Invalid dependency type');
      }

      // Use '--' separator before issue IDs for defense in depth
      await this.execBd(['dep', 'add', '--', issueId, dependsOnId, '--type', type]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to add dependency: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Remove a dependency between issues
   */
  public async removeDependency(issueId: string, dependsOnId: string): Promise<void> {
    try {
      this.validateIssueId(issueId);
      this.validateIssueId(dependsOnId);

      // Use '--' separator before issue IDs for defense in depth
      await this.execBd(['dep', 'remove', '--', issueId, dependsOnId]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to remove dependency: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Update the workspace root path (for switching repositories)
   * @param newWorkspaceRoot New workspace root path
   */
  public setWorkspaceRoot(newWorkspaceRoot: string): void {
    this.workspaceRoot = newWorkspaceRoot;
    this.output.appendLine(`[DaemonBeadsAdapter] Workspace root changed to: ${newWorkspaceRoot}`);
    // Reset circuit breaker state for new repository
    this.circuitBreakerState = 'CLOSED';
    this.consecutiveFailures = 0;
    this.cancelCircuitRecovery();
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.cancelCircuitRecovery();
    this.output.appendLine('[DaemonBeadsAdapter] Disposed');
  }
}

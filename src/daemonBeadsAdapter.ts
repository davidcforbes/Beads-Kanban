import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
  BoardData,
  BoardColumn,
  BoardCard,
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
  private boardCache: BoardData | null = null;
  private cacheTimestamp: number = 0;
  private lastMutationTime: number = 0;

  // Circuit breaker state for batch failure recovery
  private circuitBreakerState: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private consecutiveFailures: number = 0;
  private circuitOpenedAt: number = 0;
  private circuitRecoveryTimer: NodeJS.Timeout | null = null;
  private readonly CIRCUIT_FAILURE_THRESHOLD = 5;
  private readonly CIRCUIT_RESET_TIMEOUT_MS = 60000; // 1 minute

  constructor(workspaceRoot: string, output: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  /**
   * Sanitize CLI argument to prevent command injection and parsing issues
   * Removes null bytes, excessive whitespace, and other problematic characters
   */
  private sanitizeCliArg(arg: string): string {
    if (typeof arg !== 'string') {
      return String(arg);
    }

    return arg
      // Remove null bytes (can cause command truncation)
      .replace(/\0/g, '')
      // Replace newlines with spaces (prevents command splitting)
      .replace(/[\r\n]+/g, ' ')
      // Collapse multiple spaces into single space
      .replace(/\s+/g, ' ')
      // Trim leading/trailing whitespace
      .trim();
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
    // Clear any existing timer
    this.cancelCircuitRecovery();

    // Schedule recovery attempt after timeout
    this.circuitRecoveryTimer = setTimeout(() => {
      if (this.circuitBreakerState === 'OPEN') {
        this.output.appendLine('[DaemonBeadsAdapter] Circuit breaker: Automatic recovery attempt triggered');
        // Trigger a board reload which will check the circuit and transition to HALF_OPEN
        vscode.commands.executeCommand('beads.refresh');
      }
    }, this.CIRCUIT_RESET_TIMEOUT_MS);

    this.output.appendLine(`[DaemonBeadsAdapter] Circuit breaker: Scheduled automatic recovery in ${this.CIRCUIT_RESET_TIMEOUT_MS / 1000}s`);
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
  private async execBd(args: string[], timeoutMs: number = 30000): Promise<any> {
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

      // Buffer size limit: 10MB to prevent memory issues
      const MAX_BUFFER_SIZE = 10 * 1024 * 1024;

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
        stdout += data.toString();

        // Check buffer size limit
        if (stdout.length > MAX_BUFFER_SIZE) {
          if (!killed) {
            killed = true;
            clearTimeout(timeoutHandle);
            child.kill('SIGTERM');
            this.output.appendLine(`[DaemonBeadsAdapter] Command exceeded buffer limit (${MAX_BUFFER_SIZE} bytes): ${command}`);
            reject(new Error(`Command output exceeded ${MAX_BUFFER_SIZE} bytes limit`));
          }
        }
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();

        // Check buffer size limit for stderr too
        if (stderr.length > MAX_BUFFER_SIZE) {
          if (!killed) {
            killed = true;
            clearTimeout(timeoutHandle);
            child.kill('SIGTERM');
            this.output.appendLine(`[DaemonBeadsAdapter] Command error output exceeded buffer limit: ${command}`);
            reject(new Error(`Command error output exceeded ${MAX_BUFFER_SIZE} bytes limit`));
          }
        }
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
            } catch (error) {
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
      const info = await this.execBd(['info', '--json']);

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
    // Invalidate cache to force fresh data on next getBoard()
    this.boardCache = null;
    this.cacheTimestamp = 0;
    this.output.appendLine('[DaemonBeadsAdapter] Cache invalidated');
  }

  /**
   * Track that a mutation occurred and invalidate cache
   */
  private trackMutation(): void {
    this.lastMutationTime = Date.now();
    this.boardCache = null;
  }

  /**
   * No-op for daemon adapter (not needed for external save detection)
   */
  public isRecentSelfSave(): boolean {
    // Consider a mutation "recent" if it happened within the last 3 seconds
    // This accounts for: bd command execution (~500ms), file write, file watcher debounce (300ms), and buffer
    // Increased from 2s to 3s to prevent edge-case race conditions
    return (Date.now() - this.lastMutationTime) < 3000;
  }

  /**
   * Get board data from bd daemon
   */
  public async getBoard(): Promise<BoardData> {
    // Configurable cache TTL to reduce CLI overhead (default: 5 seconds)
    const cacheTTL = vscode.workspace.getConfiguration('beadsKanban').get<number>('daemonCacheTTL', 5000);
    const now = Date.now();
    if (this.boardCache && (now - this.cacheTimestamp) < cacheTTL) {
      this.output.appendLine(`[DaemonBeadsAdapter] Returning cached board data (age: ${now - this.cacheTimestamp}ms)`);
      return this.boardCache;
    }

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
        this.boardCache = emptyBoard;
        this.cacheTimestamp = Date.now();
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
      const issueIds = basicIssues.map((issue: any) => issue.id);
      const BATCH_SIZE = 50; // Conservative batch size to stay well under CLI limits
      const detailedIssues: any[] = [];

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
          this.output.appendLine(`[DaemonBeadsAdapter] Batch show failed, retrying individually: ${error instanceof Error ? error.message : String(error)}`);
          
          let batchFailureCount = 0;
          for (const id of batch) {
            try {
              const singleResult = await this.execBd(['show', '--json', id]);
              if (Array.isArray(singleResult) && singleResult.length > 0) {
                detailedIssues.push(...singleResult);
              }
            } catch (singleError) {
              batchFailureCount++;
              
              // Skip this issue - it may have been deleted or is invalid
              this.output.appendLine(`[DaemonBeadsAdapter] Skipping missing issue: ${id}`);
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
      
      this.boardCache = boardData;
      this.cacheTimestamp = Date.now();
      
      return boardData;
    } catch (error) {
      throw new Error(`Failed to get board data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get comments for a specific issue (lazy-loaded on demand).
   * This method is called when the user opens the detail dialog for an issue.
   */
  public async getIssueComments(issueId: string): Promise<Comment[]> {
    try {
      // Fetch full issue details including comments
      const result = await this.execBd(['show', '--json', issueId]);

      if (!Array.isArray(result) || result.length === 0) {
        return [];
      }

      const issue = result[0];

      // Extract and map comments
      if (issue.comments && Array.isArray(issue.comments)) {
        return issue.comments.map((c: any) => ({
          id: c.id,
          issue_id: issueId,
          author: c.author || 'unknown',
          text: c.text || '',
          created_at: c.created_at
        }));
      }

      return [];
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] Failed to get comments for ${issueId}: ${error}`);
      return [];
    }
  }

  /**
   * Get the count of issues in a specific column.
   * Uses bd CLI commands to query column-specific counts.
   */
  public async getColumnCount(column: string): Promise<number> {
    try {
      let result: any;

      switch (column) {
        case 'ready':
          // Use bd ready to get issues with no blockers
          result = await this.execBd(['ready', '--json', '--limit', '0']); // 0 = unlimited
          break;

        case 'in_progress':
          // Use bd list with status filter
          result = await this.execBd(['list', '--status=in_progress', '--json', '--limit', '0']);
          break;

        case 'blocked':
          // IMPROVEMENT: Use bd list --status=blocked instead of bd blocked
          // This is more efficient and consistent with getColumnData
          result = await this.execBd(['list', '--status=blocked', '--json', '--limit', '0']);
          break;

        case 'closed':
          // Use bd list with status filter
          result = await this.execBd(['list', '--status=closed', '--json', '--limit', '0']);
          break;

        case 'open':
          // Use bd list with status filter
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
   */
  public async getColumnData(
    column: string,
    offset: number = 0,
    limit: number = 50
  ): Promise<BoardCard[]> {
    try {
      let basicIssues: any[];

      switch (column) {
        case 'ready':
          // Use bd ready - it returns issues with no blockers
          // LIMITATION: bd ready doesn't support --offset, so we fetch offset+limit and slice
          // This means for offset=100, limit=50, we fetch 150 rows and discard the first 100
          // This is inefficient but necessary until bd CLI adds --offset support
          if (offset > 500) {
            this.output.appendLine(`[DaemonBeadsAdapter] Warning: Large offset (${offset}) for ready column may cause performance issues`);
          }
          const readyResult = await this.execBd(['ready', '--json', '--limit', String(offset + limit)]);
          basicIssues = Array.isArray(readyResult) ? readyResult.slice(offset, offset + limit) : [];
          break;

        case 'in_progress':
          // Use bd list with status filter
          // LIMITATION: bd list supports --limit but not --offset
          const inProgressResult = await this.execBd(['list', '--status=in_progress', '--json', '--limit', String(offset + limit)]);
          basicIssues = Array.isArray(inProgressResult) ? inProgressResult.slice(offset, offset + limit) : [];
          break;

        case 'blocked':
          // IMPROVEMENT: Use bd list with appropriate filters instead of bd blocked
          // bd blocked fetches ALL issues which is very inefficient for large databases
          // Instead, we can use bd list --status=blocked to leverage existing pagination
          if (offset > 500) {
            this.output.appendLine(`[DaemonBeadsAdapter] Warning: Large offset (${offset}) for blocked column may cause performance issues`);
          }
          const blockedResult = await this.execBd(['list', '--status=blocked', '--json', '--limit', String(offset + limit)]);
          basicIssues = Array.isArray(blockedResult) ? blockedResult.slice(offset, offset + limit) : [];
          break;

        case 'closed':
          // Use bd list with status filter (supports --limit)
          const closedResult = await this.execBd(['list', '--status=closed', '--json', '--limit', String(offset + limit)]);
          basicIssues = Array.isArray(closedResult) ? closedResult.slice(offset, offset + limit) : [];
          break;

        case 'open':
          // Use bd list with status filter (supports --limit)
          const openResult = await this.execBd(['list', '--status=open', '--json', '--limit', String(offset + limit)]);
          basicIssues = Array.isArray(openResult) ? openResult.slice(offset, offset + limit) : [];
          break;

        default:
          throw new Error(`Unknown column: ${column}`);
      }

      if (basicIssues.length === 0) {
        return [];
      }

      // Step 2: Get full details for all issues using bd show (in batches)
      const issueIds = basicIssues.map((issue: any) => issue.id);
      const BATCH_SIZE = 50;
      const detailedIssues: any[] = [];

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
          this.output.appendLine(`[DaemonBeadsAdapter] Batch show failed, retrying individually: ${error instanceof Error ? error.message : String(error)}`);

          let batchFailureCount = 0;
          for (const id of batch) {
            try {
              const singleResult = await this.execBd(['show', '--json', id]);
              if (Array.isArray(singleResult) && singleResult.length > 0) {
                detailedIssues.push(...singleResult);
              }
            } catch (singleError) {
              batchFailureCount++;
              this.output.appendLine(`[DaemonBeadsAdapter] Skipping missing issue: ${id}`);
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
      return boardData.cards;
    } catch (error) {
      this.output.appendLine(`[DaemonBeadsAdapter] Failed to get column data for ${column}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
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

        this.output.appendLine(`[DaemonBeadsAdapter] getTableData: offset=${offset}, limit=${limit}, filters=${JSON.stringify(filters)}, sorting=${JSON.stringify(sorting)}`);

        // Get all issues from board (uses cache if available)
        const board = await this.getBoard();
        let allCards = board.cards;

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
                    if (!matchesSearch) return false;
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
                        if (card.status === 'closed') return false;
                    } else if (filters.status === 'active') {
                        if (card.status !== 'in_progress' && card.status !== 'open') return false;
                    } else if (filters.status === 'blocked') {
                        if (card.status !== 'blocked') return false;
                    } else if (filters.status !== 'all') {
                        if (card.status !== filters.status) return false;
                    }
                }

                // Assignee filter
                if (filters.assignee) {
                    if (filters.assignee === 'unassigned') {
                        if (card.assignee) return false;
                    } else {
                        if (card.assignee !== filters.assignee) return false;
                    }
                }

                // Labels filter (must have ALL specified labels)
                if (filters.labels && filters.labels.length > 0) {
                    if (!card.labels || card.labels.length === 0) return false;
                    const hasAllLabels = filters.labels.every(label => 
                        card.labels.includes(label)
                    );
                    if (!hasAllLabels) return false;
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
                        case 'assignee':
                            const aAssignee = a.assignee || '';
                            const bAssignee = b.assignee || '';
                            cmp = aAssignee.localeCompare(bAssignee);
                            break;
                        case 'created':
                            const aCreated = new Date(a.created_at).getTime();
                            const bCreated = new Date(b.created_at).getTime();
                            cmp = aCreated - bCreated;
                            break;
                        case 'updated':
                            const aUpdated = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                            const bUpdated = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                            cmp = aUpdated - bUpdated;
                            break;
                        case 'closed':
                            const aClosed = a.closed_at ? new Date(a.closed_at).getTime() : 0;
                            const bClosed = b.closed_at ? new Date(b.closed_at).getTime() : 0;
                            cmp = aClosed - bClosed;
                            break;
                        default:
                            // Fallback to updated_at
                            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
                            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
                            cmp = aTime - bTime;
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
  private mapIssuesToBoardData(issues: any[]): BoardData {
    const cards: BoardCard[] = [];
    
    // Build dependency maps from dependents structure
    // Note: bd show returns "dependents" which are issues that depend on THIS issue
    const parentMap = new Map<string, DependencyInfo>(); // Maps child_id -> parent_info
    const childrenMap = new Map<string, DependencyInfo[]>(); // Maps parent_id -> children_info[]
    const blockedByMap = new Map<string, DependencyInfo[]>(); // Maps issue_id -> blocker_info[]
    const blocksMap = new Map<string, DependencyInfo[]>(); // Maps blocker_id -> blocked_info[]

    // First pass: build dependency maps
    for (const issue of issues) {
      if (issue.dependents && Array.isArray(issue.dependents)) {
        for (const dependent of issue.dependents) {
          const dependentInfo: DependencyInfo = {
            id: dependent.id,
            title: dependent.title,
            created_at: dependent.created_at,
            created_by: dependent.created_by || 'unknown',
            metadata: dependent.metadata,
            thread_id: dependent.thread_id
          };

          if (dependent.dependency_type === 'parent-child') {
            // This issue (issue) is the PARENT
            // The dependent is the CHILD
            // So: child.parent = this issue, and this issue.children includes child
            
            parentMap.set(dependent.id, {
              id: issue.id,
              title: issue.title,
              created_at: issue.created_at,
              created_by: issue.created_by || 'unknown',
              metadata: issue.metadata,
              thread_id: issue.thread_id
            });
            
            const siblings = childrenMap.get(issue.id) || [];
            siblings.push(dependentInfo);
            childrenMap.set(issue.id, siblings);
          } else if (dependent.dependency_type === 'blocks') {
            // This issue (issue) BLOCKS the dependent
            // So: dependent.blocked_by includes this issue, and this issue.blocks includes dependent
            
            const blockers = blockedByMap.get(dependent.id) || [];
            blockers.push({
              id: issue.id,
              title: issue.title,
              created_at: issue.created_at,
              created_by: issue.created_by || 'unknown',
              metadata: issue.metadata,
              thread_id: issue.thread_id
            });
            blockedByMap.set(dependent.id, blockers);
            
            const blocked = blocksMap.get(issue.id) || [];
            blocked.push(dependentInfo);
            blocksMap.set(issue.id, blocked);
          }
        }
      }
    }

    // Second pass: create cards with relationships
    for (const issue of issues) {
      const blockedBy = blockedByMap.get(issue.id) || [];
      const isReady = issue.status === 'open' && blockedBy.length === 0;
      
      // Map labels
      let labels: string[] = [];
      if (issue.labels && Array.isArray(issue.labels)) {
        labels = issue.labels.map((l: any) => typeof l === 'string' ? l : l.label);
      }

      // Comments are lazy-loaded on demand (see getIssueComments method)
      // bd show returns comments, but we don't include them in board data
      const comments: Comment[] = [];

      const card: BoardCard = {
        id: issue.id,
        title: issue.title,
        description: issue.description || '',
        status: issue.status as IssueStatus,
        priority: issue.priority ?? 2,
        issue_type: issue.issue_type || 'task',
        assignee: issue.assignee || null,
        estimated_minutes: issue.estimated_minutes || null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        closed_at: issue.closed_at || null,
        external_ref: issue.external_ref || null,
        is_ready: isReady,
        blocked_by_count: blockedBy.length,
        acceptance_criteria: issue.acceptance_criteria || '',
        design: issue.design || '',
        notes: issue.notes || '',
        due_at: issue.due_at || null,
        defer_until: issue.defer_until || null,
        labels,
        pinned: issue.pinned === true || issue.pinned === 1,
        is_template: issue.is_template === true || issue.is_template === 1,
        ephemeral: issue.ephemeral === true || issue.ephemeral === 1,
        event_kind: issue.event_kind || null,
        actor: issue.actor || null,
        target: issue.target || null,
        payload: issue.payload || null,
        sender: issue.sender || null,
        mol_type: issue.mol_type || null,
        role_type: issue.role_type || null,
        rig: issue.rig || null,
        agent_state: issue.agent_state || null,
        last_activity: issue.last_activity || null,
        hook_bead: issue.hook_bead || null,
        role_bead: issue.role_bead || null,
        await_type: issue.await_type || null,
        await_id: issue.await_id || null,
        timeout_ns: issue.timeout_ns || null,
        waiters: issue.waiters || null,
        parent: parentMap.get(issue.id),
        children: childrenMap.get(issue.id),
        blocked_by: blockedBy.length > 0 ? blockedBy : undefined,
        blocks: blocksMap.get(issue.id),
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

    // Build bd create command args
    const args = ['create', '--title', title];

    if (input.description) args.push('--description', input.description);
    // NOTE: bd create doesn't support --status, issues are always created as "open"
    // If a different status is needed, it must be updated after creation
    if (input.priority !== undefined) args.push('--priority', String(input.priority));
    if (input.issue_type) args.push('--type', input.issue_type);
    if (input.assignee) args.push('--assignee', input.assignee);
    if (input.estimated_minutes !== null && input.estimated_minutes !== undefined) {
      args.push('--estimate', String(input.estimated_minutes));
    }
    if (input.acceptance_criteria) args.push('--acceptance', input.acceptance_criteria);
    if (input.design) args.push('--design', input.design);
    if (input.notes) args.push('--notes', input.notes);
    if (input.external_ref) args.push('--external-ref', input.external_ref);
    if (input.due_at) args.push('--due', input.due_at);
    if (input.defer_until) args.push('--defer', input.defer_until);
    if (input.labels && input.labels.length > 0) args.push('--labels', input.labels.join(','));
    if (input.ephemeral) args.push('--ephemeral');
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
      if (result && result.id) {
        issueId = result.id;
      } else if (result && Array.isArray(result) && result[0]?.id) {
        issueId = result[0].id;
      } else {
        throw new Error('bd create did not return issue id');
      }

      // If a non-default status was requested, update it after creation
      if (input.status && input.status !== 'open') {
        await this.setIssueStatus(issueId, input.status);
      }
      
      // Set pinned and is_template flags if needed (bd create doesn't support these)
      const updateArgs = [];
      if (input.pinned) updateArgs.push('--pinned', 'true');
      if (input.is_template) updateArgs.push('--template', 'true');
      
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
    const args = ['update', id, '--no-daemon']; // Use --no-daemon to bypass daemon bug with --due flag

    if (updates.title !== undefined) args.push('--title', updates.title);
    if (updates.description !== undefined) args.push('--description', updates.description);
    if (updates.priority !== undefined) args.push('--priority', String(updates.priority));
    if (updates.issue_type !== undefined) args.push('--type', updates.issue_type);
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
    if (updates.acceptance_criteria !== undefined) args.push('--acceptance', updates.acceptance_criteria);
    if (updates.design !== undefined) args.push('--design', updates.design);
    if (updates.external_ref !== undefined) {
      if (updates.external_ref) {
        args.push('--external-ref', updates.external_ref);
      }
    }
    if (updates.notes !== undefined) args.push('--notes', updates.notes);
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
    if (updates.status !== undefined) args.push('--status', updates.status);

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
      // bd comments add expects text as positional argument, not --text flag
      await this.execBd(['comments', 'add', issueId, text, '--author', author]);

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
      await this.execBd(['label', 'add', issueId, label]);

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
      await this.execBd(['label', 'remove', issueId, label]);

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
      await this.execBd(['dep', 'add', issueId, dependsOnId, '--type', type]);

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
      await this.execBd(['dep', 'remove', issueId, dependsOnId]);

      // Track mutation and invalidate cache
      this.trackMutation();
    } catch (error) {
      const msg = `Failed to remove dependency: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
      throw new Error(msg);
    }
  }

  /**
   * Cleanup resources
   */
  public dispose(): void {
    this.cancelCircuitRecovery();
    this.boardCache = null;
    this.output.appendLine('[DaemonBeadsAdapter] Disposed');
  }
}

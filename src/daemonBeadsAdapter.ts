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

  constructor(workspaceRoot: string, output: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  /**
   * Execute a bd CLI command and return parsed JSON output
   */
  private async execBd(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const child = spawn('bd', args, {
        cwd: this.workspaceRoot,
        shell: false
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        this.output.appendLine(`[DaemonBeadsAdapter] Command error: ${error.message}`);
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          try {
            // Parse JSON if stdout has content
            const result = stdout.trim() ? JSON.parse(stdout) : null;
            resolve(result);
          } catch (error) {
            this.output.appendLine(`[DaemonBeadsAdapter] JSON parse error: ${error}`);
            this.output.appendLine(`[DaemonBeadsAdapter] Stdout: ${stdout}`);
            reject(new Error(`Failed to parse JSON output: ${error}`));
          }
        } else {
          this.output.appendLine(`[DaemonBeadsAdapter] Command failed (exit ${code}): ${stderr || stdout}`);
          reject(new Error(`bd command failed with exit code ${code}: ${stderr || stdout}`));
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
    // Consider a mutation "recent" if it happened within the last 500ms
    return (Date.now() - this.lastMutationTime) < 500;
  }

  /**
   * Get board data from bd daemon
   */
  public async getBoard(): Promise<BoardData> {
    // 1-second cache to reduce CLI overhead
    const now = Date.now();
    if (this.boardCache && (now - this.cacheTimestamp) < 1000) {
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
        const batchResults = await this.execBd(['show', '--json', ...batch]);

        if (!Array.isArray(batchResults)) {
          throw new Error('Expected array from bd show --json <ids>');
        }

        detailedIssues.push(...batchResults);
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
  }): Promise<{ id: string }> {
    const title = (input.title ?? '').trim();
    if (!title) {
      throw new Error('Title is required');
    }

    // Build bd create command args
    const args = ['create', '--title', title];

    if (input.description) args.push('--description', input.description);
    if (input.status) args.push('--status', input.status);
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

    args.push('--json');

    try {
      const result = await this.execBd(args);

      // Track mutation and invalidate cache
      this.trackMutation();

      // bd create returns the created issue with id
      if (result && result.id) {
        return { id: result.id };
      } else if (result && Array.isArray(result) && result[0]?.id) {
        return { id: result[0].id };
      } else {
        throw new Error('bd create did not return issue id');
      }
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
    const args = ['update', id];

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
      await this.execBd(['comments', 'add', issueId, '--text', text, '--author', author]);

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
    this.boardCache = null;
    this.output.appendLine('[DaemonBeadsAdapter] Disposed');
  }
}

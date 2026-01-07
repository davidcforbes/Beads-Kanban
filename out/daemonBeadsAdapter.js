"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaemonBeadsAdapter = void 0;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
/**
 * BeadsAdapter implementation that uses the bd CLI daemon instead of sql.js
 * This eliminates the need for in-memory SQLite and provides better real-time sync
 */
class DaemonBeadsAdapter {
    workspaceRoot;
    output;
    boardCache = null;
    cacheTimestamp = 0;
    lastMutationTime = 0;
    constructor(workspaceRoot, output) {
        this.workspaceRoot = workspaceRoot;
        this.output = output;
    }
    /**
     * Execute a bd CLI command and return parsed JSON output
     */
    async execBd(args) {
        return new Promise((resolve, reject) => {
            const child = (0, child_process_1.spawn)('bd', args, {
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
                    }
                    catch (error) {
                        // Not JSON - likely a friendly message from mutation commands
                        // This is fine, just return null to indicate success
                        this.output.appendLine(`[DaemonBeadsAdapter] Non-JSON output: ${trimmed}`);
                        resolve(null);
                    }
                }
                else {
                    this.output.appendLine(`[DaemonBeadsAdapter] Command failed (exit ${code}): ${stderr || stdout}`);
                    reject(new Error(`bd command failed with exit code ${code}: ${stderr || stdout}`));
                }
            });
        });
    }
    /**
     * Ensure the daemon is connected and workspace is initialized
     */
    async ensureConnected() {
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
        }
        catch (error) {
            const msg = `Failed to connect to beads daemon: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Get the workspace root path
     */
    getConnectedDbPath() {
        return this.workspaceRoot;
    }
    /**
     * Reload database (no-op for daemon adapter, always reads from daemon)
     */
    async reloadDatabase() {
        // Invalidate cache to force fresh data on next getBoard()
        this.boardCache = null;
        this.cacheTimestamp = 0;
        this.output.appendLine('[DaemonBeadsAdapter] Cache invalidated');
    }
    /**
     * Track that a mutation occurred and invalidate cache
     */
    trackMutation() {
        this.lastMutationTime = Date.now();
        this.boardCache = null;
    }
    /**
     * No-op for daemon adapter (not needed for external save detection)
     */
    isRecentSelfSave() {
        // Consider a mutation "recent" if it happened within the last 2 seconds
        // This accounts for: bd command execution (~500ms), file write, file watcher debounce (300ms), and buffer
        return (Date.now() - this.lastMutationTime) < 2000;
    }
    /**
     * Get board data from bd daemon
     */
    async getBoard() {
        // 1-second cache to reduce CLI overhead
        const now = Date.now();
        if (this.boardCache && (now - this.cacheTimestamp) < 1000) {
            return this.boardCache;
        }
        // Read pagination limit from configuration
        const maxIssues = vscode.workspace.getConfiguration('beadsKanban').get('maxIssues', 1000);
        try {
            // Step 1: Get limited issues (basic data)
            // Request maxIssues + 1 to detect if there are more
            const basicIssues = await this.execBd(['list', '--json', '--all', '--limit', String(maxIssues + 1)]);
            if (!Array.isArray(basicIssues) || basicIssues.length === 0) {
                // Return empty board if no issues
                const emptyBoard = {
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
                vscode.window.showInformationMessage(`Beads Kanban: Showing ${maxIssues} most recent issues. Increase the maxIssues setting to show more.`, 'Open Settings').then(action => {
                    if (action === 'Open Settings') {
                        vscode.commands.executeCommand('workbench.action.openSettings', 'beadsKanban.maxIssues');
                    }
                });
            }
            // Step 2: Get full details for all issues (includes dependents/relationships)
            // Batch the requests to avoid command-line length overflow on Windows (~8191 chars)
            const issueIds = basicIssues.map((issue) => issue.id);
            const BATCH_SIZE = 50; // Conservative batch size to stay well under CLI limits
            const detailedIssues = [];
            for (let i = 0; i < issueIds.length; i += BATCH_SIZE) {
                const batch = issueIds.slice(i, i + BATCH_SIZE);
                try {
                    const batchResults = await this.execBd(['show', '--json', ...batch]);
                    if (!Array.isArray(batchResults)) {
                        throw new Error('Expected array from bd show --json <ids>');
                    }
                    detailedIssues.push(...batchResults);
                }
                catch (error) {
                    // If batch fails (likely due to missing/invalid ID), try each issue individually
                    this.output.appendLine(`[DaemonBeadsAdapter] Batch show failed, retrying individually: ${error instanceof Error ? error.message : String(error)}`);
                    for (const id of batch) {
                        try {
                            const singleResult = await this.execBd(['show', '--json', id]);
                            if (Array.isArray(singleResult) && singleResult.length > 0) {
                                detailedIssues.push(...singleResult);
                            }
                        }
                        catch (singleError) {
                            // Skip this issue - it may have been deleted or is invalid
                            this.output.appendLine(`[DaemonBeadsAdapter] Skipping missing issue: ${id}`);
                        }
                    }
                }
            }
            const boardData = this.mapIssuesToBoardData(detailedIssues);
            this.boardCache = boardData;
            this.cacheTimestamp = Date.now();
            return boardData;
        }
        catch (error) {
            throw new Error(`Failed to get board data: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    /**
     * Get comments for a specific issue (lazy-loaded on demand).
     * This method is called when the user opens the detail dialog for an issue.
     */
    async getIssueComments(issueId) {
        try {
            // Fetch full issue details including comments
            const result = await this.execBd(['show', '--json', issueId]);
            if (!Array.isArray(result) || result.length === 0) {
                return [];
            }
            const issue = result[0];
            // Extract and map comments
            if (issue.comments && Array.isArray(issue.comments)) {
                return issue.comments.map((c) => ({
                    id: c.id,
                    issue_id: issueId,
                    author: c.author || 'unknown',
                    text: c.text || '',
                    created_at: c.created_at
                }));
            }
            return [];
        }
        catch (error) {
            this.output.appendLine(`[DaemonBeadsAdapter] Failed to get comments for ${issueId}: ${error}`);
            return [];
        }
    }
    /**
     * Map daemon issue data to BoardData format
     * This implements the data mapping task (beads-nm3)
     */
    mapIssuesToBoardData(issues) {
        const cards = [];
        // Build dependency maps from dependents structure
        // Note: bd show returns "dependents" which are issues that depend on THIS issue
        const parentMap = new Map(); // Maps child_id -> parent_info
        const childrenMap = new Map(); // Maps parent_id -> children_info[]
        const blockedByMap = new Map(); // Maps issue_id -> blocker_info[]
        const blocksMap = new Map(); // Maps blocker_id -> blocked_info[]
        // First pass: build dependency maps
        for (const issue of issues) {
            if (issue.dependents && Array.isArray(issue.dependents)) {
                for (const dependent of issue.dependents) {
                    const dependentInfo = {
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
                    }
                    else if (dependent.dependency_type === 'blocks') {
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
            let labels = [];
            if (issue.labels && Array.isArray(issue.labels)) {
                labels = issue.labels.map((l) => typeof l === 'string' ? l : l.label);
            }
            // Comments are lazy-loaded on demand (see getIssueComments method)
            // bd show returns comments, but we don't include them in board data
            const comments = [];
            const card = {
                id: issue.id,
                title: issue.title,
                description: issue.description || '',
                status: issue.status,
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
        const columns = [
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
    async createIssue(input) {
        const title = (input.title ?? '').trim();
        if (!title) {
            throw new Error('Title is required');
        }
        // Build bd create command args
        const args = ['create', '--title', title];
        if (input.description)
            args.push('--description', input.description);
        // NOTE: bd create doesn't support --status, issues are always created as "open"
        // If a different status is needed, it must be updated after creation
        if (input.priority !== undefined)
            args.push('--priority', String(input.priority));
        if (input.issue_type)
            args.push('--type', input.issue_type);
        if (input.assignee)
            args.push('--assignee', input.assignee);
        if (input.estimated_minutes !== null && input.estimated_minutes !== undefined) {
            args.push('--estimate', String(input.estimated_minutes));
        }
        if (input.acceptance_criteria)
            args.push('--acceptance', input.acceptance_criteria);
        if (input.design)
            args.push('--design', input.design);
        if (input.notes)
            args.push('--notes', input.notes);
        if (input.external_ref)
            args.push('--external-ref', input.external_ref);
        if (input.due_at)
            args.push('--due', input.due_at);
        if (input.defer_until)
            args.push('--defer', input.defer_until);
        args.push('--json');
        try {
            const result = await this.execBd(args);
            // Track mutation and invalidate cache
            this.trackMutation();
            // bd create returns the created issue with id
            let issueId;
            if (result && result.id) {
                issueId = result.id;
            }
            else if (result && Array.isArray(result) && result[0]?.id) {
                issueId = result[0].id;
            }
            else {
                throw new Error('bd create did not return issue id');
            }
            // If a non-default status was requested, update it after creation
            if (input.status && input.status !== 'open') {
                await this.setIssueStatus(issueId, input.status);
            }
            return { id: issueId };
        }
        catch (error) {
            const msg = `Failed to create issue: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Update issue status using bd CLI
     */
    async setIssueStatus(id, toStatus) {
        try {
            await this.execBd(['update', id, '--status', toStatus]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to update status: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Update issue fields using bd CLI
     */
    async updateIssue(id, updates) {
        const args = ['update', id, '--no-daemon']; // Use --no-daemon to bypass daemon bug with --due flag
        if (updates.title !== undefined)
            args.push('--title', updates.title);
        if (updates.description !== undefined)
            args.push('--description', updates.description);
        if (updates.priority !== undefined)
            args.push('--priority', String(updates.priority));
        if (updates.issue_type !== undefined)
            args.push('--type', updates.issue_type);
        if (updates.assignee !== undefined) {
            if (updates.assignee) {
                args.push('--assignee', updates.assignee);
            }
            else {
                args.push('--assignee', '');
            }
        }
        if (updates.estimated_minutes !== undefined) {
            args.push('--estimate', String(updates.estimated_minutes || 0));
        }
        if (updates.acceptance_criteria !== undefined)
            args.push('--acceptance', updates.acceptance_criteria);
        if (updates.design !== undefined)
            args.push('--design', updates.design);
        if (updates.external_ref !== undefined) {
            if (updates.external_ref) {
                args.push('--external-ref', updates.external_ref);
            }
        }
        if (updates.notes !== undefined)
            args.push('--notes', updates.notes);
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
        if (updates.status !== undefined)
            args.push('--status', updates.status);
        try {
            await this.execBd(args);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to update issue: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Add a comment to an issue
     */
    async addComment(issueId, text, author) {
        try {
            // bd comments add expects text as positional argument, not --text flag
            await this.execBd(['comments', 'add', issueId, text, '--author', author]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to add comment: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Add a label to an issue
     */
    async addLabel(issueId, label) {
        try {
            await this.execBd(['label', 'add', issueId, label]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to add label: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Remove a label from an issue
     */
    async removeLabel(issueId, label) {
        try {
            await this.execBd(['label', 'remove', issueId, label]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to remove label: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Add a dependency between issues
     */
    async addDependency(issueId, dependsOnId, type = 'blocks') {
        try {
            await this.execBd(['dep', 'add', issueId, dependsOnId, '--type', type]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to add dependency: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Remove a dependency between issues
     */
    async removeDependency(issueId, dependsOnId) {
        try {
            await this.execBd(['dep', 'remove', issueId, dependsOnId]);
            // Track mutation and invalidate cache
            this.trackMutation();
        }
        catch (error) {
            const msg = `Failed to remove dependency: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[DaemonBeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    /**
     * Cleanup resources
     */
    dispose() {
        this.boardCache = null;
        this.output.appendLine('[DaemonBeadsAdapter] Disposed');
    }
}
exports.DaemonBeadsAdapter = DaemonBeadsAdapter;

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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BeadsAdapter = void 0;
const fs = __importStar(require("fs"));
const fs_1 = require("fs");
const path = __importStar(require("path"));
const sql_js_1 = __importDefault(require("sql.js"));
const vscode = __importStar(require("vscode"));
// Sanitize error messages to prevent leaking implementation details
function sanitizeError(error) {
    const msg = error instanceof Error ? error.message : String(error);
    // Remove file paths (C:\..., /home/..., \\..., etc.)
    const sanitized = msg
        .replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]')
        .replace(/\/[^\s]+\.(ts|js|tsx|jsx|db|sqlite|sqlite3)/g, '[FILE]')
        .replace(/\\[^\s]+\.(ts|js|tsx|jsx|db|sqlite|sqlite3)/g, '[FILE]')
        .replace(/\s+at\s+.*/g, ''); // Remove stack trace lines
    // Return a generic message if nothing is left or if it looks like system errors
    if (sanitized.trim().length === 0 || sanitized.includes('ENOENT') || sanitized.includes('EACCES')) {
        return 'An error occurred while processing your request.';
    }
    return sanitized.trim();
}
class BeadsAdapter {
    output;
    db = null;
    dbPath = null;
    saveTimeout = null;
    isDirty = false;
    isSaving = false;
    boardCache = null;
    cacheTimestamp = 0;
    lastSaveTime = 0;
    lastKnownMtime = 0; // Track file modification time to detect external changes
    constructor(output) {
        this.output = output;
    }
    dispose() {
        // Clear any pending save timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        // Flush any pending changes before disposing
        if (this.isDirty && this.db && this.dbPath) {
            try {
                this.save();
                this.isDirty = false;
            }
            catch (error) {
                this.output.appendLine(`[BeadsAdapter] Failed to flush changes on dispose: ${error}`);
            }
        }
        try {
            this.db?.close();
        }
        catch {
            // ignore
        }
        this.db = null;
        this.dbPath = null;
    }
    async ensureConnected() {
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            throw new Error("Open a folder workspace to use Beads Kanban.");
        }
        const beadsDir = path.join(ws.uri.fsPath, ".beads");
        try {
            const stats = await fs_1.promises.stat(beadsDir);
            if (!stats.isDirectory()) {
                throw new Error("No .beads directory found in the workspace root.");
            }
        }
        catch {
            throw new Error("No .beads directory found in the workspace root.");
        }
        // Read directory and filter for database files (async)
        const allFiles = await fs_1.promises.readdir(beadsDir);
        const dbFiles = allFiles.filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f));
        // Filter out symlinks (async)
        const candidatePaths = [];
        for (const f of dbFiles) {
            const p = path.join(beadsDir, f);
            try {
                const stats = await fs_1.promises.lstat(p);
                if (stats.isSymbolicLink()) {
                    this.output.appendLine(`[BeadsAdapter] Skipping symlink: ${p}`);
                    continue;
                }
                candidatePaths.push(p);
            }
            catch (e) {
                this.output.appendLine(`[BeadsAdapter] Error checking ${p}: ${e}`);
            }
        }
        if (candidatePaths.length === 0) {
            throw new Error("No SQLite database file found in .beads (expected *.db/*.sqlite/*.sqlite3).");
        }
        const failureReasons = [];
        // Initialize SQL.js
        const SQL = await (0, sql_js_1.default)({
            locateFile: (file) => path.join(__dirname, file)
        });
        // Find the DB that contains the `issues` table.
        for (const p of candidatePaths) {
            try {
                const filebuffer = await fs_1.promises.readFile(p);
                const db = new SQL.Database(filebuffer);
                // Check for issues table
                const res = db.exec("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='issues' LIMIT 1;");
                if (res.length > 0 && res[0].values.length > 0 && res[0].values[0][0] === 1) {
                    const msg = `[BeadsAdapter] Connected to DB: ${p}`;
                    this.output.appendLine(msg);
                    this.db = db;
                    this.dbPath = p;
                    // Track file modification time to detect external changes
                    try {
                        const stats = await fs_1.promises.stat(p);
                        this.lastKnownMtime = stats.mtimeMs;
                    }
                    catch (e) {
                        this.output.appendLine(`[BeadsAdapter] Warning: Could not read file stats: ${e}`);
                    }
                    return;
                }
                const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
                const tableNames = tablesRes.length > 0 ? tablesRes[0].values.map(v => v[0]).join(', ') : '';
                const reason = `File opened but 'issues' table missing. Tables found: [${tableNames}]`;
                this.output.appendLine(`[BeadsAdapter] ${p}: ${reason}`);
                failureReasons.push(`${path.basename(p)}: ${reason}`);
                db.close();
            }
            catch (e) {
                const msg = String(e instanceof Error ? e.message : e);
                this.output.appendLine(`[BeadsAdapter] Candidate DB failed: ${p} (${msg})`);
                failureReasons.push(`${path.basename(p)}: ${msg}`);
            }
        }
        const fullError = `Could not find a valid Beads DB in .beads. Searched: ${candidatePaths.map(x => path.basename(x)).join(', ')}. Details:\n${failureReasons.join('\n')}`;
        this.output.appendLine(`[BeadsAdapter] ERROR: ${fullError}`);
        throw new Error(fullError);
    }
    /**
     * Get the issue prefix from config table or VS Code settings
     */
    async getIssuePrefix() {
        // First check VS Code setting
        const configPrefix = vscode.workspace.getConfiguration().get("beadsKanban.issuePrefix", "").trim();
        if (configPrefix) {
            return configPrefix;
        }
        // Fall back to database config
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        const res = this.db.exec("SELECT value FROM config WHERE key = 'issue_prefix' LIMIT 1;");
        if (res.length > 0 && res[0].values.length > 0) {
            return String(res[0].values[0][0]);
        }
        // Default fallback
        return "beads";
    }
    /**
     * Generate a short hash suffix (3 characters, base36) for issue IDs
     * Uses a hash of title + timestamp to ensure uniqueness
     */
    generateShortHash(title) {
        const input = `${title}-${Date.now()}-${Math.random()}`;
        let hash = 0;
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        // Convert to base36 and take first 3 characters
        return Math.abs(hash).toString(36).substring(0, 3);
    }
    /**
     * Reload the database from disk to pick up external changes.
     * Closes the current connection and re-reads the file.
     */
    /**
     * Flushes any pending saves to disk to prevent data loss during reload.
     * This method ensures that:
     * 1. Any scheduled saves are executed immediately
     * 2. Any in-progress saves are allowed to complete
     * 3. No dirty data is lost when reloading from disk
     */
    async flushPendingSaves() {
        // Cancel any scheduled save and execute immediately if needed
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
            this.saveTimeout = null;
        }
        // If we have dirty data and aren't currently saving, save now
        if (this.isDirty && !this.isSaving) {
            this.isDirty = false;
            this.isSaving = true;
            try {
                this.save();
            }
            catch (error) {
                // If save failed, mark as dirty again
                this.isDirty = true;
                throw error; // Re-throw to prevent reload after failed save
            }
            finally {
                this.isSaving = false;
            }
        }
        // If save is in progress (shouldn't happen but be defensive), wait for it
        while (this.isSaving) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.output.appendLine('[BeadsAdapter] Pending saves flushed successfully');
    }
    async reloadDatabase() {
        // CRITICAL: Flush any pending saves before reloading to prevent data loss
        await this.flushPendingSaves();
        if (!this.dbPath) {
            this.output.appendLine('[BeadsAdapter] reloadDatabase: No database path set, calling ensureConnected');
            await this.ensureConnected();
            return;
        }
        try {
            this.output.appendLine(`[BeadsAdapter] Reloading database from ${this.dbPath}`);
            // Close current database if exists
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            // Re-read the file and create new database instance
            const SQL = await (0, sql_js_1.default)({
                locateFile: (file) => path.join(__dirname, file)
            });
            const filebuffer = await fs_1.promises.readFile(this.dbPath);
            const db = new SQL.Database(filebuffer);
            // Verify issues table still exists
            const res = db.exec("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='issues' LIMIT 1;");
            if (res.length === 0 || res[0].values.length === 0 || res[0].values[0][0] !== 1) {
                db.close();
                throw new Error('Database reloaded but issues table is missing');
            }
            this.db = db;
            // Clear cache to force fresh data on next getBoard()
            this.boardCache = null;
            this.cacheTimestamp = 0;
            // Update mtime tracking to prevent unnecessary reloads
            const stats = await fs_1.promises.stat(this.dbPath);
            this.lastKnownMtime = stats.mtimeMs;
            this.output.appendLine('[BeadsAdapter] Database reloaded successfully');
        }
        catch (error) {
            this.output.appendLine(`[BeadsAdapter] Failed to reload database: ${error instanceof Error ? error.message : String(error)}`);
            // Try to reconnect from scratch
            this.db = null;
            this.dbPath = null;
            await this.ensureConnected();
        }
    }
    /**
     * Check if the database file has been modified externally since we last loaded it
     */
    async hasFileChangedExternally() {
        if (!this.dbPath || this.lastKnownMtime === 0)
            return false;
        try {
            const stats = await fs_1.promises.stat(this.dbPath);
            const currentMtime = stats.mtimeMs;
            // File has changed if mtime is different from what we know
            return currentMtime !== this.lastKnownMtime;
        }
        catch (error) {
            this.output.appendLine(`[BeadsAdapter] Error checking file mtime: ${error}`);
            return false;
        }
    }
    /**
     * Check if we recently saved the file ourselves (within last 2 seconds)
     * This helps avoid reloading our own writes
     */
    isRecentSelfSave() {
        if (this.lastSaveTime === 0)
            return false;
        const timeSinceLastSave = Date.now() - this.lastSaveTime;
        return timeSinceLastSave < 2000; // 2 second window
    }
    /**
     * Reload the database from disk.
     * Pending saves are flushed first to prevent data loss.
     */
    async reloadFromDisk() {
        if (!this.dbPath) {
            throw new Error('Cannot reload: No database path set');
        }
        // CRITICAL: Flush any pending saves before reloading to prevent data loss
        await this.flushPendingSaves();
        try {
            // Close existing database
            if (this.db) {
                this.db.close();
                this.db = null;
            }
            // Clear cache - pending changes were already flushed
            this.isDirty = false;
            this.boardCache = null;
            // Initialize SQL.js
            const SQL = await (0, sql_js_1.default)({
                locateFile: (file) => path.join(__dirname, file)
            });
            // Read file from disk
            const filebuffer = await fs_1.promises.readFile(this.dbPath);
            this.db = new SQL.Database(filebuffer);
            // Update mtime tracking
            const stats = await fs_1.promises.stat(this.dbPath);
            this.lastKnownMtime = stats.mtimeMs;
            this.output.appendLine(`[BeadsAdapter] Reloaded database from disk: ${this.dbPath}`);
        }
        catch (error) {
            const msg = `Failed to reload database: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[BeadsAdapter] ERROR: ${msg}`);
            throw new Error(msg);
        }
    }
    getConnectedDbPath() {
        return this.dbPath;
    }
    async getBoard() {
        // Check cache (valid for 1 second to reduce DB queries during rapid operations)
        const now = Date.now();
        if (this.boardCache && (now - this.cacheTimestamp) < 1000) {
            return this.boardCache;
        }
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        // Check if database file was modified externally
        // If it was changed and it's not from our own save, reload from disk
        const fileChanged = await this.hasFileChangedExternally();
        if (fileChanged && !this.isRecentSelfSave()) {
            this.output.appendLine('[BeadsAdapter] External database change detected, reloading from disk');
            await this.reloadFromDisk();
        }
        const db = this.db;
        // Read pagination limit from configuration
        const maxIssues = vscode.workspace.getConfiguration('beadsKanban').get('maxIssues', 1000);
        // 1) Load issues + derived readiness and blockedness via views
        const issues = this.queryAll(`
        SELECT
          i.id,
          i.title,
          i.description,
          i.status,
          i.priority,
          i.issue_type,
          i.assignee,
          i.estimated_minutes,
          i.created_at,
          i.updated_at,
          i.closed_at,
          i.external_ref,
          i.acceptance_criteria,
          i.design,
          i.notes,
          i.due_at,
          i.defer_until,
          CASE WHEN ri.id IS NOT NULL THEN 1 ELSE 0 END AS is_ready,
          COALESCE(bi.blocked_by_count, 0) AS blocked_by_count,
          i.pinned,
          i.is_template,
          i.ephemeral,
          i.event_kind,
          i.actor,
          i.target,
          i.payload,
          i.sender,
          i.mol_type,
          i.role_type,
          i.rig,
          i.agent_state,
          i.last_activity,
          i.hook_bead,
          i.role_bead,
          i.await_type,
          i.await_id,
          i.timeout_ns,
          i.waiters
        FROM issues i
        LEFT JOIN ready_issues ri ON ri.id = i.id
        LEFT JOIN blocked_issues bi ON bi.id = i.id
        WHERE i.deleted_at IS NULL
        ORDER BY i.priority ASC, i.updated_at DESC, i.created_at DESC
        LIMIT ${maxIssues + 1};
      `);
        // Check if we hit the pagination limit
        const hasMoreIssues = issues.length > maxIssues;
        if (hasMoreIssues) {
            // Trim to the actual limit
            issues.length = maxIssues;
            this.output.appendLine(`[BeadsAdapter] Loaded ${maxIssues} issues (more available). Increase beadsKanban.maxIssues setting to show more.`);
            vscode.window.showInformationMessage(`Beads Kanban: Showing ${maxIssues} most recent issues. ${hasMoreIssues ? 'Increase the maxIssues setting to show more.' : ''}`, 'Open Settings').then(action => {
                if (action === 'Open Settings') {
                    vscode.commands.executeCommand('workbench.action.openSettings', 'beadsKanban.maxIssues');
                }
            });
        }
        const ids = issues.map((i) => i.id);
        // 2) Bulk load labels
        const labelsByIssue = new Map();
        const parentMap = new Map();
        const childrenMap = new Map();
        const blockedByMap = new Map();
        const blocksMap = new Map();
        if (ids.length > 0) {
            const placeholders = ids.map(() => "?").join(",");
            // Fetch labels
            const labelRows = this.queryAll(`SELECT issue_id, label FROM labels WHERE issue_id IN (${placeholders}) ORDER BY label;`, ids);
            for (const r of labelRows) {
                const arr = labelsByIssue.get(r.issue_id) ?? [];
                arr.push(r.label);
                labelsByIssue.set(r.issue_id, arr);
            }
            // Fetch all relevant dependencies where either side is in our issue list
            // Note: We might miss titles if the "other side" isn't in 'ids' (filtered list?).
            // Actually, 'issues' query above fetches ALL issues (no WHERE clause except deleted_at IS NULL).
            // So 'ids' should check all.
            const allDeps = this.queryAll(`
        SELECT d.issue_id, d.depends_on_id, d.type, i1.title as issue_title, i2.title as depends_title,
               d.created_at, d.created_by, d.metadata, d.thread_id
        FROM dependencies d
        JOIN issues i1 ON i1.id = d.issue_id
        JOIN issues i2 ON i2.id = d.depends_on_id
        WHERE (d.issue_id IN (${placeholders}) OR d.depends_on_id IN (${placeholders}));
      `, [...ids, ...ids]);
            for (const d of allDeps) {
                const child = {
                    id: d.issue_id,
                    title: d.issue_title,
                    created_at: d.created_at,
                    created_by: d.created_by,
                    metadata: d.metadata,
                    thread_id: d.thread_id
                };
                const parent = {
                    id: d.depends_on_id,
                    title: d.depends_title,
                    created_at: d.created_at,
                    created_by: d.created_by,
                    metadata: d.metadata,
                    thread_id: d.thread_id
                };
                if (d.type === 'parent-child') {
                    // issue_id is child, depends_on_id is parent
                    parentMap.set(d.issue_id, parent);
                    const list = childrenMap.get(d.depends_on_id) ?? [];
                    list.push(child);
                    childrenMap.set(d.depends_on_id, list);
                }
                else if (d.type === 'blocks') {
                    // issue_id is BLOCKED BY depends_on_id
                    const blockedByList = blockedByMap.get(d.issue_id) ?? [];
                    blockedByList.push(parent); // parent here is just the blocker (depends_on_id)
                    blockedByMap.set(d.issue_id, blockedByList);
                    const blocksList = blocksMap.get(d.depends_on_id) ?? [];
                    blocksList.push(child); // child here is the blocked one (issue_id)
                    blocksMap.set(d.depends_on_id, blocksList);
                }
            }
            // Comments are lazy-loaded on demand (see getIssueComments method)
            // This significantly improves performance when loading large boards
        }
        const cards = issues.map((r) => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            priority: r.priority,
            issue_type: r.issue_type,
            assignee: r.assignee,
            estimated_minutes: r.estimated_minutes,
            created_at: r.created_at,
            updated_at: r.updated_at,
            closed_at: r.closed_at,
            external_ref: r.external_ref,
            is_ready: r.is_ready === 1,
            blocked_by_count: r.blocked_by_count,
            acceptance_criteria: r.acceptance_criteria,
            design: r.design,
            notes: r.notes,
            due_at: r.due_at,
            defer_until: r.defer_until,
            labels: labelsByIssue.get(r.id) ?? [],
            pinned: r.pinned === 1,
            is_template: r.is_template === 1,
            ephemeral: r.ephemeral === 1,
            event_kind: r.event_kind,
            actor: r.actor,
            target: r.target,
            payload: r.payload,
            sender: r.sender,
            mol_type: r.mol_type,
            role_type: r.role_type,
            rig: r.rig,
            agent_state: r.agent_state,
            last_activity: r.last_activity,
            hook_bead: r.hook_bead,
            role_bead: r.role_bead,
            await_type: r.await_type,
            await_id: r.await_id,
            timeout_ns: r.timeout_ns,
            waiters: r.waiters,
            parent: parentMap.get(r.id),
            children: childrenMap.get(r.id),
            blocked_by: blockedByMap.get(r.id),
            blocks: blocksMap.get(r.id),
            comments: [] // Comments are lazy-loaded on demand
        }));
        const columns = [
            { key: "ready", title: "Ready" },
            { key: "in_progress", title: "In Progress" },
            { key: "blocked", title: "Blocked" },
            { key: "closed", title: "Closed" }
        ];
        const boardData = { columns, cards };
        // Update cache
        this.boardCache = boardData;
        this.cacheTimestamp = Date.now();
        return boardData;
    }
    /**
     * Get comments for a specific issue (lazy-loaded on demand).
     * This method is called when the user opens the detail dialog for an issue.
     */
    async getIssueComments(issueId) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        const comments = this.queryAll(`
      SELECT id, issue_id, author, text, created_at
      FROM comments
      WHERE issue_id = ?
      ORDER BY created_at ASC;
    `, [issueId]);
        return comments;
    }
    async createIssue(input) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        const db = this.db;
        // Validate title
        const title = (input.title ?? "").trim();
        if (!title)
            throw new Error("Title is required.");
        // Generate beads-style ID: {prefix}-{3-char-hash}
        const prefix = await this.getIssuePrefix();
        const suffix = this.generateShortHash(title);
        const id = `${prefix}-${suffix}`;
        const description = input.description ?? "";
        const status = input.status ?? "open";
        const priority = input.priority ?? 2;
        const issueType = input.issue_type ?? "task";
        const assignee = input.assignee ?? null;
        const estimated = input.estimated_minutes ?? null;
        const acceptanceCriteria = input.acceptance_criteria ?? "";
        const design = input.design ?? "";
        const notes = input.notes ?? "";
        const externalRef = input.external_ref ?? null;
        const dueAt = input.due_at ?? null;
        const deferUntil = input.defer_until ?? null;
        this.runQuery(`
      INSERT INTO issues (
        id, title, description, status, priority, issue_type, assignee, estimated_minutes,
        acceptance_criteria, design, notes, external_ref, due_at, defer_until
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [id, title, description, status, priority, issueType, assignee, estimated,
            acceptanceCriteria, design, notes, externalRef, dueAt, deferUntil]);
        return { id };
    }
    async setIssueStatus(id, toStatus) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        const db = this.db;
        // Enforce closed_at CHECK constraint properly
        if (toStatus === "closed") {
            this.runQuery(`
        UPDATE issues
        SET status='closed',
            closed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL;
      `, [id]);
            return;
        }
        this.runQuery(`
      UPDATE issues
      SET status = ?,
      closed_at = NULL,
      updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      AND deleted_at IS NULL;
      `, [toStatus, id]);
    }
    async updateIssue(id, updates) {
        if (!this.db)
            await this.ensureConnected();
        const fields = [];
        const values = [];
        if (updates.title !== undefined) {
            fields.push("title = ?");
            values.push(updates.title);
        }
        if (updates.description !== undefined) {
            fields.push("description = ?");
            values.push(updates.description);
        }
        if (updates.priority !== undefined) {
            fields.push("priority = ?");
            values.push(updates.priority);
        }
        if (updates.issue_type !== undefined) {
            fields.push("issue_type = ?");
            values.push(updates.issue_type);
        }
        if (updates.assignee !== undefined) {
            fields.push("assignee = ?");
            values.push(updates.assignee);
        }
        if (updates.estimated_minutes !== undefined) {
            fields.push("estimated_minutes = ?");
            values.push(updates.estimated_minutes);
        }
        if (updates.acceptance_criteria !== undefined) {
            fields.push("acceptance_criteria = ?");
            values.push(updates.acceptance_criteria);
        }
        if (updates.design !== undefined) {
            fields.push("design = ?");
            values.push(updates.design);
        }
        if (updates.external_ref !== undefined) {
            fields.push("external_ref = ?");
            values.push(updates.external_ref);
        }
        if (updates.notes !== undefined) {
            fields.push("notes = ?");
            values.push(updates.notes);
        }
        if (updates.due_at !== undefined) {
            fields.push("due_at = ?");
            values.push(updates.due_at);
        }
        if (updates.defer_until !== undefined) {
            fields.push("defer_until = ?");
            values.push(updates.defer_until);
        }
        if (updates.status !== undefined) {
            // Validate status against allowed values
            const validStatuses = ['open', 'in_progress', 'blocked', 'closed'];
            if (!validStatuses.includes(updates.status)) {
                throw new Error(`Invalid status: ${updates.status}. Must be one of: ${validStatuses.join(', ')}`);
            }
            fields.push("status = ?");
            values.push(updates.status);
            // Set or clear closed_at based on status
            if (updates.status === 'closed') {
                fields.push("closed_at = CURRENT_TIMESTAMP");
            }
            else {
                fields.push("closed_at = NULL");
            }
        }
        if (fields.length === 0)
            return;
        fields.push("updated_at = CURRENT_TIMESTAMP");
        values.push(id);
        this.runQuery(`
      UPDATE issues
      SET ${fields.join(", ")}
      WHERE id = ? AND deleted_at IS NULL;
    `, values);
    }
    async addComment(issueId, text, author) {
        if (!this.db)
            await this.ensureConnected();
        this.runQuery(`
      INSERT INTO comments (issue_id, author, text)
      VALUES (?, ?, ?);
    `, [issueId, author, text]);
    }
    async addLabel(issueId, label) {
        if (!this.db)
            await this.ensureConnected();
        this.runQuery("INSERT OR IGNORE INTO labels (issue_id, label) VALUES (?, ?)", [issueId, label]);
    }
    async removeLabel(issueId, label) {
        if (!this.db)
            await this.ensureConnected();
        this.runQuery("DELETE FROM labels WHERE issue_id = ? AND label = ?", [issueId, label]);
    }
    async addDependency(issueId, dependsOnId, type = 'blocks') {
        if (!this.db)
            await this.ensureConnected();
        this.runQuery(`
      INSERT OR IGNORE INTO dependencies (issue_id, depends_on_id, type, created_by)
      VALUES (?, ?, ?, 'extension');
    `, [issueId, dependsOnId, type]);
    }
    async removeDependency(issueId, dependsOnId) {
        if (!this.db)
            await this.ensureConnected();
        this.runQuery("DELETE FROM dependencies WHERE issue_id = ? AND depends_on_id = ?", [issueId, dependsOnId]);
    }
    save() {
        if (!this.db || !this.dbPath)
            return;
        try {
            const data = this.db.export();
            const buffer = Buffer.from(data);
            // Track save time BEFORE rename to prevent race condition with file watcher
            this.lastSaveTime = Date.now();
            // Atomic write: write to temp file then rename
            const tmpPath = this.dbPath + '.tmp';
            fs.writeFileSync(tmpPath, buffer);
            // Retry rename operation with exponential backoff (handles Windows file locks)
            const maxRetries = 5;
            let lastError = null;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                    fs.renameSync(tmpPath, this.dbPath);
                    lastError = null;
                    break; // Success!
                }
                catch (error) {
                    lastError = error;
                    // Only retry on EPERM/EBUSY errors (file locked)
                    if (error instanceof Error &&
                        (error.message.includes('EPERM') || error.message.includes('EBUSY'))) {
                        if (attempt < maxRetries - 1) {
                            // Exponential backoff: 10ms, 20ms, 40ms, 80ms
                            const delayMs = 10 * Math.pow(2, attempt);
                            this.output.appendLine(`[BeadsAdapter] Rename failed (attempt ${attempt + 1}/${maxRetries}), retrying in ${delayMs}ms: ${error.message}`);
                            // Synchronous sleep for simplicity
                            const start = Date.now();
                            while (Date.now() - start < delayMs) {
                                // Busy wait (not ideal but simple for short delays)
                            }
                        }
                        else {
                            this.output.appendLine(`[BeadsAdapter] Rename failed after ${maxRetries} attempts: ${error.message}`);
                        }
                    }
                    else {
                        // Non-lock error, don't retry
                        throw error;
                    }
                }
            }
            // If we exhausted retries, throw the last error
            if (lastError) {
                // Clean up temp file
                try {
                    if (fs.existsSync(tmpPath)) {
                        fs.unlinkSync(tmpPath);
                    }
                }
                catch (e) {
                    // Ignore cleanup errors
                }
                throw lastError;
            }
            // Update mtime tracking
            try {
                const stats = fs.statSync(this.dbPath);
                this.lastKnownMtime = stats.mtimeMs;
            }
            catch (e) {
                this.output.appendLine(`[BeadsAdapter] Warning: Could not update mtime tracking: ${e}`);
            }
            this.output.appendLine('[BeadsAdapter] Database saved successfully');
        }
        catch (error) {
            const msg = `Failed to save database: ${error instanceof Error ? error.message : String(error)}`;
            this.output.appendLine(`[BeadsAdapter] ERROR: ${msg}`);
            // Show user-visible error (sanitized)
            vscode.window.showErrorMessage(`Beads Kanban: ${sanitizeError(error)}`);
            // Re-throw to prevent silent data loss
            throw new Error(msg);
        }
    }
    scheduleSave() {
        // Clear any existing timeout
        if (this.saveTimeout) {
            clearTimeout(this.saveTimeout);
        }
        // Schedule a new save after 100ms
        this.saveTimeout = setTimeout(() => {
            // Prevent concurrent saves
            if (this.isDirty && !this.isSaving) {
                this.isDirty = false; // Clear dirty flag before saving
                this.isSaving = true;
                try {
                    this.save();
                }
                catch (error) {
                    // If save failed, mark as dirty again
                    this.isDirty = true;
                    // Error already logged and shown in save()
                }
                finally {
                    this.isSaving = false;
                }
            }
            this.saveTimeout = null;
        }, 300); // 300ms debounce - prevents excessive file writes
    }
    queryAll(sql, params = []) {
        if (!this.db) {
            this.output.appendLine('[BeadsAdapter] Database not connected in queryAll, attempting reconnect...');
            throw new Error('Database not connected. Please reload the extension.');
        }
        let stmt;
        try {
            stmt = this.db.prepare(sql);
            stmt.bind(params);
            const rows = [];
            while (stmt.step()) {
                rows.push(stmt.getAsObject());
            }
            return rows;
        }
        finally {
            if (stmt) {
                stmt.free();
            }
        }
    }
    runQuery(sql, params = []) {
        if (!this.db) {
            this.output.appendLine('[BeadsAdapter] Database not connected in runQuery, attempting reconnect...');
            throw new Error('Database not connected. Please reload the extension.');
        }
        // Note: db.run() automatically frees prepared statements in sql.js
        // If you need to use db.prepare() manually in the future, you MUST call stmt.free()
        this.db.run(sql, params);
        this.isDirty = true;
        // Invalidate cache on mutation
        this.boardCache = null;
        this.cacheTimestamp = 0;
        this.scheduleSave();
    }
}
exports.BeadsAdapter = BeadsAdapter;

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
const sanitizeError_1 = require("./sanitizeError");
// sanitizeError is now imported from ./sanitizeError
class Mutex {
    _queue = [];
    _locked = false;
    acquire() {
        if (!this._locked) {
            this._locked = true;
            return Promise.resolve();
        }
        return new Promise(resolve => this._queue.push({ resolve }));
    }
    release() {
        if (this._queue.length > 0) {
            const next = this._queue.shift();
            next?.resolve();
        }
        else {
            this._locked = false;
        }
    }
}
class BeadsAdapter {
    output;
    db = null;
    dbPath = null;
    saveTimeout = null;
    isDirty = false;
    isSaving = false;
    isReloading = false; // Prevent concurrent mutations during database reload
    lastSaveTime = 0;
    lastKnownMtime = 0; // Track file modification time to detect external changes
    // Lock for save operations to prevent race conditions
    saveMutex = new Mutex();
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
        // Acquire lock
        await this.saveMutex.acquire();
        try {
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
            // If save is in progress (shouldn't happen but be defensive), wait for it with timeout
            let saveWaitAttempts = 0;
            const MAX_SAVE_WAIT_ATTEMPTS = 200; // 200 * 50ms = 10 seconds max wait
            while (this.isSaving && saveWaitAttempts < MAX_SAVE_WAIT_ATTEMPTS) {
                await new Promise(resolve => setTimeout(resolve, 50));
                saveWaitAttempts++;
            }
            if (this.isSaving) {
                this.output.appendLine('[BeadsAdapter] WARNING: Save timeout - isSaving flag stuck. Forcing completion.');
                this.isSaving = false; // Force reset to prevent permanent hang
                throw new Error('Timeout waiting for save completion after 10 seconds');
            }
            this.output.appendLine('[BeadsAdapter] Pending saves flushed successfully');
        }
        finally {
            // Always release lock
            this.saveMutex.release();
        }
    }
    async reloadDatabase() {
        // Set reload lock BEFORE flushing saves to prevent race condition
        // This ensures no mutations can occur between save lock release and reload lock acquisition
        this.isReloading = true;
        try {
            // CRITICAL: Flush any pending saves before reloading to prevent data loss
            await this.flushPendingSaves();
            if (!this.dbPath) {
                this.output.appendLine('[BeadsAdapter] reloadDatabase: No database path set, calling ensureConnected');
                await this.ensureConnected();
                return;
            }
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
        finally {
            // Always clear reload lock
            this.isReloading = false;
        }
    }
    /**
     * Wait for any ongoing database reload to complete before proceeding with mutations.
     * This prevents the race condition where mutations occur during reload.
     */
    async waitForReloadComplete() {
        let reloadWaitAttempts = 0;
        const MAX_RELOAD_WAIT_ATTEMPTS = 400; // 400 * 50ms = 20 seconds max wait
        while (this.isReloading && reloadWaitAttempts < MAX_RELOAD_WAIT_ATTEMPTS) {
            this.output.appendLine('[BeadsAdapter] Waiting for database reload to complete...');
            await new Promise(resolve => setTimeout(resolve, 50));
            reloadWaitAttempts++;
        }
        if (this.isReloading) {
            this.output.appendLine('[BeadsAdapter] WARNING: Reload timeout - isReloading flag stuck. Forcing completion.');
            this.isReloading = false; // Force reset to prevent permanent hang
            throw new Error('Timeout waiting for database reload completion after 20 seconds');
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
     * Check if we recently saved the file ourselves (within last 3 seconds)
     * or if a save is currently in progress.
     * This helps avoid reloading our own writes and prevents race conditions.
     */
    isRecentSelfSave() {
        // If currently saving, definitely consider it a recent self save
        if (this.isSaving) {
            return true;
        }
        // Check if we saved within the last 3 seconds
        if (this.lastSaveTime === 0)
            return false;
        const timeSinceLastSave = Date.now() - this.lastSaveTime;
        return timeSinceLastSave < 3000; // 3 second window (increased from 2s to prevent edge cases)
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
            // Clear pending changes flag - changes were already flushed
            this.isDirty = false;
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
        LIMIT ?;
      `, [maxIssues + 1]);
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
            // Conditionally fetch dependencies based on configuration
            const lazyLoadDependencies = vscode.workspace.getConfiguration('beadsKanban').get('lazyLoadDependencies', true);
            if (!lazyLoadDependencies) {
                // Eager load all dependencies with batching to avoid N+1 problem
                // Warning if attempting to eager load with many issues
                if (ids.length > 500) {
                    this.output.appendLine(`[BeadsAdapter] Warning: Eager loading dependencies for ${ids.length} issues. Consider enabling lazyLoadDependencies for better performance.`);
                }
                // Batch dependencies loading to avoid loading too much data at once
                const BATCH_SIZE = 100;
                const allDeps = [];
                for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                    const batch = ids.slice(i, Math.min(i + BATCH_SIZE, ids.length));
                    const batchPlaceholders = batch.map(() => '?').join(', ');
                    const batchDeps = this.queryAll(`
            SELECT d.issue_id, d.depends_on_id, d.type, i1.title as issue_title, i2.title as depends_title,
                   d.created_at, d.created_by, d.metadata, d.thread_id
            FROM dependencies d
            JOIN issues i1 ON i1.id = d.issue_id
            JOIN issues i2 ON i2.id = d.depends_on_id
            WHERE (d.issue_id IN (${batchPlaceholders}) OR d.depends_on_id IN (${batchPlaceholders}));
          `, [...batch, ...batch]);
                    allDeps.push(...batchDeps);
                }
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
            }
            // else: dependencies are lazy-loaded on demand (see getIssueDependencies method)
            // Comments are lazy-loaded on demand (see getIssueComments method)
            // Dependencies can also be lazy-loaded if beadsKanban.lazyLoadDependencies is enabled (default: true)
            // This significantly improves performance when loading large boards with many dependencies
        }
        // Check if dependencies should be lazy-loaded
        const lazyLoadDependencies = vscode.workspace.getConfiguration('beadsKanban').get('lazyLoadDependencies', true);
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
            // Dependencies: lazy-loaded if enabled (default), eagerly loaded if disabled
            parent: lazyLoadDependencies ? undefined : parentMap.get(r.id),
            children: lazyLoadDependencies ? undefined : childrenMap.get(r.id),
            blocked_by: lazyLoadDependencies ? undefined : blockedByMap.get(r.id),
            blocks: lazyLoadDependencies ? undefined : blocksMap.get(r.id),
            comments: [] // Comments are lazy-loaded on demand
        }));
        const columns = [
            { key: "ready", title: "Ready" },
            { key: "in_progress", title: "In Progress" },
            { key: "blocked", title: "Blocked" },
            { key: "closed", title: "Closed" }
        ];
        const boardData = { columns, cards };
        return boardData;
    }
    // Phase 3: Fast minimal board loading for 3-tier progressive architecture
    // Returns MinimalCard[] with only 13 core fields, no relationships/comments
    // Expected performance: <100ms for 400 issues (vs 300-500ms for full getBoard)
    async getBoardMinimal() {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        // Check if database file was modified externally
        const fileChanged = await this.hasFileChangedExternally();
        if (fileChanged && !this.isRecentSelfSave()) {
            this.output.appendLine('[BeadsAdapter] External database change detected, reloading from disk');
            await this.reloadFromDisk();
        }
        // Fast query with enriched fields (assignee, labels, etc.) for better card display
        // Uses GROUP_CONCAT for labels - minimal overhead vs pure MinimalCard
        const rows = this.queryAll(`
      SELECT
        i.id,
        i.title,
        i.description,
        i.status,
        i.priority,
        i.issue_type,
        i.created_at,
        COALESCE(ic.creator, 'unknown') AS created_by,
        i.updated_at,
        i.closed_at,
        CASE WHEN i.status = 'closed' AND i.closed_at IS NOT NULL 
          THEN 'completed' 
          ELSE NULL 
        END AS close_reason,
        (SELECT COUNT(*) FROM dependencies d WHERE d.issue_id = i.id) AS dependency_count,
        (SELECT COUNT(*) FROM dependencies d WHERE d.depends_on_id = i.id) AS dependent_count,
        i.assignee,
        i.estimated_minutes,
        i.external_ref,
        i.pinned,
        (SELECT COUNT(*) FROM dependencies d WHERE d.issue_id = i.id AND d.type = 'blocks') AS blocked_by_count,
        GROUP_CONCAT(l.label, '|||') AS labels_str
      FROM issues i
      LEFT JOIN issue_creators ic ON ic.issue_id = i.id
      LEFT JOIN labels l ON l.issue_id = i.id
      WHERE i.deleted_at IS NULL
      GROUP BY i.id
      ORDER BY i.priority ASC, i.updated_at DESC, i.created_at DESC
      LIMIT 10000;
    `);
        const cards = rows.map(r => ({
            id: r.id,
            title: r.title,
            description: r.description,
            status: r.status,
            priority: r.priority,
            issue_type: r.issue_type,
            created_at: r.created_at,
            created_by: r.created_by,
            updated_at: r.updated_at,
            closed_at: r.closed_at,
            close_reason: r.close_reason,
            dependency_count: r.dependency_count,
            dependent_count: r.dependent_count,
            assignee: r.assignee,
            estimated_minutes: r.estimated_minutes,
            external_ref: r.external_ref,
            pinned: r.pinned === 1,
            blocked_by_count: r.blocked_by_count,
            labels: r.labels_str ? r.labels_str.split('|||') : []
        }));
        this.output.appendLine(`[BeadsAdapter] getBoardMinimal() loaded ${cards.length} enriched cards`);
        return cards;
    }
    // Phase 3: Load full issue details on-demand for edit dialog
    // Returns FullCard with all fields including relationships and comments
    // Expected performance: <50ms per issue
    async getIssueFull(issueId) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        // Load main issue data
        const rows = this.queryAll(`
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
        i.waiters,
        COALESCE(ic.creator, 'unknown') AS created_by
      FROM issues i
      LEFT JOIN ready_issues ri ON ri.id = i.id
      LEFT JOIN blocked_issues bi ON bi.id = i.id
      LEFT JOIN issue_creators ic ON ic.issue_id = i.id
      WHERE i.id = ? AND i.deleted_at IS NULL
      LIMIT 1;
    `, [issueId]);
        if (rows.length === 0) {
            throw new Error(`Issue not found: ${issueId}`);
        }
        const issue = rows[0];
        // Load dependency counts
        const depCounts = this.queryAll(`
      SELECT
        (SELECT COUNT(*) FROM dependencies d WHERE d.issue_id = ?) AS dependency_count,
        (SELECT COUNT(*) FROM dependencies d WHERE d.depends_on_id = ?) AS dependent_count;
    `, [issueId, issueId]);
        const dependency_count = depCounts[0]?.dependency_count || 0;
        const dependent_count = depCounts[0]?.dependent_count || 0;
        // Load labels
        const labelRows = this.queryAll(`SELECT label FROM labels WHERE issue_id = ? ORDER BY label;`, [issueId]);
        const labels = labelRows.map(r => r.label);
        // Load comments
        const commentRows = this.queryAll(`SELECT id, author, text, created_at FROM comments WHERE issue_id = ? ORDER BY created_at ASC;`, [issueId]);
        const comments = commentRows.map(c => ({
            id: c.id,
            issue_id: issueId,
            author: c.author,
            text: c.text,
            created_at: c.created_at
        }));
        // Load dependencies (parent, children, blocks, blocked_by)
        const deps = this.queryAll(`
      SELECT 
        d.issue_id,
        d.depends_on_id,
        d.type,
        i1.title as issue_title,
        i2.title as depends_title,
        d.created_at,
        d.created_by,
        d.metadata,
        d.thread_id
      FROM dependencies d
      JOIN issues i1 ON i1.id = d.issue_id
      JOIN issues i2 ON i2.id = d.depends_on_id
      WHERE d.issue_id = ? OR d.depends_on_id = ?;
    `, [issueId, issueId]);
        let parent;
        const children = [];
        const blocked_by = [];
        const blocks = [];
        for (const d of deps) {
            const child = {
                id: d.issue_id,
                title: d.issue_title,
                created_at: d.created_at,
                created_by: d.created_by,
                metadata: d.metadata,
                thread_id: d.thread_id
            };
            const parentDep = {
                id: d.depends_on_id,
                title: d.depends_title,
                created_at: d.created_at,
                created_by: d.created_by,
                metadata: d.metadata,
                thread_id: d.thread_id
            };
            if (d.type === 'parent-child') {
                if (d.issue_id === issueId) {
                    // This issue is the child, depends_on_id is the parent
                    parent = parentDep;
                }
                else {
                    // This issue is the parent, issue_id is the child
                    children.push(child);
                }
            }
            else if (d.type === 'blocks') {
                if (d.issue_id === issueId) {
                    // This issue is blocked by depends_on_id
                    blocked_by.push(parentDep);
                }
                else {
                    // This issue blocks issue_id
                    blocks.push(child);
                }
            }
        }
        // Map to FullCard
        const fullCard = {
            id: issue.id,
            title: issue.title,
            description: issue.description,
            status: issue.status,
            priority: issue.priority,
            issue_type: issue.issue_type,
            created_at: issue.created_at,
            created_by: issue.created_by || 'unknown',
            updated_at: issue.updated_at,
            closed_at: issue.closed_at,
            close_reason: issue.status === 'closed' && issue.closed_at ? 'completed' : null,
            dependency_count,
            dependent_count,
            assignee: issue.assignee,
            estimated_minutes: issue.estimated_minutes,
            labels,
            external_ref: issue.external_ref,
            pinned: issue.pinned === 1,
            blocked_by_count: issue.blocked_by_count,
            acceptance_criteria: issue.acceptance_criteria,
            design: issue.design,
            notes: issue.notes,
            due_at: issue.due_at,
            defer_until: issue.defer_until,
            is_ready: issue.is_ready === 1,
            is_template: issue.is_template === 1,
            ephemeral: issue.ephemeral === 1,
            event_kind: issue.event_kind,
            actor: issue.actor,
            target: issue.target,
            payload: issue.payload,
            sender: issue.sender,
            mol_type: issue.mol_type,
            role_type: issue.role_type,
            rig: issue.rig,
            agent_state: issue.agent_state,
            last_activity: issue.last_activity,
            hook_bead: issue.hook_bead,
            role_bead: issue.role_bead,
            await_type: issue.await_type,
            await_id: issue.await_id,
            timeout_ns: issue.timeout_ns,
            waiters: issue.waiters,
            parent,
            children,
            blocks,
            blocked_by,
            comments
        };
        this.output.appendLine(`[BeadsAdapter] getIssueFull(${issueId}) loaded full card`);
        return fullCard;
    }
    /**
     * Get board metadata (columns only) without loading any cards.
     * Used for incremental loading to avoid fetching all issues.
     */
    async getBoardMetadata() {
        // Ensure database connection but don't load any issues
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        // Check if database file was modified externally
        const fileChanged = await this.hasFileChangedExternally();
        if (fileChanged && !this.isRecentSelfSave()) {
            this.output.appendLine('[BeadsAdapter] External database change detected, reloading from disk');
            await this.reloadFromDisk();
        }
        const columns = [
            { key: "ready", title: "Ready" },
            { key: "in_progress", title: "In Progress" },
            { key: "blocked", title: "Blocked" },
            { key: "closed", title: "Closed" }
        ];
        // Return only columns, no cards - cards will be loaded via getColumnData
        return { columns, cards: [] };
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
    /**
     * Get dependencies for a specific issue (lazy-loaded on demand).
     * This method is called when the user opens the detail dialog for an issue.
     * Returns parent, children, blocked_by, and blocks relationships.
     */
    async getIssueDependencies(issueId) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        const allDeps = this.queryAll(`
      SELECT d.issue_id, d.depends_on_id, d.type, i1.title as issue_title, i2.title as depends_title,
             d.created_at, d.created_by, d.metadata, d.thread_id
      FROM dependencies d
      JOIN issues i1 ON i1.id = d.issue_id
      JOIN issues i2 ON i2.id = d.depends_on_id
      WHERE d.issue_id = ? OR d.depends_on_id = ?;
    `, [issueId, issueId]);
        let parent;
        const children = [];
        const blocked_by = [];
        const blocks = [];
        for (const d of allDeps) {
            const child = {
                id: d.issue_id,
                title: d.issue_title,
                created_at: d.created_at,
                created_by: d.created_by,
                metadata: d.metadata,
                thread_id: d.thread_id
            };
            const parentInfo = {
                id: d.depends_on_id,
                title: d.depends_title,
                created_at: d.created_at,
                created_by: d.created_by,
                metadata: d.metadata,
                thread_id: d.thread_id
            };
            if (d.type === 'parent-child') {
                if (d.issue_id === issueId) {
                    // This issue is the child, depends_on_id is the parent
                    parent = parentInfo;
                }
                else {
                    // This issue is the parent, issue_id is the child
                    children.push(child);
                }
            }
            else if (d.type === 'blocks') {
                if (d.issue_id === issueId) {
                    // This issue is blocked by depends_on_id
                    blocked_by.push(parentInfo);
                }
                else {
                    // This issue blocks issue_id
                    blocks.push(child);
                }
            }
        }
        return {
            parent: parent,
            children: children.length > 0 ? children : undefined,
            blocked_by: blocked_by.length > 0 ? blocked_by : undefined,
            blocks: blocks.length > 0 ? blocks : undefined
        };
    }
    /**
     * Get the count of issues in a specific column.
     * Uses the same logic as getBoard() for column determination.
     */
    async getColumnCount(column) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        let query;
        const params = [];
        switch (column) {
            case 'ready':
                // Ready: open status AND in ready_issues view
                query = `
          SELECT COUNT(*) as count
          FROM issues i
          INNER JOIN ready_issues ri ON ri.id = i.id
          WHERE i.status = 'open' AND i.deleted_at IS NULL;
        `;
                break;
            case 'in_progress':
                // In Progress: status = in_progress
                query = `
          SELECT COUNT(*) as count
          FROM issues
          WHERE status = 'in_progress' AND deleted_at IS NULL;
        `;
                break;
            case 'blocked':
                // Blocked: status = blocked OR has blockers OR (open but not ready)
                query = `
          SELECT COUNT(DISTINCT i.id) as count
          FROM issues i
          LEFT JOIN ready_issues ri ON ri.id = i.id
          LEFT JOIN blocked_issues bi ON bi.id = i.id
          WHERE i.deleted_at IS NULL
            AND (
              i.status = 'blocked'
              OR COALESCE(bi.blocked_by_count, 0) > 0
              OR (i.status = 'open' AND ri.id IS NULL)
            );
        `;
                break;
            case 'closed':
                // Closed: status = closed
                query = `
          SELECT COUNT(*) as count
          FROM issues
          WHERE status = 'closed' AND deleted_at IS NULL;
        `;
                break;
            default:
                throw new Error(`Unknown column: ${column}`);
        }
        const result = this.queryAll(query, params);
        return result.length > 0 ? result[0].count : 0;
    }
    /**
     * Get paginated issues for a specific column.
     * Returns BoardCard[] matching the same format as getBoard().
     */
    async getColumnData(column, offset = 0, limit = 50) {
        if (!this.db)
            await this.ensureConnected();
        if (!this.db)
            throw new Error('Failed to connect to database');
        let whereClause;
        const params = [];
        switch (column) {
            case 'ready':
                // Ready: open status AND in ready_issues view
                whereClause = `
          i.status = 'open'
          AND i.id IN (SELECT id FROM ready_issues)
          AND i.deleted_at IS NULL
        `;
                break;
            case 'in_progress':
                // In Progress: status = in_progress
                whereClause = `
          i.status = 'in_progress'
          AND i.deleted_at IS NULL
        `;
                break;
            case 'blocked':
                // Blocked: status = blocked OR has blockers OR (open but not ready)
                whereClause = `
          i.deleted_at IS NULL
          AND (
            i.status = 'blocked'
            OR COALESCE(bi.blocked_by_count, 0) > 0
            OR (i.status = 'open' AND ri.id IS NULL)
          )
        `;
                break;
            case 'closed':
                // Closed: status = closed
                whereClause = `
          i.status = 'closed'
          AND i.deleted_at IS NULL
        `;
                break;
            default:
                throw new Error(`Unknown column: ${column}`);
        }
        // Add pagination parameters to params array
        params.push(limit, offset);
        // Build the main query (same structure as getBoard)
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
      WHERE ${whereClause}
      ORDER BY i.priority ASC, i.updated_at DESC, i.created_at DESC
      LIMIT ? OFFSET ?;
    `, params);
        if (issues.length === 0) {
            return [];
        }
        const ids = issues.map((i) => i.id);
        // Bulk load labels and dependencies (same as getBoard)
        const labelsByIssue = new Map();
        const parentMap = new Map();
        const childrenMap = new Map();
        const blockedByMap = new Map();
        const blocksMap = new Map();
        if (ids.length > 0) {
            const placeholders = ids.map(() => "?").join(",");
            // Fetch labels
            const labelRows = this.queryAll(`
        SELECT issue_id, label
        FROM labels
        WHERE issue_id IN (${placeholders})
        ORDER BY label;
      `, ids);
            for (const r of labelRows) {
                const arr = labelsByIssue.get(r.issue_id) ?? [];
                arr.push(r.label);
                labelsByIssue.set(r.issue_id, arr);
            }
            // Conditionally fetch dependencies based on configuration
            const lazyLoadDependencies = vscode.workspace.getConfiguration('beadsKanban').get('lazyLoadDependencies', true);
            if (!lazyLoadDependencies) {
                // Eager load dependencies with batching to avoid N+1 problem
                if (ids.length > 500) {
                    this.output.appendLine(`[BeadsAdapter] Warning: Eager loading dependencies for ${ids.length} issues. Consider enabling lazyLoadDependencies for better performance.`);
                }
                const BATCH_SIZE = 100;
                const allDeps = [];
                for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                    const batch = ids.slice(i, Math.min(i + BATCH_SIZE, ids.length));
                    const batchPlaceholders = batch.map(() => '?').join(', ');
                    const batchDeps = this.queryAll(`
            SELECT d.issue_id, d.depends_on_id, d.type, i1.title as issue_title, i2.title as depends_title,
                   d.created_at, d.created_by, d.metadata, d.thread_id
            FROM dependencies d
            JOIN issues i1 ON i1.id = d.issue_id
            JOIN issues i2 ON i2.id = d.depends_on_id
            WHERE (d.issue_id IN (${batchPlaceholders}) OR d.depends_on_id IN (${batchPlaceholders}));
          `, [...batch, ...batch]);
                    allDeps.push(...batchDeps);
                }
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
                        parentMap.set(d.issue_id, parent);
                        const list = childrenMap.get(d.depends_on_id) ?? [];
                        list.push(child);
                        childrenMap.set(d.depends_on_id, list);
                    }
                    else if (d.type === 'blocks') {
                        const blockedByList = blockedByMap.get(d.issue_id) ?? [];
                        blockedByList.push(parent);
                        blockedByMap.set(d.issue_id, blockedByList);
                        const blocksList = blocksMap.get(d.depends_on_id) ?? [];
                        blocksList.push(child);
                        blocksMap.set(d.depends_on_id, blocksList);
                    }
                }
            }
            // else: dependencies are lazy-loaded on demand (see getIssueDependencies method)
        }
        // Check if dependencies should be lazy-loaded (reuse the same config value)
        const lazyLoadDependencies = vscode.workspace.getConfiguration('beadsKanban').get('lazyLoadDependencies', true);
        // Map to BoardCard format (same as getBoard)
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
            // Dependencies: lazy-loaded if enabled (default), eagerly loaded if disabled
            parent: lazyLoadDependencies ? undefined : parentMap.get(r.id),
            children: lazyLoadDependencies ? undefined : childrenMap.get(r.id),
            blocked_by: lazyLoadDependencies ? undefined : blockedByMap.get(r.id),
            blocks: lazyLoadDependencies ? undefined : blocksMap.get(r.id),
            comments: [] // Comments are lazy-loaded on demand
        }));
        return cards;
    }
    /**
     * Get paginated table data with server-side filtering and sorting.
     *
     * @param filters Object containing filter criteria
     * @param sorting Array of { id: string, dir: 'asc'|'desc' } for sorting
     * @param offset Starting row index (0-based)
     * @param limit Number of rows to return
     * @returns Object containing filtered/sorted cards and total count
     */
    async getTableData(filters, sorting, offset, limit) {
        if (!this.db)
            await this.ensureConnected();
        this.output.appendLine(`[BeadsAdapter] getTableData: offset=${offset}, limit=${limit}, filters=${JSON.stringify(filters)}, sorting=${JSON.stringify(sorting)}`);
        // Build WHERE clause from filters
        const whereClauses = ['deleted_at IS NULL'];
        const whereParams = [];
        if (filters.search) {
            const searchTerm = `%${filters.search}%`;
            whereClauses.push('(title LIKE ? OR id LIKE ? OR description LIKE ?)');
            whereParams.push(searchTerm, searchTerm, searchTerm);
        }
        if (filters.priority) {
            whereClauses.push('priority = ?');
            whereParams.push(parseInt(filters.priority));
        }
        if (filters.type) {
            whereClauses.push('issue_type = ?');
            whereParams.push(filters.type);
        }
        if (filters.status) {
            if (filters.status === 'not_closed') {
                whereClauses.push('status != ?');
                whereParams.push('closed');
            }
            else if (filters.status === 'active') {
                whereClauses.push('(status = ? OR status = ?)');
                whereParams.push('in_progress', 'open');
            }
            else if (filters.status === 'blocked') {
                whereClauses.push('status = ?');
                whereParams.push('blocked');
            }
            else if (filters.status !== 'all') {
                whereClauses.push('status = ?');
                whereParams.push(filters.status);
            }
        }
        if (filters.assignee) {
            if (filters.assignee === 'unassigned') {
                whereClauses.push('assignee IS NULL');
            }
            else {
                whereClauses.push('assignee = ?');
                whereParams.push(filters.assignee);
            }
        }
        // For labels filter, need to check if issue has ALL specified labels
        if (filters.labels && filters.labels.length > 0) {
            // Use EXISTS subquery to check for all labels
            const labelChecks = filters.labels.map(() => 'EXISTS (SELECT 1 FROM labels WHERE labels.issue_id = issues.id AND labels.label = ?)').join(' AND ');
            whereClauses.push(`(${labelChecks})`);
            whereParams.push(...filters.labels);
        }
        const whereClause = whereClauses.join(' AND ');
        // Build ORDER BY clause from sorting
        let orderByClause = '';
        if (sorting && sorting.length > 0) {
            const orderByClauses = sorting.map(sort => {
                // Map column IDs to database columns
                const columnMap = {
                    'id': 'id',
                    'title': 'title',
                    'status': 'status',
                    'priority': 'priority',
                    'type': 'issue_type',
                    'assignee': 'assignee',
                    'created': 'created_at',
                    'updated': 'updated_at',
                    'closed': 'closed_at'
                };
                const dbColumn = columnMap[sort.id] || 'updated_at';
                const direction = sort.dir === 'asc' ? 'ASC' : 'DESC';
                return `${dbColumn} ${direction}`;
            });
            orderByClause = 'ORDER BY ' + orderByClauses.join(', ');
        }
        else {
            // Default sort: updated_at desc
            orderByClause = 'ORDER BY updated_at DESC';
        }
        // Get total count (without pagination)
        const countResult = this.queryAll(`
            SELECT COUNT(*) as total
            FROM issues
            WHERE ${whereClause}
        `, whereParams);
        const totalCount = countResult[0]?.total || 0;
        this.output.appendLine(`[BeadsAdapter] Total matching rows: ${totalCount}`);
        // Get paginated results
        const rows = this.queryAll(`
            SELECT 
                id, title, description, status, priority, issue_type as type, assignee,
                estimated_minutes, created_at, updated_at, closed_at, external_ref,
                acceptance_criteria, design, notes, due_at, defer_until, pinned,
                is_template, ephemeral, event_type, event_data, agent_id,
                agent_metadata, agent_session_id, run_id
            FROM issues
            WHERE ${whereClause}
            ${orderByClause}
            LIMIT ? OFFSET ?
        `, [...whereParams, limit, offset]);
        this.output.appendLine(`[BeadsAdapter] Fetched ${rows.length} rows for current page`);
        // Fetch labels for the paginated results (skip dependencies for table view performance)
        const ids = rows.map((r) => r.id);
        const labelsMap = new Map();
        if (ids.length > 0) {
            // Fetch labels in batches
            const BATCH_SIZE = 100;
            for (let i = 0; i < ids.length; i += BATCH_SIZE) {
                const batch = ids.slice(i, Math.min(i + BATCH_SIZE, ids.length));
                const placeholders = batch.map(() => '?').join(', ');
                const labelRows = this.queryAll(`
                    SELECT issue_id, label
                    FROM labels
                    WHERE issue_id IN (${placeholders})
                `, batch);
                for (const row of labelRows) {
                    if (!labelsMap.has(row.issue_id)) {
                        labelsMap.set(row.issue_id, []);
                    }
                    labelsMap.get(row.issue_id).push(row.label);
                }
            }
        }
        // Build BoardCard objects
        const cards = rows.map((row) => ({
            id: row.id,
            title: row.title,
            description: row.description || '',
            status: row.status,
            priority: row.priority,
            issue_type: row.type,
            assignee: row.assignee || undefined,
            labels: labelsMap.get(row.id) || [],
            estimated_minutes: row.estimated_minutes || undefined,
            created_at: row.created_at,
            updated_at: row.updated_at,
            closed_at: row.closed_at || undefined,
            external_ref: row.external_ref || undefined,
            acceptance_criteria: row.acceptance_criteria || '',
            design: row.design || '',
            notes: row.notes || '',
            due_at: row.due_at || undefined,
            defer_until: row.defer_until || undefined,
            pinned: row.pinned === 1,
            is_template: row.is_template === 1,
            ephemeral: row.ephemeral === 1,
            // Table view doesn't need is_ready/blocked_by_count, but they're required by BoardCard
            is_ready: false,
            blocked_by_count: 0,
            // Event/agent metadata
            event_kind: row.event_type || undefined,
            actor: row.agent_id || undefined,
            target: undefined,
            payload: row.event_data ? JSON.stringify(row.event_data) : undefined,
            sender: undefined,
            mol_type: undefined,
            role_type: undefined,
            rig: undefined,
            agent_state: undefined,
            last_activity: undefined,
            hook_bead: undefined,
            role_bead: undefined,
            await_type: undefined,
            await_id: undefined,
            timeout_ns: undefined,
            waiters: undefined,
            // Dependencies: not loaded for table view (performance)
            parent: undefined,
            children: undefined,
            blocked_by: undefined,
            blocks: undefined,
            comments: []
        }));
        this.output.appendLine(`[BeadsAdapter] Built ${cards.length} BoardCard objects`);
        return { cards, totalCount };
    }
    async createIssue(input) {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
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
        const pinned = input.pinned ? 1 : 0;
        const isTemplate = input.is_template ? 1 : 0;
        const ephemeral = input.ephemeral ? 1 : 0;
        this.runQuery(`
      INSERT INTO issues (
        id, title, description, status, priority, issue_type, assignee, estimated_minutes,
        acceptance_criteria, design, notes, external_ref, due_at, defer_until,
        pinned, is_template, ephemeral
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `, [id, title, description, status, priority, issueType, assignee, estimated,
            acceptanceCriteria, design, notes, externalRef, dueAt, deferUntil,
            pinned, isTemplate, ephemeral]);
        // Insert labels if provided
        if (input.labels && input.labels.length > 0) {
            for (const label of input.labels) {
                this.runQuery(`INSERT INTO labels (issue_id, label) VALUES (?, ?)`, [id, label]);
            }
        }
        // Insert parent dependency if provided
        if (input.parent_id) {
            this.runQuery(`INSERT INTO dependencies (issue_id, depends_on_id, type) VALUES (?, ?, 'parent-child')`, [id, input.parent_id]);
        }
        // Insert blocker dependencies if provided
        if (input.blocked_by_ids && input.blocked_by_ids.length > 0) {
            for (const blockerId of input.blocked_by_ids) {
                this.runQuery(`INSERT INTO dependencies (issue_id, depends_on_id, type) VALUES (?, ?, 'blocks')`, [id, blockerId]);
            }
        }
        // Insert children (set parent on each child)
        if (input.children_ids && input.children_ids.length > 0) {
            for (const childId of input.children_ids) {
                this.runQuery(`INSERT INTO dependencies (issue_id, depends_on_id, type) VALUES (?, ?, 'parent-child')`, [childId, id]);
            }
        }
        return { id };
    }
    async setIssueStatus(id, toStatus) {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
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
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
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
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
        if (!this.db)
            await this.ensureConnected();
        this.runQuery(`
      INSERT INTO comments (issue_id, author, text)
      VALUES (?, ?, ?);
    `, [issueId, author, text]);
    }
    async addLabel(issueId, label) {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
        if (!this.db)
            await this.ensureConnected();
        this.runQuery("INSERT OR IGNORE INTO labels (issue_id, label) VALUES (?, ?)", [issueId, label]);
    }
    async removeLabel(issueId, label) {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
        if (!this.db)
            await this.ensureConnected();
        this.runQuery("DELETE FROM labels WHERE issue_id = ? AND label = ?", [issueId, label]);
    }
    async addDependency(issueId, dependsOnId, type = 'blocks') {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
        if (!this.db)
            await this.ensureConnected();
        this.runQuery(`
      INSERT OR IGNORE INTO dependencies (issue_id, depends_on_id, type, created_by)
      VALUES (?, ?, ?, 'extension');
    `, [issueId, dependsOnId, type]);
    }
    async removeDependency(issueId, dependsOnId) {
        // Wait for any ongoing reload to complete
        await this.waitForReloadComplete();
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
            // Rename temp file to final path
            // On Windows file lock errors (EPERM/EBUSY), we fail fast and let scheduleSave retry naturally
            try {
                fs.renameSync(tmpPath, this.dbPath);
            }
            catch (error) {
                // Clean up temp file on failure
                try {
                    if (fs.existsSync(tmpPath)) {
                        fs.unlinkSync(tmpPath);
                    }
                }
                catch (cleanupError) {
                    // Ignore cleanup errors
                }
                // Log and re-throw
                if (error instanceof Error &&
                    (error.message.includes('EPERM') || error.message.includes('EBUSY'))) {
                    this.output.appendLine(`[BeadsAdapter] Rename failed (file locked): ${error.message}. Will retry via scheduleSave.`);
                }
                throw error;
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
            vscode.window.showErrorMessage(`Beads Kanban: ${(0, sanitizeError_1.sanitizeError)(error)}`);
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
        this.scheduleSave();
    }
}
exports.BeadsAdapter = BeadsAdapter;

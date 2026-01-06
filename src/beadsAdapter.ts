import * as fs from "fs";
import * as path from "path";
import initSqlJs, { Database, QueryExecResult } from "sql.js";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { BoardCard, BoardData, BoardColumn, IssueRow, IssueStatus, Comment, DependencyInfo } from "./types";

// Sanitize error messages to prevent leaking implementation details
function sanitizeError(error: unknown): string {
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

export class BeadsAdapter {
  private db: Database | null = null;
  private dbPath: string | null = null;
  private saveTimeout: NodeJS.Timeout | null = null;
  private isDirty = false;

  constructor(private readonly output: vscode.OutputChannel) {}

  public dispose() {
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
      } catch (error) {
        this.output.appendLine(`[BeadsAdapter] Failed to flush changes on dispose: ${error}`);
      }
    }

    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
    this.dbPath = null;
  }

  public async ensureConnected(): Promise<void> {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      throw new Error("Open a folder workspace to use Beads Kanban.");
    }

    const beadsDir = path.join(ws.uri.fsPath, ".beads");
    if (!fs.existsSync(beadsDir) || !fs.statSync(beadsDir).isDirectory()) {
      throw new Error("No .beads directory found in the workspace root.");
    }

    const candidatePaths = fs
      .readdirSync(beadsDir)
      .filter((f) => /\.(db|sqlite|sqlite3)$/i.test(f))
      .map((f) => path.join(beadsDir, f))
      .filter((p) => {
        try {
          const stats = fs.lstatSync(p);
          if (stats.isSymbolicLink()) {
            this.output.appendLine(`[BeadsAdapter] Skipping symlink: ${p}`);
            return false;
          }
          return true;
        } catch (e) {
          this.output.appendLine(`[BeadsAdapter] Error checking ${p}: ${e}`);
          return false;
        }
      });

    if (candidatePaths.length === 0) {
      throw new Error("No SQLite database file found in .beads (expected *.db/*.sqlite/*.sqlite3).");
    }

    const failureReasons: string[] = [];
    
    // Initialize SQL.js
    const SQL = await initSqlJs({
       locateFile: (file) => path.join(__dirname, file)
    });

    // Find the DB that contains the `issues` table.
    for (const p of candidatePaths) {
      try {
        const filebuffer = fs.readFileSync(p);
        const db = new SQL.Database(filebuffer);
        
        // Check for issues table
        const res = db.exec("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='issues' LIMIT 1;");
        
        if (res.length > 0 && res[0].values.length > 0 && res[0].values[0][0] === 1) {
          const msg = `[BeadsAdapter] Connected to DB: ${p}`;
          this.output.appendLine(msg);
          this.db = db;
          this.dbPath = p;
          return;
        }

        const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table';");
        const tableNames = tablesRes.length > 0 ? tablesRes[0].values.map(v => v[0]).join(', ') : '';
        const reason = `File opened but 'issues' table missing. Tables found: [${tableNames}]`;

        this.output.appendLine(`[BeadsAdapter] ${p}: ${reason}`);
        failureReasons.push(`${path.basename(p)}: ${reason}`);
        
        db.close();
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        this.output.appendLine(`[BeadsAdapter] Candidate DB failed: ${p} (${msg})`);
        failureReasons.push(`${path.basename(p)}: ${msg}`);
      }
    }

    const fullError = `Could not find a valid Beads DB in .beads. Searched: ${candidatePaths.map(x => path.basename(x)).join(', ')}. Details:\n${failureReasons.join('\n')}`;
    this.output.appendLine(`[BeadsAdapter] ERROR: ${fullError}`);
    throw new Error(fullError);
  }

  public getConnectedDbPath(): string | null {
    return this.dbPath;
  }

  public async getBoard(): Promise<BoardData> {
    if (!this.db) await this.ensureConnected();
    if (!this.db) throw new Error('Failed to connect to database');
    const db = this.db;

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
        ORDER BY i.priority ASC, i.updated_at DESC, i.created_at DESC;
      `) as IssueRow[];

    const ids = issues.map((i) => i.id);

    // 2) Bulk load labels
    const labelsByIssue = new Map<string, string[]>();
    // 3) Bulk load relationships
    // We want to know:
    // - Parent (if type='parent-child', issue_id -> depends_on_id=Parent)
    // - Children (inverse of above)
    // - Blocked By (type='blocks', issue_id -> depends_on_id=Blocker)
    // - Blocks (inverse of above)
    
    interface RelRow {
      issue_id: string; // The one dealing with the dependency
      other_id: string; // The other side
      other_title: string;
      rel_type: string; // 'parent-child' or 'blocks'
    }

    const parentMap = new Map<string, DependencyInfo>();
    const childrenMap = new Map<string, DependencyInfo[]>();
    const blockedByMap = new Map<string, DependencyInfo[]>();
    const blocksMap = new Map<string, DependencyInfo[]>();
    const commentsByIssue = new Map<string, Comment[]>();

    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");

      // Fetch labels
      const labelRows = this.queryAll(`SELECT issue_id, label FROM labels WHERE issue_id IN (${placeholders}) ORDER BY label;`, ids) as Array<{ issue_id: string; label: string }>;

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
        WHERE d.issue_id IN (${placeholders}) OR d.depends_on_id IN (${placeholders});
      `, [...ids, ...ids]) as {
        issue_id: string;
        depends_on_id: string;
        type: string;
        issue_title: string;
        depends_title: string;
        created_at: string;
        created_by: string;
        metadata: string;
        thread_id: string;
      }[];

      for (const d of allDeps) {
        const child: DependencyInfo = {
          id: d.issue_id,
          title: d.issue_title,
          created_at: d.created_at,
          created_by: d.created_by,
          metadata: d.metadata,
          thread_id: d.thread_id
        };
        const parent: DependencyInfo = {
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
        } else if (d.type === 'blocks') {
          // issue_id is BLOCKED BY depends_on_id
          const blockedByList = blockedByMap.get(d.issue_id) ?? [];
          blockedByList.push(parent); // parent here is just the blocker (depends_on_id)
          blockedByMap.set(d.issue_id, blockedByList);

          const blocksList = blocksMap.get(d.depends_on_id) ?? [];
          blocksList.push(child); // child here is the blocked one (issue_id)
          blocksMap.set(d.depends_on_id, blocksList);
        }
      }
      
      // Fetch comments for these issues
      const allComments = this.queryAll(`
        SELECT id, issue_id, author, text, created_at
        FROM comments
        WHERE issue_id IN (${placeholders})
        ORDER BY created_at ASC;
      `, ids) as Comment[];

      for (const c of allComments) {
        const list = commentsByIssue.get(c.issue_id) ?? [];
        list.push(c);
        commentsByIssue.set(c.issue_id, list);
      }
    }

    const cards: BoardCard[] = issues.map((r) => ({
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
      comments: commentsByIssue.get(r.id) ?? []
    }));

    const columns: BoardColumn[] = [
      { key: "ready", title: "Ready" },
      { key: "in_progress", title: "In Progress" },
      { key: "blocked", title: "Blocked" },
      { key: "closed", title: "Closed" }
    ];

    return { columns, cards };
  }

  public async createIssue(input: {
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: number;
    issue_type?: string;
    assignee?: string | null;
    estimated_minutes?: number | null;
  }): Promise<{ id: string }> {
    if (!this.db) await this.ensureConnected();
    if (!this.db) throw new Error('Failed to connect to database');
    const db = this.db;

    const id = uuidv4();
    const title = (input.title ?? "").trim();
    if (!title) throw new Error("Title is required.");

    const description = input.description ?? "";
    const status: IssueStatus = input.status ?? "open";
    const priority = input.priority ?? 2;
    const issueType = input.issue_type ?? "task";
    const assignee = input.assignee ?? null;
    const estimated = input.estimated_minutes ?? null;

    this.runQuery(`
      INSERT INTO issues (id, title, description, status, priority, issue_type, assignee, estimated_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `, [id, title, description, status, priority, issueType, assignee, estimated]);

    return { id };
  }

  public async setIssueStatus(id: string, toStatus: IssueStatus): Promise<void> {
    if (!this.db) await this.ensureConnected();
    if (!this.db) throw new Error('Failed to connect to database');
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
  }): Promise<void> {
    if (!this.db) await this.ensureConnected();

    const fields: string[] = [];
    const values: any[] = [];

    if (updates.title !== undefined) { fields.push("title = ?"); values.push(updates.title); }
    if (updates.description !== undefined) { fields.push("description = ?"); values.push(updates.description); }
    if (updates.priority !== undefined) { fields.push("priority = ?"); values.push(updates.priority); }
    if (updates.issue_type !== undefined) { fields.push("issue_type = ?"); values.push(updates.issue_type); }
    if (updates.assignee !== undefined) { fields.push("assignee = ?"); values.push(updates.assignee); }
    if (updates.estimated_minutes !== undefined) { fields.push("estimated_minutes = ?"); values.push(updates.estimated_minutes); }
    if (updates.acceptance_criteria !== undefined) { fields.push("acceptance_criteria = ?"); values.push(updates.acceptance_criteria); }
    if (updates.design !== undefined) { fields.push("design = ?"); values.push(updates.design); }
    if (updates.external_ref !== undefined) { fields.push("external_ref = ?"); values.push(updates.external_ref); }

    if (fields.length === 0) return;

    fields.push("updated_at = CURRENT_TIMESTAMP");

    values.push(id);

    this.runQuery(`
      UPDATE issues
      SET ${fields.join(", ")}
      WHERE id = ? AND deleted_at IS NULL;
    `, values);
  }

  public async addComment(issueId: string, text: string, author: string): Promise<void> {
    if (!this.db) await this.ensureConnected();
    
    this.runQuery(`
      INSERT INTO comments (issue_id, author, text)
      VALUES (?, ?, ?);
    `, [issueId, author, text]);
  }

  public async addLabel(issueId: string, label: string): Promise<void> {
    if (!this.db) await this.ensureConnected();
    this.runQuery("INSERT OR IGNORE INTO labels (issue_id, label) VALUES (?, ?)", [issueId, label]);
  }

  public async removeLabel(issueId: string, label: string): Promise<void> {
    if (!this.db) await this.ensureConnected();
    this.runQuery("DELETE FROM labels WHERE issue_id = ? AND label = ?", [issueId, label]);
  }

  public async addDependency(issueId: string, dependsOnId: string, type: 'parent-child' | 'blocks' = 'blocks'): Promise<void> {
    if (!this.db) await this.ensureConnected();
    this.runQuery(`
      INSERT OR IGNORE INTO dependencies (issue_id, depends_on_id, type, created_by)
      VALUES (?, ?, ?, 'extension');
    `, [issueId, dependsOnId, type]);
  }

  public async removeDependency(issueId: string, dependsOnId: string): Promise<void> {
    if (!this.db) await this.ensureConnected();
    this.runQuery("DELETE FROM dependencies WHERE issue_id = ? AND depends_on_id = ?", [issueId, dependsOnId]);
  }


  private save(): void {
    if (!this.db || !this.dbPath) return;

    try {
      const data = this.db.export();
      const buffer = Buffer.from(data);

      // Atomic write: write to temp file then rename
      const tmpPath = this.dbPath + '.tmp';
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, this.dbPath);

      this.output.appendLine('[BeadsAdapter] Database saved successfully');
    } catch (error) {
      const msg = `Failed to save database: ${error instanceof Error ? error.message : String(error)}`;
      this.output.appendLine(`[BeadsAdapter] ERROR: ${msg}`);

      // Show user-visible error (sanitized)
      vscode.window.showErrorMessage(`Beads Kanban: ${sanitizeError(error)}`);

      // Re-throw to prevent silent data loss
      throw new Error(msg);
    }
  }

  private scheduleSave(): void {
    // Clear any existing timeout
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    // Schedule a new save after 100ms
    this.saveTimeout = setTimeout(() => {
      if (this.isDirty) {
        try {
          this.save();
          this.isDirty = false;
        } catch (error) {
          // Error already logged and shown in save()
        }
      }
      this.saveTimeout = null;
    }, 100); // 100ms debounce
  }

  private queryAll(sql: string, params: any[] = []): any[] {
      if (!this.db) return [];
      const stmt = this.db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) {
          rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
  }

  private runQuery(sql: string, params: any[] = []) {
      if (!this.db) return;
      // Note: db.run() automatically frees prepared statements in sql.js
      // If you need to use db.prepare() manually in the future, you MUST call stmt.free()
      this.db.run(sql, params);
      this.isDirty = true;
      this.scheduleSave();
  }
}

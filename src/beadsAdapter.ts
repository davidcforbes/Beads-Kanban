import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import * as vscode from "vscode";
import { v4 as uuidv4 } from "uuid";
import { BoardCard, BoardData, BoardColumn, IssueRow, IssueStatus } from "./types";

export class BeadsAdapter {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;

  constructor(private readonly output: vscode.OutputChannel) {}

  public dispose() {
    try {
      this.db?.close();
    } catch {
      // ignore
    }
    this.db = null;
    this.dbPath = null;
  }

  public ensureConnected(): void {
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
      .map((f) => path.join(beadsDir, f));

    if (candidatePaths.length === 0) {
      throw new Error("No SQLite database file found in .beads (expected *.db/*.sqlite/*.sqlite3).");
    }

    const failureReasons: string[] = [];

    // Find the DB that contains the `issues` table.
    for (const p of candidatePaths) {
      try {
        const db = new Database(p, { readonly: false, fileMustExist: true });
        
        // Check for issues table
        const row = db
          .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name='issues' LIMIT 1;")
          .get() as { ok?: number } | undefined;

        if (row?.ok === 1) {
          const msg = `[BeadsAdapter] Connected to DB: ${p}`;
          this.output.appendLine(msg);
          console.log(msg);
          this.db = db;
          this.dbPath = p;
          return;
        }

        // If 'issues' table logic failed, list actual tables to help debug
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all() as { name: string }[];
        const tableNames = tables.map(t => t.name).join(', ');
        const reason = `File opened but 'issues' table missing. Tables found: [${tableNames}]`;
        
        this.output.appendLine(`[BeadsAdapter] ${p}: ${reason}`);
        console.warn(`[BeadsAdapter] ${p}: ${reason}`);
        failureReasons.push(`${path.basename(p)}: ${reason}`);

        db.close();
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        this.output.appendLine(`[BeadsAdapter] Candidate DB failed: ${p} (${msg})`);
        console.error(`[BeadsAdapter] Candidate DB failed: ${p} (${msg})`);
        failureReasons.push(`${path.basename(p)}: ${msg}`);
      }
    }

    const fullError = `Could not find a valid Beads DB in .beads. Searched: ${candidatePaths.map(x => path.basename(x)).join(', ')}. Details:\n${failureReasons.join('\n')}`;
    console.error(fullError);
    throw new Error(fullError);
  }

  public getConnectedDbPath(): string | null {
    return this.dbPath;
  }

  public getBoard(): BoardData {
    if (!this.db) this.ensureConnected();
    const db = this.db!;

    // 1) Load issues + derived readiness and blockedness via views
    const issues = db
      .prepare(`
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
          CASE WHEN ri.id IS NOT NULL THEN 1 ELSE 0 END AS is_ready,
          COALESCE(bi.blocked_by_count, 0) AS blocked_by_count
        FROM issues i
        LEFT JOIN ready_issues ri ON ri.id = i.id
        LEFT JOIN blocked_issues bi ON bi.id = i.id
        WHERE i.deleted_at IS NULL
        ORDER BY i.priority ASC, i.updated_at DESC, i.created_at DESC;
      `)
      .all() as IssueRow[];

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

    const parentMap = new Map<string, { id: string; title: string }>();
    const childrenMap = new Map<string, { id: string; title: string }[]>();
    const blockedByMap = new Map<string, { id: string; title: string }[]>();
    const blocksMap = new Map<string, { id: string; title: string }[]>();

    if (ids.length > 0) {
      const placeholders = ids.map(() => "?").join(",");

      // Fetch labels
      const labelRows = db
        .prepare(`SELECT issue_id, label FROM labels WHERE issue_id IN (${placeholders}) ORDER BY label;`)
        .all(...ids) as Array<{ issue_id: string; label: string }>;

      for (const r of labelRows) {
        const arr = labelsByIssue.get(r.issue_id) ?? [];
        arr.push(r.label);
        labelsByIssue.set(r.issue_id, arr);
      }

      // Fetch all relevant dependencies where either side is in our issue list
      // Note: We might miss titles if the "other side" isn't in 'ids' (filtered list?).
      // Actually, 'issues' query above fetches ALL issues (no WHERE clause except deleted_at IS NULL).
      // So 'ids' should check all.
      
      const allDeps = db.prepare(`
        SELECT d.issue_id, d.depends_on_id, d.type, i1.title as issue_title, i2.title as depends_title
        FROM dependencies d
        JOIN issues i1 ON i1.id = d.issue_id
        JOIN issues i2 ON i2.id = d.depends_on_id
        WHERE d.issue_id IN (${placeholders}) OR d.depends_on_id IN (${placeholders});
      `).all(...ids, ...ids) as { issue_id: string; depends_on_id: string; type: string; issue_title: string; depends_title: string }[];

      for (const d of allDeps) {
        const child = { id: d.issue_id, title: d.issue_title };
        const parent = { id: d.depends_on_id, title: d.depends_title };

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
      labels: labelsByIssue.get(r.id) ?? [],
      parent: parentMap.get(r.id),
      children: childrenMap.get(r.id),
      blocked_by: blockedByMap.get(r.id),
      blocks: blocksMap.get(r.id)
    }));

    const columns: BoardColumn[] = [
      { key: "ready", title: "Ready" },
      { key: "in_progress", title: "In Progress" },
      { key: "blocked", title: "Blocked" },
      { key: "closed", title: "Closed" }
    ];

    return { columns, cards };
  }

  public createIssue(input: {
    title: string;
    description?: string;
    status?: IssueStatus;
    priority?: number;
    issue_type?: string;
    assignee?: string | null;
    estimated_minutes?: number | null;
  }): { id: string } {
    if (!this.db) this.ensureConnected();
    const db = this.db!;

    const id = uuidv4();
    const title = (input.title ?? "").trim();
    if (!title) throw new Error("Title is required.");

    const description = input.description ?? "";
    const status: IssueStatus = input.status ?? "open";
    const priority = input.priority ?? 2;
    const issueType = input.issue_type ?? "task";
    const assignee = input.assignee ?? null;
    const estimated = input.estimated_minutes ?? null;

    db.prepare(`
      INSERT INTO issues (id, title, description, status, priority, issue_type, assignee, estimated_minutes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?);
    `).run(id, title, description, status, priority, issueType, assignee, estimated);

    return { id };
  }

  public setIssueStatus(id: string, toStatus: IssueStatus): void {
    if (!this.db) this.ensureConnected();
    const db = this.db!;

    // Enforce closed_at CHECK constraint properly
    if (toStatus === "closed") {
      db.prepare(`
        UPDATE issues
        SET status='closed',
            closed_at=CURRENT_TIMESTAMP,
            updated_at=CURRENT_TIMESTAMP
        WHERE id = ?
          AND deleted_at IS NULL;
      `).run(id);
      return;
    }

    db.prepare(`
      UPDATE issues
      SET status = ?,
          closed_at = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND deleted_at IS NULL;
    `).run(toStatus, id);
  }
}

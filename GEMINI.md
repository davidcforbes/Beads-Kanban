# Beads Kanban - Gemini Context

## Project Overview
**Beads Kanban** is a VS Code extension that provides a visual Kanban board and table view for managing [Beads](https://github.com/steveyegge/beads) issues directly within the editor. It interacts with local `.beads/*.db` SQLite files to track tasks, bugs, and features.

## ⚠️ Critical System Instructions (Windows)
*   **Shell:** Always use `pwsh.exe` for PowerShell commands.
*   **Shell Tool Warning:** The standard `run_shell_command` tool is **BROKEN** on Windows (missing `node-pty`).
    *   **NEVER** use `run_shell_command`.
    *   **ALWAYS** use Desktop Commander MCP tools:
        *   `DC: execute_command` (or `start_process` / `read_process_output` for long-running tasks).
        *   `DC: list_directory`.
*   **MCP Configuration:** To enable/disable MCP servers, edit `C:\Users\david\.gemini\settings.json` (`mcp.excluded` list).

## Beads Agent Workflow (MANDATORY)
This repository uses **Beads** (`bd`) as the primary issue tracker and long-term memory.

### Core Rules
1.  **Source of Truth:** The `.beads/` directory is the canonical store of work. Do not use Markdown TODO lists.
2.  **Onboarding:** If you haven't, run `bd onboard` (or check if it's done).
3.  **Task Selection:** Use `bd ready --json` to find unblocked work.
4.  **Status Updates:**
    *   Start: `bd update <id> --status in_progress`
    *   Finish: `bd close <id> --reason "..."`
5.  **Dependencies:** Use `bd dep add` to link issues (blocks/blocked-by).
6.  **Session End:** You **MUST** sync and push before stopping.
    ```powershell
    git pull --rebase
    bd sync
    git push
    # Verify "up to date with origin"
    ```

## Development Environment

### Setup
```powershell
npm install
```

### Build & Run
*   **Compile:** `npm run compile`
*   **Watch Mode:** `npm run watch` (run in background for auto-compilation)
*   **Run Extension:** Press `F5` in VS Code (launch "Extension").

### Testing
*   **Run All Tests:** `npm test`
*   **Unit/Integration:** `npm run test:adapter`
*   **Validation:** `npm run test:validation`
*   **Performance Benchmarks:** `node --expose-gc scripts/benchmark-loading.js test-databases/test-db-10k.db`

## Architecture
The extension follows a clean 3-layer architecture:
1.  **Extension Host** (`src/extension.ts`): Command registration, webview lifecycle.
2.  **Data Adapters**:
    *   `src/beadsAdapter.ts`: In-memory `sql.js` adapter (fast, local).
    *   `src/daemonBeadsAdapter.ts`: Interfaces with `bd` CLI daemon.
3.  **Webview UI** (`media/board.js`): Vanilla JS reactive UI with incremental loading.

## Coding Conventions
*   **Language:** TypeScript (Strict mode).
*   **Formatting:** 4 spaces indentation.
*   **Linting:** `npm run lint`.
*   **Commits:** Conventional Commits (e.g., `feat(ui): add sort button`, `fix(adapter): resolve path issue`).
*   **Branches:** `feature/...`, `fix/...`.

## Directory Structure
*   `src/`: Extension source code.
*   `media/`: Webview frontend assets (JS/CSS).
*   `scripts/`: Build and test utility scripts.
*   `test-databases/`: SQLite databases for performance testing.
*   `.beads/`: Local issue tracking database.

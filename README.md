# Beads Kanban

A VS Code extension that provides a Kanban board for issues stored in a `.beads` SQLite database, with an optional daemon-backed adapter that uses the `bd` CLI.

## Features

- **Columns**: Ready, In Progress, Blocked, Closed. Ready maps to `open` issues that appear in the `ready_issues` view; open issues that are not ready are shown in Blocked.
- **Drag-and-drop**: Move issues between columns to update their status.
- **Unified create/edit dialog**:
  - Fields: title, description, acceptance criteria, design, notes, status, priority, type, assignee, estimate, external ref, due/defer dates.
  - Markdown preview for long-text fields.
- **Comments**: View and add comments.
- **Labels and dependencies**: Parent-child and blocks relationships with unlink actions.
- **Filtering**: Priority, type, and search filters.
- **Context actions**: Add to Chat and Copy Context.
- **Flags and scheduling**: Pinned/template/ephemeral badges and due/defer indicators.
- **Daemon status bar**: Status, health, restart/stop, and logs when daemon integration is enabled.

## Usage

1. Open the board: `Beads: Open Kanban Board` from the Command Palette.
2. Create an issue: click **New**.
3. Edit an issue: click a card to open the detail dialog.
   - Use **Preview** to render Markdown fields.
   - Scroll to **Comments** to post a new comment.
   - Use **Labels** and **Structure** sections to manage tags and dependencies.

## Configuration

- `beadsKanban.readOnly`: Disable mutations (create/move/update).
- `beadsKanban.useDaemonAdapter`: Use the `bd` daemon adapter instead of the in-memory SQLite adapter (requires `bd` daemon).

## Data Sources and Adapters

### Default adapter (sql.js)
- Loads `.beads/*.db` into memory via sql.js.
- Executes queries in-memory and writes changes back to disk with a debounced, atomic save.
- Watches `.beads/**/*.db` for external changes and reloads the DB.

### Daemon adapter (bd CLI)
- Uses `bd list --json` and `bd show --json` to fetch issue data.
- Uses `bd` commands for create/update/move/comment/label/dependency operations.
- Caches board data briefly to reduce CLI overhead.

## Development

- **Compile**: `npm run compile`
- **Watch**: `npm run watch`
- **Lint**: `npm run lint`
- **Test**: `npm test`

Note: `npm run compile` currently relies on a `cp` command in `copy-deps`, so on Windows use a shell that provides `cp` (Git Bash or WSL) until the script is made cross-platform.

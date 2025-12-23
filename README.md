# Beads Kanban

A VS Code extension that provides a Kanban board interface for managing issues stored in a `.beads` SQLite database within your workspace.

## Features

- **Kanban Board Visualization**: View issues in columns based on their status (Open, In Progress, Blocked, Ready, Closed).
- **Drag-and-Drop**: Move issues between columns to update their status.
- **Detailed Issue Editing**:
    - Edit Title, Description, Acceptance Criteria, and Design Notes.
    - Markdown Preview support for long-text fields.
    - Manage Status, Priority, Type, Assignee, Estimated Minutes, and External References.
- **Comments**: View and add comments to issues directly from the board.
- **Organization**:
    - **Labels**: Add tagging to issues.
    - **Dependencies**: Manage Parent-Child and Blocking relationships.
- **Filtering**: Filter the board by Priority, Issue Type, or text search.
- **Theme Aware**: Fully integrated with your VS Code theme (Light/Dark modes).

## Usage

1.  **Open the Board**: Run the command `Beads: Open Kanban Board` from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2.  **Create Issue**: Click the "New" button in the top bar.
3.  **Edit Issue**: Click on any card to open the detail dialog.
    - **Preview Markdown**: Use the "Preview" button above text fields to render markdown.
    - **Add Comment**: Scroll to the bottom of the dialog to post comments.
    - **Manage Tags/Structure**: Use the dedicated sections in the dialog to add tags or set dependencies.

## Data Storage

All data is stored in a SQLite database located in `.beads/beads.db` (or similar) within your workspace root. The extension automatically detects and connects to this database.

## Development

- **Compile**: `npm run compile`
- **Watch**: `npm run watch`

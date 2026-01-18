# Beads Kanban

A visual Kanban board VS Code extension for managing [Beads](https://github.com/steveyegge/beads) issues directly in your editor. View, create, edit, and organize your `.beads` issues with an intuitive drag-and-drop interface.

![Version](https://img.shields.io/badge/version-2.0.5-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.90+-blue)

## Screenshots

### Kanban View

Drag-and-drop cards between columns to manage your workflow.

![Kanban View](https://raw.githubusercontent.com/davidcforbes/beads-kanban/main/images/screenshots/kanban-view.jpg)

### Table View

Sort, filter, and customize columns for detailed issue management.

![Table View](https://raw.githubusercontent.com/davidcforbes/beads-kanban/main/images/screenshots/table-view.jpg)

### Edit Issue Form

Comprehensive issue editing with all metadata fields, dependencies, and comments.

![Edit Form](https://raw.githubusercontent.com/davidcforbes/beads-kanban/main/images/screenshots/edit-form.jpg)

## Features

✨ **Visual Kanban Board**

- Drag-and-drop cards between columns (Ready, In Progress, Blocked, Closed)
- Real-time updates with your `.beads` database
- Incremental loading for large issue databases (10,000+ issues)

📊 **Table View**

- Sortable columns with multi-column sorting (Shift+Click)
- Customizable column visibility
- Pagination with configurable page sizes
- Filter by priority, type, status, and search

🔧 **Full Issue Management**

- Create, edit, and update issues
- Add comments, labels, and dependencies
- Markdown support with live preview
- Rich metadata fields (priority, assignee, estimated time, etc.)

⚡ **Daemon Integration**

- Uses `bd` CLI daemon for all database operations
- Auto-starts daemon when extension loads
- Efficient incremental data loading

## Installation

### From VSIX (Recommended)

1. Download the latest `.vsix` file from [Releases](https://github.com/davidcforbes/beads-kanban/releases)
2. In VS Code: `Extensions > ... > Install from VSIX...`
3. Select the downloaded file
4. Reload VS Code

### From VS Code Marketplace

1. Open VS Code Extensions view (`Ctrl+Shift+X`)
2. Search for "Beads Kanban"
3. Click Install

## Prerequisites

- **Beads CLI** (`bd`): Required for all database operations. Install from [github.com/steveyegge/beads](https://github.com/steveyegge/beads)
- The extension auto-starts the `bd` daemon when needed

## Quick Start

1. **Initialize Beads in your project** (if not already done):

   ```bash
   bd init
   ```

2. **Open the Kanban board**:
   - Command Palette (`Ctrl+Shift+P`): "Beads: Open Kanban Board"
   - Or use the status bar button

3. **Start managing issues**:
   - Create issues with the "New" button
   - Drag cards between columns to update status
   - Click cards to view/edit details
   - Switch to Table view for sorting and filtering

## What is Beads?

Beads is an AI-native issue tracking system that lives directly in your codebase. Issues are stored in `.beads/*.db` SQLite files and sync with git, making them perfect for AI coding agents and developers who want issues close to code.

**Learn more:** [github.com/steveyegge/beads](https://github.com/steveyegge/beads)

## Configuration

| Setting | Default | Description |
| --------- | --------- | ------------- |
| `beadsKanban.readOnly` | `false` | Enable read-only mode (no edits) |
| `beadsKanban.initialLoadLimit` | `100` | Issues per column on initial load |
| `beadsKanban.pageSize` | `50` | Issues to load when clicking "Load More" |
| `beadsKanban.preloadClosedColumn` | `false` | Load closed issues on initial load |
| `beadsKanban.lazyLoadDependencies` | `true` | Load dependencies on-demand |

## Development

### Prerequisites

- Node.js 20+
- VS Code 1.90+

### Build from Source

```bash
# Clone the repository
git clone https://github.com/davidcforbes/beads-kanban.git
cd beads-kanban

# Install dependencies
npm install

# Compile
npm run compile

# Run tests
npm test

# Package VSIX
npx @vscode/vsce package
```

### Development Workflow

1. Press `F5` to launch Extension Development Host
2. Make changes to source files
3. Press `Ctrl+Shift+F5` to reload extension
4. Use `npm run watch` for automatic compilation

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Integration tests
npm run test:adapter
```

## Architecture

The extension uses a clean architecture with three main layers:

- **Extension Host** (`src/extension.ts`): Command registration, webview lifecycle, message routing
- **Data Adapter** (`src/daemonBeadsAdapter.ts`): CLI-based daemon adapter for all database operations
- **Webview UI** (`media/board.js`, `media/styles.css`): Reactive UI with incremental loading

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Contributing

Contributions are welcome! This is an actively maintained fork where the original author became non-responsive.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Guidelines

- Follow existing code style (use ESLint)
- Add tests for new features
- Update documentation as needed
- Keep commits focused and well-described

## Attribution

This project is a fork of the original work by [sebcook-ctrl](https://github.com/sebcook-ctrl/agent.native.activity.layer.beads). When the original author became non-responsive, this repository was established to continue active development and accept community contributions.

**Original Project**: [agent.native.activity.layer.beads](https://github.com/sebcook-ctrl/agent.native.activity.layer.beads)

## License

MIT License - see [LICENSE](LICENSE) file for details.

Copyright (c) 2024 Agent Native Kanban Contributors
Original work Copyright (c) 2024 sebcook-ctrl

---

## Gratitude

Made with ❤️ for the Beads community

Questions? Open an [issue](https://github.com/davidcforbes/beads-kanban/issues) or start a [discussion](https://github.com/davidcforbes/beads-kanban/discussions)!

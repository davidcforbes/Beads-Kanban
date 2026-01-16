# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension that provides a Kanban board interface for issues stored in a `.beads` SQLite database. The extension uses the `bd` CLI daemon for all database operations, providing efficient incremental loading and real-time updates. The board uses column-based loading to keep large databases (10,000+ issues) responsive.

## Development Commands

### Build and Watch

- `npm run compile` - Compile TypeScript and copy assets (DOMPurify)
- `npm run watch` - Watch mode for development
- `npm run lint` - Run ESLint on TypeScript files

### Testing

- `npm test` - Run all tests (requires compile first via pretest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with c8 coverage
- Press F5 with "Extension Tests" launch config to debug tests

Running specific tests: The test runner uses Mocha. To run a specific test file or filter by test name, modify `src/test/suite/index.ts` temporarily to use Mocha's `grep` option or change the glob pattern. Test files are in `src/test/suite/*.test.ts`.

### Running the Extension

- Press F5 in VS Code to launch Extension Development Host
- Use "Beads: Open Kanban Board" command to open the board

## Architecture

### Core Components

Extension Host (TypeScript/Node.js)

- `src/extension.ts` - Entry point; registers commands, creates webview panel, routes messages, enforces read-only mode, and wires file watching
- `src/daemonBeadsAdapter.ts` - Daemon adapter; uses `bd` CLI to read and mutate issues with efficient caching
- `src/daemonManager.ts` - Runs `bd` daemon status/actions and populates the status bar
- `src/types.ts` - Type definitions and Zod schemas
- `src/webview.ts` - Generates webview HTML with CSP and asset URIs

Webview (JavaScript/HTML/CSS)

- `media/board.js` - UI logic; Sortable drag-and-drop, filters, detail dialog, incremental column loading, and request/response messaging
- `media/styles.css` - Theme-aware styling
- `media/Sortable.min.js` - Drag-and-drop library
- `media/marked.min.js` - Markdown rendering
- `media/purify.min.js` - DOMPurify for sanitization

### Message Protocol

The extension uses a request/response pattern for webview-extension communication:

WebMsg types (Webview -> Extension)

- `board.load` / `board.refresh` - Request board data
- `board.loadColumn` - Fetch a slice of a column (offset/limit)
- `board.loadMore` - Load the next page for a column
- `issue.create` - Create new issue
- `issue.move` - Drag-and-drop status change
- `issue.update` - Update issue fields
- `issue.addComment` - Add comment
- `issue.addLabel` / `issue.removeLabel` - Manage labels
- `issue.addDependency` / `issue.removeDependency` - Manage relationships
- `issue.addToChat` - Send to VS Code chat
- `issue.copyToClipboard` - Copy issue context

ExtMsg types (Extension -> Webview)

- `board.data` - Board data payload (may include columnData for incremental loading)
- `board.columnData` - Column slice payload for incremental loading
- `mutation.ok` - Success response
- `mutation.error` - Error response with message
- `webview.cleanup` - Cleanup before panel disposal

### Database Schema

The extension reads from a SQLite database at `.beads/*.db` (or .sqlite/.sqlite3). The DB is expected to include:

Core tables

- `issues` - id, title, description, status, priority, issue_type, assignee, estimated_minutes, created_at, updated_at, closed_at, external_ref, acceptance_criteria, design, notes, due_at, defer_until, pinned, is_template, ephemeral, event/agent metadata, deleted_at
- `dependencies` - issue_id, depends_on_id, type (parent-child | blocks)
- `labels` - issue_id, label
- `comments` - id, issue_id, author, text, created_at

Views

- `ready_issues` - open issues with no blockers
- `blocked_issues` - issues with dependencies (includes blocked_by_count)

### Column Logic

The board displays 4 columns:

1. Ready - status = open and present in ready_issues
2. In Progress - status = in_progress
3. Blocked - status = blocked, or blocked_by_count > 0, or open but not ready
4. Closed - status = closed

Moving cards between columns updates the underlying issue status. The Ready column maps back to open.

### Data Adapter

The extension uses the DaemonBeadsAdapter exclusively for all database operations:

- Uses column-based `bd` queries for incremental loading and `bd show --json` for details
- Uses `bd` CLI for mutations (create/update/move/comments/labels/deps)
- Short-lived cache to reduce CLI overhead
- Exposes `getColumnData` / `getColumnCount` for incremental loading paths
- Auto-starts daemon on extension load if not running

### Input Validation

All mutation messages from the webview are validated with Zod (`src/types.ts`):

- `IssueCreateSchema` / `IssueUpdateSchema`
- `CommentAddSchema` / `LabelSchema` / `DependencySchema`
- `IssueIdSchema` enforces length bounds; issue IDs are treated as opaque strings, not necessarily UUIDs

### Incremental Loading Architecture

The extension uses column-based incremental loading to support large databases (10,000+ issues) without performance degradation.

**Problem:** Loading all issues at once causes:

- Slow initial load (200+ sequential CLI calls for daemon adapter)
- High memory usage (all issues in memory)
- Slow rendering (thousands of DOM nodes)

**Solution:** Column-based lazy loading:

1. **Initial Load**: Load only visible columns (Ready, In Progress, Blocked) with limited items per column
2. **Lazy Load**: Load Closed column and additional pages only when needed
3. **Pagination**: Load in configurable chunks (default: 100 initial, 50 per page)

**Configuration Settings:**

- `beadsKanban.initialLoadLimit` (default: 100, range: 10-1000) - Issues per column on initial load
- `beadsKanban.pageSize` (default: 50, range: 10-500) - Issues to load when clicking Load More
- `beadsKanban.preloadClosedColumn` (default: false) - Whether to load closed issues initially
- `beadsKanban.autoLoadOnScroll` (default: false) - Auto-load more issues on scroll (future feature)
- `beadsKanban.maxIssues` (DEPRECATED) - Use initialLoadLimit and pageSize instead

**Message Protocol for Incremental Loading:**

New request types:

- `board.loadColumn(column, offset, limit)` - Load specific column chunk
- `board.loadMore(column)` - Load next page for a column

Enhanced response:

- `board.data` now includes `columnData` field with per-column metadata (cards, offset, totalCount, hasMore)
- `board.columnData` response for incremental loads

**Frontend State:**

- Column-based state management (`columnState` per column)
- Tracks loaded ranges, total counts, and hasMore flags
- Load More buttons appear when hasMore is true
- Column headers show "loaded / total" counts

**Backend Support:**
The adapter implements:

- `getColumnData(column, offset, limit)` - Paginated column queries
- `getColumnCount(column)` - Fast count queries

**Backward Compatibility:**

- Old `board.load` still works (loads full board up to maxIssues limit)
- Legacy `maxIssues` setting still respected
- Flat `cards` array included in responses for compatibility

**Migration Guide:**
If you have a custom `maxIssues` setting:

1. Set `initialLoadLimit` to your preferred initial load size (default: 100)
2. Set `pageSize` to your preferred page size (default: 50)
3. Remove or ignore `maxIssues` (will be removed in future version)

Example: If you had `maxIssues: 500`, use:

```json
{
  "beadsKanban.initialLoadLimit": 200,
  "beadsKanban.pageSize": 100,
  "beadsKanban.preloadClosedColumn": true
}
```

### Planned UI Consolidation

The Create New Issue and Edit Issue forms will be consolidated into a single shared form unit to ensure identical fields, validation, and features across both workflows.

## Important Notes

- The extension requires `bd` CLI on PATH and auto-starts the daemon on load.
- `npm run compile` copies DOMPurify to the media folder via the `copy-deps` script.
- Webview scripts are loaded via CSP nonce; HTML uses inline styles extensively.
- `retainContextWhenHidden: true` keeps webview state when hidden.
- Markdown preview uses marked.js with GFM and DOMPurify sanitization.

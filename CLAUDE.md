# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension that provides a Kanban board interface for issues stored in a `.beads` SQLite database. It supports two data adapters:
- sql.js adapter: loads the SQLite DB into memory and writes changes back to disk.
- Daemon adapter: uses the `bd` CLI/daemon for reads and mutations.

## Development Commands

### Build and Watch
- `npm run compile` - Compile TypeScript and copy WASM/assets
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
- `src/beadsAdapter.ts` - sql.js adapter; loads the DB, performs queries/mutations, and debounced saves
- `src/daemonBeadsAdapter.ts` - Daemon adapter; uses `bd` CLI to read and mutate issues
- `src/daemonManager.ts` - Runs `bd` daemon status/actions and populates the status bar
- `src/types.ts` - Type definitions and Zod schemas
- `src/webview.ts` - Generates webview HTML with CSP and asset URIs

Webview (JavaScript/HTML/CSS)
- `media/main.js` - UI logic; Sortable drag-and-drop, filters, detail dialog, and request/response messaging
- `media/styles.css` - Theme-aware styling
- `media/Sortable.min.js` - Drag-and-drop library
- `media/marked.min.js` - Markdown rendering
- `media/purify.min.js` - DOMPurify for sanitization

### Message Protocol

The extension uses a request/response pattern for webview-extension communication:

WebMsg types (Webview -> Extension)
- `board.load` / `board.refresh` - Request board data
- `issue.create` - Create new issue
- `issue.move` - Drag-and-drop status change
- `issue.update` - Update issue fields
- `issue.addComment` - Add comment
- `issue.addLabel` / `issue.removeLabel` - Manage labels
- `issue.addDependency` / `issue.removeDependency` - Manage relationships
- `issue.addToChat` - Send to VS Code chat
- `issue.copyToClipboard` - Copy issue context

ExtMsg types (Extension -> Webview)
- `board.data` - Board data payload
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

### Data Adapters

sql.js adapter
- Loads the DB into memory on first connection
- Uses batched queries for labels/dependencies/comments
- Debounced save (300ms) with atomic write
- Tracks file mtime and reloads on external changes

daemon adapter
- Uses `bd list --json` for basic data, then `bd show --json` for details
- Uses `bd` for mutations (create/update/move/comments/labels/deps)
- Short-lived cache to reduce CLI overhead

### Input Validation

All mutation messages from the webview are validated with Zod (`src/types.ts`):
- `IssueCreateSchema` / `IssueUpdateSchema`
- `CommentAddSchema` / `LabelSchema` / `DependencySchema`
- `IssueIdSchema` enforces length bounds; issue IDs are treated as opaque strings, not necessarily UUIDs

## Important Notes

- The daemon adapter requires `bd` on PATH and a running daemon.
- `npm run compile` copies `sql-wasm.wasm` and DOMPurify; the `copy-deps` script currently uses `cp`.
- Webview scripts are loaded via CSP nonce; HTML uses inline styles extensively.
- `retainContextWhenHidden: true` keeps webview state when hidden.
- Markdown preview uses marked.js with GFM and DOMPurify sanitization.

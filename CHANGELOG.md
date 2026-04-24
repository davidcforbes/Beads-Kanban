# Changelog

All notable changes to the Beads Kanban extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.3] - 2026-04-24

### 🐛 Bug Fixes

- **bd CLI 1.0.0 compatibility**: bd 1.0 removed the daemon subsystem and several flags the extension depended on. The Kanban board was failing to connect, every edit threw "unknown flag: --no-daemon", and pinned/template issue creation threw "unknown flag: --pinned".
  - Replaced the `bd info --json` daemon probe (bd 1.0 emits plaintext) with a `bd stats --json` CLI smoke test in `DaemonBeadsAdapter.ensureConnected()`
  - Dropped the `--no-daemon` workaround from `updateIssue` — the flag no longer exists, so every edit was failing
  - Migrated pinned/template persistence from the removed `--pinned`/`--template` flags to `bd update --set-metadata pinned=true` / `template=true`; read paths now pull from `issue.metadata` with a legacy top-level fallback
  - Fixed flag ordering in `addDependency`: `--type` is now emitted before the `--` separator (it was being silently treated as a positional argument, so every user-created dependency fell back to the default `blocks` type)

### 🔧 Removed

- **DaemonManager and the `beadsKanban.showDaemonActions` command**: `bd daemon` no longer exists as a command. The status bar, auto-start, polling, and daemon action menu have been removed. Direct CLI mode is now the only mode.
- Deleted `src/daemonManager.ts` and `src/test/suite/daemon.test.ts`.

## [2.1.1] - 2026-03-28

### Security

- **Fix 3 XSS vulnerabilities**: Added DOMPurify.sanitize() to parentDisplay, advanced metadata, and footer innerHTML assignments in both board.js and editForm.js
- **Fix CLI injection**: Moved --author flag before -- separator in addComment to prevent flag bypass
- **Add Zod validation for table.loadPage**: Previously the only unvalidated message handler; now enforces bounds on sorting, offset, limit, and filter fields
- **Apply IssueIdSchema to dependency fields**: parent_id, blocked_by_ids, children_ids in IssueCreateSchema now use IssueIdSchema instead of z.string().max(100)
- **Sanitize stderr in error messages**: Raw CLI stderr no longer leaks internal paths to the webview
- **Add path validation to setWorkspaceRoot**: Prevents path traversal and control character injection

### Added

- **Configurable CLI paths** (GitHub issue #6): New `beadsKanban.bdPath` and `beadsKanban.doltPath` settings allow specifying absolute paths to the bd and dolt executables for portable setups
- **Visual UI testing framework**: Standalone test server (`scripts/visual-test-server.js`) serves the webview in Chrome for automated visual testing with Chrome DevTools MCP
- **Test data seeder**: `scripts/seed-test-data.sh` creates 53 representative issues covering all visual scenarios
- **Security Rules in CLAUDE.md**: 9 mandatory development guidelines codifying lessons from the security review
- **CI improvements**: Added `npm run lint` step and VSIX artifact verification to GitHub Actions workflow

### Fixed

- **Issue ID validation** (GitHub issue #5, PR #4): IDs with custom prefixes and hierarchical dot-separated suffixes (e.g. `stuff-30m.1.4.9`) are now accepted via shared `ISSUE_ID_PATTERN` constant
- **DaemonManager.spawnAsync timeout**: Added 30-second timeout and 10MB buffer limit matching DaemonBeadsAdapter.execBd safeguards
- **Event listener accumulation**: openDetail no longer stacks markDirty listeners on each call
- **Split-brain detailDirty state**: board.js and editForm.js now share dirty state via window.__editFormDirty
- **Save button double-submit**: Disabled during in-flight postAsync to prevent duplicate issues
- **Concurrent openDetail race**: Generation counter aborts stale dialog population
- **DOM clobbering risk**: btnSave reads scoped to form.querySelector instead of document.getElementById
- **Test correctness**: Fixed tautological assertions in security tests, wrong field names in schema tests, assert.fail caught by own catch block in daemonAdapter tests
- **Mocha UI mode**: Test runner correctly uses tdd mode matching suite()/test() syntax (PR #4)
- **Node.js version**: Dropped Node 18 (EOL), added Node 22, enforced >=20 (PR #4)

## [2.0.6] - 2026-01-20

### ✨ New Features

- **Dependency Graph View**: Visualize issue relationships with interactive dependency graph
  - Third view mode alongside Kanban and Table views
  - Hierarchical BFS-based layout algorithm
  - Visual dependency types: parent-child (green), blocks (red dashed), blocked-by (orange dashed)
  - Node colors by status: ready (yellow), in progress (green), blocked (red), closed (gray)
  - Interactive features: drag nodes, click to edit, zoom/pan controls
  - Focus mode to view specific issue + N levels of dependencies
  - Auto-layout with top-bottom or left-right direction
  - Legend showing node status colors and edge types
  - Sidebar with issue list for quick navigation

### 🐛 Bug Fixes

- **Dependency extraction**: Fixed parent, children, and blocked_by relationships not displaying in edit form
  - Root cause: extractParentDependency was checking wrong field (dependents vs dependencies)
  - Now correctly reads from issue.dependencies for parent and blocker relationships
  - Now correctly reads from issue.dependents for children and blocked issues
- **Graph edge deduplication**: Fixed phantom duplicate arrows in dependency graph
  - Added edge deduplication using Set to track unique edges
  - Each relationship now creates only one edge, even if found in both directions
- **Graph infinite loop**: Fixed concurrent render operations causing browser freeze
  - Added concurrency guard to prevent multiple simultaneous graph renders
  - Proper error handling with try/catch/finally blocks

### 🚀 Performance

- **Extension bundling**: Implemented esbuild bundling for both extension host and webview code
  - Created `scripts/build-extension.js` to bundle all TypeScript sources into single file
  - Extension host: All sources bundled into `out/extension.js` (636 KB)
  - Webview: UI code + Pragmatic Drag and Drop bundled into `out/webview/board.js` (243 KB total)
  - **97% reduction in file count**: 900 files → 31 files
  - **60% reduction in package size**: 2.26 MB → 1.54 MB
  - Faster installation and extension activation time
  - Improved overall performance

### 🔧 Build System

- **Build scripts**: Updated compilation pipeline
  - `npm run build-extension` - Bundle extension host code
  - `npm run build-webview` - Bundle webview code
  - `npm run watch` - Watch mode with automatic rebuilding
  - All dependencies bundled into output files (no node_modules in VSIX)

- **.vscodeignore optimization**: Cleaned up package exclusions
  - Exclude all source files (bundled into out/)
  - Exclude all node_modules (dependencies bundled)
  - Exclude development artifacts (test outputs, reports, workspace files)
  - Keep only essential files for distribution (23 files total)

### 📚 Documentation

- **Extension bundling guide**: Added comprehensive bundling documentation to CLAUDE.md
  - Why bundling is needed (performance benefits)
  - Build scripts configuration and usage
  - Development workflow with bundled code
  - .vscodeignore configuration for optimal packaging
  - External dependencies handling
  - Debugging bundled code with source maps

- **Publishing output reference**: Added before/after comparison showing bundling impact
  - Documented expected vsce package output
  - File count and size improvements

---

## [2.0.5] - 2026-01-17

### 🐛 Bug Fixes

- **Dialog visibility bug**: Fixed Edit Issue dialog being visible on page load even when not open
  - Root cause: CSS `display: flex` was overriding native `<dialog>` hidden behavior
  - Solution: Only apply `display: flex` when dialog has `[open]` attribute

### 🔧 Code Quality

- **ESLint compliance**: Fixed all 152 ESLint errors and warnings
  - Created `.eslintrc.json` with project-specific configuration
  - Replaced all `any` types with `unknown` + proper type assertions
  - Added test file exceptions (allow `any` in test files)
  - Fixed auto-fixable issues (curly braces, semicolons)

- **TypeScript type safety**: Resolved type conflicts between ESLint and TypeScript
  - Added comprehensive type assertions for CLI result handling
  - Implemented proper type guards for dependency extraction
  - Fixed all compilation errors while maintaining ESLint compliance

### 📚 Documentation

- **Marketplace publishing**: Added comprehensive publishing guide to CLAUDE.md
  - Azure DevOps account requirements
  - Personal Access Token (PAT) setup
  - Publishing workflow and checklist
  - Version management requirements

- **Development patterns**: Documented common bug patterns and solutions
  - Dialog visibility issues with native `<dialog>` elements
  - TypeScript vs ESLint type conflict resolution strategies
  - Type assertion patterns for `unknown` to typed object conversions

- **Build instructions**: Added packaging workflow documentation
  - PowerShell requirement for Windows (Git Bash has issues)
  - Version synchronization between package.json and webview.ts
  - Common packaging issues and solutions

### 🔨 Fixed Issues

- Fixed version badge in README.md (1.0.5 → 2.0.5)
- Updated marketplace installation instructions
- Added VS Code version badge

---

## [2.0.0] - 2026-01-16

### 🚨 BREAKING CHANGES

- **Daemon-only architecture**: Extension now requires `bd` CLI daemon for all operations
- Removed `beadsKanban.useDaemonAdapter` configuration option (always daemon mode)
- sql.js adapter and all in-memory SQLite functionality removed

### ✨ Added

- Auto-start daemon functionality when extension loads
- Comprehensive migration guide (MIGRATION.md)
- External dependencies security review documentation (External_Dependencies_Review.md)
- Improved error messaging for daemon connection issues

### 🗑️ Removed

- **sql.js adapter** (~1.7MB) - Complete removal of in-memory SQLite functionality
- **src/beadsAdapter.ts** (~2000 lines) - Removed sql.js-based adapter class
- **uuid** dependency - Completely unused package eliminated
- **@types/uuid** - Type definitions for removed package
- **@types/sql.js** - Type definitions for removed package
- **9 test files** - BeadsAdapter-specific tests no longer applicable
- `beadsKanban.useDaemonAdapter` configuration option
- sql-wasm.wasm file copy from build process

### 📝 Changed

- Extension now always uses DaemonBeadsAdapter for all database operations
- Extension requires workspace folder to be open (improved error handling)
- Updated README.md with daemon requirements and prerequisites section
- Updated CLAUDE.md to remove sql.js references and clarify daemon-only architecture
- Daemon auto-start attempts on extension load if not running
- Improved daemon status messaging and error handling

### 📦 Dependencies

**Removed:**
- sql.js: ^1.13.0 (~1.7MB saved)
- @types/sql.js: ^1.4.9
- uuid: ^10.0.0 (unused)
- @types/uuid: ^10.0.0 (unused)

**Current runtime dependencies (2):**
- dompurify: ^3.3.1 (23KB minified)
- zod: ^4.3.4 (58KB unminified)

**Bundle size reduction:** ~1.7MB

### 🔧 Internal

- Simplified adapter architecture (one adapter instead of two)
- Removed 9 adapter-specific test files
- Updated copy-deps.js script to remove sql-wasm.wasm handling
- Cleaned up extension.ts adapter selection logic

### 📚 Documentation

- Added MIGRATION.md with comprehensive v1.x to v2.0.0 upgrade guide
- Added External_Dependencies_Review.md with security analysis
- Updated README.md with new prerequisites and daemon requirements
- Updated CLAUDE.md with daemon-only architecture documentation

### 🐛 Bug Fixes

- Fixed potential null reference when no workspace folder is open
- Improved daemon connection error messages

---

## [1.0.5] - 2026-01-15

### Fixed

- Missing metadata in VS Code Marketplace "Resources" section
- Simplified `repository` and `bugs` fields in `package.json` for better compatibility
- Removed non-standard `qna` field
- Corrected version badges and documentation links

## [1.0.0] - 2024-01-15

### Added

- Initial release of Beads Kanban (forked from agent.native.activity.layer.beads)
- Visual Kanban board with drag-and-drop functionality
- Table view with sortable columns and filtering
- Dual adapter support (sql.js in-memory and bd daemon)
- Incremental loading for large issue databases (10,000+ issues)
- Column visibility controls in table view
- Multi-column sorting with Shift+Click
- Comprehensive issue editing with all metadata fields
- Markdown support with live preview
- Comment system with author and timestamp
- Label management
- Dependency tracking (parent-child and blocks relationships)
- Pagination controls for table view
- Configurable page sizes and load limits
- GitHub issue templates (bug report and feature request)
- Pull request template
- Contributing guidelines
- Professional documentation and screenshots
- MIT License with proper attribution

### Fixed

- Column picker dropdown positioning in table view
- Missing table controls section (pagination buttons)
- Event listener memory leaks in column picker
- Screenshot file organization in repository

### Changed

- Rebranded from "agent.native.activity.layer.beads" to "Beads Kanban"
- Updated repository URL to <https://github.com/davidcforbes/Beads-Kanban>
- Improved README.md with comprehensive feature documentation
- Enhanced .gitignore patterns for better file organization
- Updated package.json with new branding and metadata

### Deprecated

- `beadsKanban.maxIssues` setting (use `initialLoadLimit` and `pageSize` instead)

## Attribution

This project is a continuation of the original work by [sebcook-ctrl](https://github.com/sebcook-ctrl/agent.native.activity.layer.beads).

When the original author became non-responsive, this repository was established to continue active development and accept community contributions.

---

**Full Changelog**: <https://github.com/davidcforbes/Beads-Kanban/commits/main>

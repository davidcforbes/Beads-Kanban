# Changelog

All notable changes to the Beads Kanban extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

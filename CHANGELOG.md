# Changelog

All notable changes to the Beads Kanban extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

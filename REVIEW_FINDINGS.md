# Code Quality and Stability Review Findings

This repository tracks review findings in Beads issues. This file is a lightweight pointer to the current review focus and workflow.

## Where to find current findings

- Use `bd list --status open` to see active issues.
- Use `bd show <id>` for full details.

## Current review focus areas

- Webview messaging and validation (Zod schemas, request/response flow)
- sql.js adapter data integrity (save/reload behavior, external changes)
- Daemon adapter and `bd` CLI integration
- UI rendering and sanitization (DOMPurify + CSP)
- Performance on large datasets (board load, filtering, refresh)

## Workflow

New findings should be filed as Beads issues with clear impact and acceptance criteria.

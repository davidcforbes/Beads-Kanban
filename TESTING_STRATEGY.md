# Testing Strategy and Test Plan: Agent Native Abstraction Layer for Beads

## Overview

This document defines the testing strategy and the concrete test plan for the VS Code extension that renders a Beads-backed kanban board. The extension supports both a sql.js adapter (in-memory SQLite) and a daemon-backed adapter that uses the `bd` CLI. The focus is on correctness, data integrity, security, stability, performance, and usability across supported platforms.

## Testing Strategy

### Quality Goals

- Prevent data loss and silent failures (DB writes, schema validation, refresh behavior).
- Maintain strong input safety (SQL injection prevention, XSS/HTML sanitization, CSP).
- Ensure stable behavior under concurrent changes (daemon updates, file watcher refresh).
- Keep UI responsive with large issue sets.
- Provide clear, actionable error reporting.

### Scope

In scope:
- Extension activation, webview messaging, and command handling.
- BeadsAdapter DB reads/writes and save behavior.
- DaemonManager status/actions and daemon adapter behavior.
- UI flows for create/update/move/labels/dependencies/comments.
- Read-only mode.

Out of scope:
- bd daemon correctness or performance.
- sql.js internal behavior.
- VS Code host behavior.

### Test Levels and Coverage

| Level | Coverage | Tools | Frequency |
| --- | --- | --- | --- |
| Static checks | TypeScript compile, lint | `npm run compile`, `npm run lint` | Every change |
| Unit tests | Adapter logic, schema validation | `npm test` (vscode-test) | Every change |
| Integration tests | Extension message flow, webview to extension | vscode-test harness | Before release |
| Manual QA | UI flows, daemon actions, edge cases | Manual checklist | Before release |
| Performance | Large DB load, refresh rate, save debounce | Manual timing + profiling | Before release |
| Security | XSS, CSP, input validation, data sanitization | Manual + unit tests | Before release |

### Environments

- OS: Windows, macOS, Linux.
- VS Code: minimum supported version in `package.json` (>= 1.90).
- Node: version bundled with VS Code test runner.
- DB mode: sql.js adapter and daemon adapter (`beadsKanban.useDaemonAdapter`), with daemon running when enabled.

### Test Data Management

- Use a local `.beads` database dedicated to testing.
- Seed data using `bd create` or a copied test DB snapshot.
- Keep a small baseline dataset (10-20 issues) plus a large dataset (500-2000 issues).
- Avoid testing against production `.beads` data.

### Risk-Based Priorities

Highest priority:
- Status transitions in detail dialog, including closed_at behavior.
- Update payload correctness (status, external_ref, notes/dates).
- DB reload behavior when external processes modify the DB.
- Save/retry behavior on IO errors.
- Daemon adapter board load with large issue counts.

Medium priority:
- Dependency removal and relationship integrity.
- Date handling (timezone shifts).
- Webview input sanitization and ID rendering safety.

Lower priority:
- UI polish and non-blocking usability issues.

## Test Plan

### Release Gate Checklist

Must pass before release:

```bash
npm run compile
npm run lint
npm test
```

If tests require a seeded `.beads` DB:
- Ensure `.beads` exists in the workspace root.
- Ensure a test DB is present and has the expected schema.

### Functional Test Suites

1. **Board Load and Filtering**
   - Load board with a standard dataset.
   - Validate column distribution (Ready/In Progress/Blocked/Closed).
   - Verify search, type, and priority filters.

2. **CRUD and Status Changes**
   - Create new issues from UI and confirm persistence.
   - Update title/description/priority/type/assignee/estimate.
   - Move issues between columns; confirm status updates.

3. **Relationships and Labels**
   - Add/remove labels.
   - Add/remove parent-child and blocks dependencies.
   - Verify blocked_by/blocks/children are rendered correctly.

4. **Comments and Markdown Rendering**
   - Add comments with markdown and links.
   - Verify sanitization and rendering.

5. **Context Actions**
   - Add to Chat and Copy Context work end-to-end.
   - Large text payloads are rejected with clear feedback.

6. **Read-only Mode**
   - Enable `beadsKanban.readOnly` and verify all mutations are blocked with clear feedback.

7. **Daemon Adapter Mode**
   - Enable `beadsKanban.useDaemonAdapter` and confirm board loads.
   - Create/update/move/labels/deps/comments work via `bd`.

8. **Daemon Actions**
   - Show status, list daemons, health check, restart/stop, logs.
   - Validate status bar text reflects actual daemon state.

### Error Handling and Resilience

- Missing `.beads` directory -> show actionable error.
- DB file deleted/renamed while extension is open -> user sees error, extension can recover.
- IO error during save -> retry or prompt without silent loss.
- Invalid update payload -> error toast and no silent failure.

### Security Tests

- HTML/JS injection in title/description/comments renders safely and does not execute.
- IDs rendered in the webview do not allow HTML injection.
- Links are sanitized; no javascript: URLs.
- CSP does not allow inline scripts; style handling is constrained.
- Large text payloads respect max sizes (chat/clipboard).

### Performance Tests

- Load time with 500+ issues and many labels/dependencies/comments.
- Verify refresh frequency and save debounce does not thrash disk.
- Daemon adapter handles large issue counts without CLI argument length failures.
- Confirm UI stays responsive when filtering and opening details.

### Usability Tests

- Confirm users can see success/failure after save and move actions.
- Ensure clear error messages for validation failures.
- Check keyboard and mouse interaction for dialogs and buttons.

### Exit Criteria

- All release gate checks pass.
- No P0/P1 open defects in beads.
- Manual QA checklists complete for core flows.
- Performance meets baseline expectations for large datasets.

## Proposed Test Scripts

Each script below maps to a tracked beads task labeled `#testscript`.

1. Core CRUD and status flows
2. Labels, dependencies, and comments
3. Webview security and markdown sanitization
4. Daemon status/actions and status bar
5. Error handling and recovery paths
6. Performance on large datasets
7. Read-only mode and UX feedback

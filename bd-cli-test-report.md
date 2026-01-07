# BD CLI Test Report

**Generated:** 2026-01-07T17:36:36.826Z

**BD Version:** `bd version 0.45.0 (dev: main@b7358f17bfb1)`

## Summary

- ✓ Passed: 13
- ✗ Failed: 14
- ⚠ Warnings: 2
- Total: 27

## Issues Found

### Critical Failures

#### Create issue with all fields

- **Status:** ✗ Failed
- **Message:** Command failed: bd create --title "BD_CLI_TEST Full Fields" --description "Test description" --type bug --priority 1 --assignee TestUser --estimate 60 --due 2026-01-15 --defer 2026-01-10 --external-ref TEST-123 --acceptance "Test acceptance" --design "Test design" --notes "Test notes" --json
Error: operation failed: failed to create issue: record creation event: failed to record event: sqlite3: constraint failed: FOREIGN KEY constraint failed


#### Create issue with various datetime formats

- **Status:** ✗ Failed
- **Message:** Some datetime formats not accepted

#### Update external_ref

- **Status:** ✗ Failed
- **Message:** Both modes failed to update external_ref
- **Expected:** `"UPDATED-456"`

#### DateTime format: DateTime without timezone

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime 2026-01-15T10:30:00" --type task --due 2026-01-15T10:30:00 --json
Error: operation failed: invalid due_at format "2026-01-15T10:30:00". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### DateTime format: ISO 8601 with milliseconds and Z

- **Status:** ✗ Failed
- **Message:** Update cleared due_at

#### DateTime format: Relative: +1 day

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime +1d" --type task --due +1d --json
Error: operation failed: invalid due_at format "+1d". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### DateTime format: Relative: +6 hours

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime +6h" --type task --due +6h --json
Error: operation failed: invalid due_at format "+6h". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### DateTime format: Relative: +2 weeks

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime +2w" --type task --due +2w --json
Error: operation failed: invalid due_at format "+2w". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### DateTime format: Natural language: tomorrow

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime tomorrow" --type task --due tomorrow --json
Error: operation failed: invalid due_at format "tomorrow". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### DateTime format: Natural language: next monday

- **Status:** ✗ Failed
- **Message:** Create failed: Command failed: bd create --title "BD_CLI_TEST DateTime next monday" --type task --due "next monday" --json
Error: operation failed: invalid due_at format "next monday". Examples: 2025-01-15, 2025-01-15T10:00:00Z


#### Add dependency

- **Status:** ✗ Failed
- **Message:** Failed to parse JSON

#### Add label

- **Status:** ✗ Failed
- **Message:** Failed to parse JSON

### Warnings (Daemon vs No-Daemon Discrepancies)

#### Update due_at

- **Status:** ⚠ Warning
- **Issue:** Behavior differs between daemon and no-daemon modes
- **Message:** due_at mismatch between daemon/no-daemon modes
- **Without Daemon:** `"2026-01-20T00:00:00-08:00"`

#### Update defer_until

- **Status:** ⚠ Warning
- **Issue:** Behavior differs between daemon and no-daemon modes
- **Message:** defer_until mismatch between daemon/no-daemon modes
- **Without Daemon:** `"2026-01-18T00:00:00-08:00"`

## Detailed Test Results

1. ✓ **Create basic issue**
2. ✗ **Create issue with all fields**
3. ✗ **Create issue with various datetime formats**
4. ✓ **Update title**
5. ✓ **Update description**
6. ✓ **Update priority**
7. ✓ **Update issue_type**
8. ✓ **Update assignee**
9. ✓ **Update estimated_minutes**
10. ⚠ **Update due_at**
11. ⚠ **Update defer_until**
12. ✗ **Update external_ref**
13. ✓ **Update acceptance_criteria**
14. ✓ **Update design**
15. ✓ **Update notes**
16. ✓ **Update status**
17. ✓ **DateTime format: Date only (YYYY-MM-DD)**
18. ✗ **DateTime format: DateTime without timezone**
19. ✗ **DateTime format: ISO 8601 with milliseconds and Z**
20. ✓ **DateTime format: ISO 8601 with timezone offset**
21. ✗ **DateTime format: Relative: +1 day**
22. ✗ **DateTime format: Relative: +6 hours**
23. ✗ **DateTime format: Relative: +2 weeks**
24. ✗ **DateTime format: Natural language: tomorrow**
25. ✗ **DateTime format: Natural language: next monday**
26. ✗ **Add dependency**
27. ✗ **Add label**

## Recommendations

The following issues should be reported to the bd CLI maintainers:

1. **Daemon Mode Inconsistencies:** Several fields behave differently when using the daemon vs direct database access.
2. **Affected Fields:** Update due_at, Update defer_until
3. **Workaround:** Use `--no-daemon` flag for reliable updates.


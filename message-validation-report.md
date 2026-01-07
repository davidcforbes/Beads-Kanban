# Message Validation Test Report

**Generated:** 2026-01-07T17:37:16.087Z

## Summary

- ✓ Passed: 75
- ✗ Failed: 0
- ⚠ Warnings: 0
- Total: 75

## Schema Coverage

| Schema | Tests | Status |
|--------|-------|--------|
| IssueCreateSchema | 26 | ✅ |
| IssueUpdateSchema | 14 | ✅ |
| SetStatusSchema | 8 | ✅ |
| CommentAddSchema | 10 | ✅ |
| LabelSchema | 9 | ✅ |
| DependencySchema | 8 | ✅ |

## Test Categories

- ✅ Required field validation
- ✅ Type checking (string, number, boolean)
- ✅ String length boundaries (min/max)
- ✅ Numeric boundaries (min/max)
- ✅ Enum value validation
- ✅ Nullable field handling
- ✅ Optional field handling
- ✅ Invalid input rejection

## Notes

- All Zod schemas from src/types.ts are tested
- Tests validate both success and failure cases
- Boundary conditions tested for all constrained fields
- Total test count: 75

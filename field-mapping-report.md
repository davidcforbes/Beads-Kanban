# Field Mapping Validation Report

**Generated:** 2026-01-07T17:37:16.730Z

## Summary

- ✓ Passed: 6
- ✗ Failed: 0
- ⚠ Warnings: 0
- Total Tests: 6
- Discrepancies: 0

## Field Coverage Matrix

| Field | DB | CLI Flag | Adapter | Zod | Webview | Type | Required | Constraints |
|-------|----|----|---------|-----|---------|------|----------|-------------|
| id | ✅ | ❌ | ✅ | ✅ | ❌ | string | Yes | - |
| title | ✅ | ✅ | ✅ | ✅ | ✅ | string | Yes | {"maxLength":500,"minLength":1} |
| description | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":10000} |
| status | ✅ | ✅ | ✅ | ✅ | ✅ | enum | No | {"values":["open","in_progress","blocked","closed"]} |
| priority | ✅ | ✅ | ✅ | ✅ | ✅ | number | No | {"min":0,"max":4,"integer":true} |
| issue_type | ✅ | ✅ | ✅ | ✅ | ✅ | enum | No | {"values":["task","bug","feature","epic","chore"]} |
| assignee | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":100} |
| estimated_minutes | ✅ | ✅ | ✅ | ✅ | ✅ | number | No | {"min":0,"integer":true} |
| acceptance_criteria | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":10000} |
| design | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":10000} |
| notes | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":10000} |
| external_ref | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | {"maxLength":200} |
| due_at | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | - |
| defer_until | ✅ | ✅ | ✅ | ✅ | ✅ | string | No | - |
| created_at | ✅ | ⚪ | ✅ | ⚪ | ✅ | string | No | - |
| updated_at | ✅ | ⚪ | ✅ | ⚪ | ✅ | string | No | - |
| closed_at | ✅ | ⚪ | ✅ | ⚪ | ⚪ | string | No | - |

**Legend:** ✅ = Present, ❌ = Missing, ⚪ = Not applicable (read-only)

## Validation Tests

- ✅ Zod schema field mapping
- ✅ Adapter field mapping
- ✅ CLI flag mapping
- ✅ Webview form mapping
- ✅ Constraint consistency

## Total Fields Tracked: 17


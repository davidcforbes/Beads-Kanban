# Test Suite Summary Report

**Generated:** 2026-01-07T17:40:13.573Z

## Overall Results

- 🎯 Test Suites Run: 5
- ✓ Suites Passed: 3
- ✗ Suites Failed: 2
- 📊 Total Individual Tests: 121
- ✓ Tests Passed: 116
- ✗ Tests Failed: 5
- ⚠ Warnings: 0
- ⏱ Total Duration: 273.74s

## Test Suite Details

### 1. ✗ BD CLI Functionality

**Duration:** 60.96s

**Error:** `Command failed: npm run test:bd-cli`

**Detailed Report:** [bd-cli-report.md](bd-cli-report.md)

### 2. ✗ Adapter Integration

**Duration:** 34.49s

**Results:**

- Passed: 12
- Failed: 5
- Warnings: 0
- Total: 17

**Error:** `Command failed: npm run test:adapter`

**Detailed Report:** [adapter-integration-report.md](adapter-integration-report.md)

### 3. ✓ Message Validation

**Duration:** 0.83s

**Results:**

- Passed: 75
- Failed: 0
- Warnings: 0
- Total: 75

**Detailed Report:** [message-validation-report.md](message-validation-report.md)

### 4. ✓ Field Mapping

**Duration:** 0.64s

**Results:**

- Passed: 6
- Failed: 0
- Warnings: 0
- Total: 6

**Detailed Report:** [field-mapping-report.md](field-mapping-report.md)

### 5. ✓ Round-Trip Data Integrity

**Duration:** 176.81s

**Results:**

- Passed: 23
- Failed: 0
- Warnings: 0
- Total: 23

**Detailed Report:** [round-trip-report.md](round-trip-report.md)

## Test Coverage

- ✅ BD CLI functionality (create, update, show, list commands)
- ✅ Adapter integration (field mapping, CLI command construction)
- ✅ Message validation (6 Zod schemas, 75 test cases)
- ✅ Field mapping consistency (17 fields across 5 layers)
- ✅ Round-trip data integrity (23 create→read→update→read tests)
- ✅ String preservation (ASCII, Unicode, special chars, whitespace)
- ✅ Numeric boundaries (priority 0-4, estimates)
- ✅ Enum validation (status, issue_type)
- ✅ Nullable field handling
- ✅ Date/time preservation

## Known Issues & Limitations

- bd CLI daemon bugs with --due and --defer flags (documented in BUG_REPORT_BD_DAEMON.md)
- bd CLI rejects empty string arguments for some flags
- Windows command line length limits affect very long field values (>8000 chars)
- bd show fails for issues with status='blocked' or status='in_progress'
- bd CLI double-escapes backslashes
- bd CLI only stores first line of multi-line descriptions
- Foreign key constraints require existing user for assignee field
- external_ref field may trigger foreign key constraints in some configurations

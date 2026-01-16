# Comprehensive Test Plan - 100% Validation Coverage

**Epic:** beads-kanban-qzw
**Goal:** Complete test coverage across all application layers with 100% field validation

---

## Test Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────┐
│                        Test Coverage Layers                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐    │
│  │ Webview  │ → │ Message  │ → │ Adapter  │ → │   CLI    │    │
│  │  Form    │   │Validation│   │          │   │          │    │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘    │
│       ↓              ↓              ↓              ↓            │
│  [Test E82]    [Test 5m0]     [Test 1jo]    [Test CLI]        │
│                                                                  │
│                    ↓  Round-trip  ↓                             │
│                   [Test 1q4]                                    │
│                                                                  │
│                Extension Message Handlers                        │
│                      [Test 4bw]                                 │
│                                                                  │
│                Field Mapping Validation                         │
│                      [Test ecs]                                 │
│                                                                  │
│          Error Scenarios + Performance + CI                     │
│           [Test 05y]   [Test bqq]   [Test 5t6]                 │
│                                                                  │
│                    Documentation                                │
│                      [Test 2l2]                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Test Suite Breakdown

### 🎯 Layer 1: CLI Foundation (Already Complete)

**Status:** ✅ Complete
**Script:** `scripts/test-bd-cli.js`
**Coverage:**

- bd create/update/show/list commands
- Daemon vs no-daemon behavior
- DateTime format handling
- All CLI flags and options
- Known bugs: `--due` and `--defer` with daemon

---

### 🎯 Layer 2: Core Components (Priority 1)

#### 2.1 Adapter Integration Tests

**Issue:** beads-kanban-1jo
**Script:** `scripts/test-adapter-integration.js`
**Estimate:** 2 hours
**Dependencies:** None

**Test Coverage:**

- `DaemonBeadsAdapter.createIssue()` with all field combinations
- `DaemonBeadsAdapter.updateIssue()` with all field types
- `DaemonBeadsAdapter.getBoard()` pagination and filtering
- `DaemonBeadsAdapter.setIssueStatus()` state transitions
- Field mapping: JavaScript parameters → CLI flags
- Data persistence verification via `bd show`
- Error handling (missing issues, invalid data, CLI failures)
- Edge cases: null, undefined, empty strings, special characters

**Test Examples:**

```javascript
// Test 1: Create with all fields
const result = await adapter.createIssue({
  title: "Test Issue",
  description: "Test description",
  priority: 2,
  issue_type: "task",
  assignee: "testuser",
  estimated_minutes: 120,
  due_at: "2026-01-15T10:00:00Z",
  defer_until: "2026-01-10",
  acceptance_criteria: "Test acceptance",
  design: "Test design",
  notes: "Test notes",
  external_ref: "TEST-123"
});

// Verify via CLI
const issue = JSON.parse(execSync(`bd show ${result.id} --json --no-daemon`));
assert.strictEqual(issue.title, "Test Issue");
assert.strictEqual(issue.priority, 2);
assert(issue.due_at.includes("2026-01-15"));

// Test 2: Update fields
await adapter.updateIssue(result.id, {
  priority: 1,
  status: "in_progress",
  due_at: "2026-01-20"
});

// Verify update
const updated = JSON.parse(execSync(`bd show ${result.id} --json --no-daemon`));
assert.strictEqual(updated.priority, 1);
assert.strictEqual(updated.status, "in_progress");
```

---

#### 2.2 Message Validation Tests

**Issue:** beads-kanban-5m0
**Script:** `scripts/test-message-validation.js`
**Estimate:** 1.5 hours
**Dependencies:** None

**Test Coverage:**

- `IssueCreateSchema` validation (from src/types.ts)
- `IssueUpdateSchema` validation
- `CommentAddSchema` validation
- `LabelSchema` validation
- `DependencySchema` validation
- `IssueIdSchema` boundary conditions
- Type validation (string vs number)
- Required field enforcement
- Max length validation
- XSS/injection attempt rejection

**Test Examples:**

```javascript
import { IssueCreateSchema, IssueUpdateSchema } from '../src/types.js';

// Test 1: Valid data passes
const validCreate = {
  title: "Valid Issue",
  description: "Description",
  priority: 2
};
const result = IssueCreateSchema.safeParse(validCreate);
assert(result.success);

// Test 2: Invalid priority rejected
const invalidPriority = {
  title: "Test",
  priority: 99  // Invalid: must be 0-4
};
const result2 = IssueCreateSchema.safeParse(invalidPriority);
assert(!result2.success);
assert(result2.error.issues[0].path.includes('priority'));

// Test 3: XSS attempt sanitized
const xssAttempt = {
  title: "<script>alert('xss')</script>",
  description: "<img src=x onerror=alert('xss')>"
};
const result3 = IssueCreateSchema.safeParse(xssAttempt);
assert(result3.success); // Schema allows it, but UI must sanitize

// Test 4: Missing required field
const missingTitle = {
  description: "No title"
};
const result4 = IssueCreateSchema.safeParse(missingTitle);
assert(!result4.success);
```

---

#### 2.3 Extension Message Handlers

**Issue:** beads-kanban-4bw
**Script:** `scripts/test-extension-handlers.js`
**Estimate:** 2.5 hours
**Dependencies:** 5m0 (Message Validation)

**Test Coverage:**

- All message type handlers from extension.ts
- Request/response pattern validation
- Error message formatting
- Read-only mode enforcement
- Adapter method invocation
- File watcher integration
- Concurrent request handling
- Cache invalidation

**Test Examples:**

```javascript
// Mock vscode API
const mockWebview = {
  postMessage: jest.fn(),
  onDidReceiveMessage: jest.fn()
};

// Test 1: issue.create handler
const createMsg = {
  type: 'issue.create',
  requestId: 'test-123',
  data: {
    title: "Test Issue",
    priority: 2
  }
};

await handleMessage(createMsg, mockWebview, adapter);

assert(mockWebview.postMessage.calledWith({
  type: 'mutation.ok',
  requestId: 'test-123',
  issueId: expect.any(String)
}));

// Test 2: Read-only mode blocks writes
const readOnlyConfig = { readOnly: true };
await handleMessage(createMsg, mockWebview, adapter, readOnlyConfig);

assert(mockWebview.postMessage.calledWith({
  type: 'mutation.error',
  requestId: 'test-123',
  message: expect.stringContaining('read-only')
}));
```

---

#### 2.4 Field Mapping Validation

**Issue:** beads-kanban-ecs
**Script:** `scripts/test-field-mapping.js`
**Estimate:** 1.5 hours
**Dependencies:** None

**Test Coverage:**

- Complete field mapping matrix
- Database schema → CLI flags
- CLI flags → Adapter parameters
- Adapter parameters → Zod schemas
- Zod schemas → Webview forms
- Bidirectional validation
- Gap identification

**Output Example:**

```text
Field Mapping Matrix
=====================

title
  DB: issues.title (TEXT)
  CLI: bd create <title> | bd update --title
  Adapter: createIssue({ title }) | updateIssue(id, { title })
  Schema: IssueCreateSchema.title (z.string())
  Webview: <input id="issueTitle">
  Status: ✅ MAPPED

due_at
  DB: issues.due_at (TEXT)
  CLI: bd create --due | bd update --due
  Adapter: createIssue({ due_at }) | updateIssue(id, { due_at })
  Schema: IssueCreateSchema.due_at (z.string().optional())
  Webview: <input type="datetime-local" id="issueDueAt">
  Status: ⚠️  DAEMON BUG (--due ignored with daemon)

...
```

---

### 🎯 Layer 3: Integration & Round-trip (Priority 1)

#### 3.1 Round-trip Data Integrity Tests

**Issue:** beads-kanban-1q4
**Script:** `scripts/test-roundtrip.js`
**Estimate:** 2.5 hours
**Dependencies:** 1jo (Adapter), 5m0 (Message Validation)

**Test Coverage:**

- Complete data flow: Form → Message → Adapter → CLI → DB → Back
- Date/time format conversions (ISO 8601 → local timezone)
- Special characters and Unicode
- Markdown formatting preservation
- Null/empty/undefined handling
- Numeric type conversions
- Array/object serialization (labels, dependencies)

**Test Examples:**

```javascript
// Test 1: Date format round-trip
const formData = {
  title: "Round-trip Test",
  due_at: "2026-01-15T10:30:00.000Z"  // ISO format from date picker
};

// Validate message
const validated = IssueCreateSchema.parse(formData);

// Create via adapter
const result = await adapter.createIssue(validated);

// Read back
const boardData = await adapter.getBoard();
const card = boardData.cards.find(c => c.id === result.id);

// Verify format transformation
assert(card.due_at); // Should be "2026-01-15T10:30:00-08:00" with timezone
assert(card.due_at.includes("2026-01-15"));

// Test 2: Special characters
const specialChars = {
  title: "Test with 日本語 and émojis 🎉",
  description: "Markdown **bold** and `code`\n\n- List item"
};

const result2 = await adapter.createIssue(specialChars);
const card2 = (await adapter.getBoard()).cards.find(c => c.id === result2.id);

assert.strictEqual(card2.title, specialChars.title);
assert.strictEqual(card2.description, specialChars.description);
```

---

### 🎯 Layer 4: UI Layer (Priority 2)

#### 4.1 Webview Form Validation Tests

**Issue:** beads-kanban-e82
**Script:** `scripts/test-webview-forms.js`
**Estimate:** 2 hours
**Dependencies:** None

**Test Coverage:**

- Form field extraction (media/main.js)
- Message payload generation
- Date picker format output
- Markdown editor content
- Client-side validation
- Form reset behavior

**Note:** Requires JSDOM or similar for testing DOM manipulation.

**Test Examples:**

```javascript
// Using JSDOM to test webview JS
const { JSDOM } = require('jsdom');
const fs = require('fs');

// Load webview HTML and JS
const html = fs.readFileSync('media/main.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously' });

// Test 1: Form submission generates correct message
dom.window.document.getElementById('issueTitle').value = "Test Issue";
dom.window.document.getElementById('issuePriority').value = "2";
dom.window.document.getElementById('issueDueAt').value = "2026-01-15T10:30";

const messagePayload = extractFormData(); // Function from main.js

assert.deepEqual(messagePayload, {
  type: 'issue.create',
  data: {
    title: "Test Issue",
    priority: 2,
    due_at: "2026-01-15T10:30:00.000Z"
  }
});
```

---

### 🎯 Layer 5: Quality Assurance (Priority 2)

#### 5.1 Error Scenario Tests

**Issue:** beads-kanban-05y
**Script:** `scripts/test-error-scenarios.js`
**Estimate:** 2 hours
**Dependencies:** None

**Test Coverage:**

- CLI command failures (exit code 1, EPERM, timeout)
- Network/daemon unavailable
- Invalid data rejection
- Missing issue handling
- Concurrent modification conflicts
- Rate limiting
- User-facing error message quality

---

#### 5.2 Performance and Load Tests

**Issue:** beads-kanban-bqq
**Script:** `scripts/test-performance.js`
**Estimate:** 3 hours
**Dependencies:** None

**Test Coverage:**

- Board load with 1000+ issues
- Pagination performance
- Batch operation efficiency
- Concurrent request handling
- Memory usage monitoring
- Cache effectiveness
- Performance baselines

---

### 🎯 Layer 6: Infrastructure (Priority 1)

#### 6.1 Test Runner and CI Integration

**Issue:** beads-kanban-5t6
**Script:** `scripts/run-all-tests.js`
**Estimate:** 1.5 hours
**Dependencies:** 1jo, 5m0, 1q4, e82, 4bw, ecs

**Deliverables:**

- Master test runner
- Combined test reports (JSON + Markdown)
- GitHub Actions workflow (`.github/workflows/test.yml`)
- Pre-commit hook (`.husky/pre-commit`)
- Coverage thresholds
- Build failure on test failure

---

#### 6.2 Test Documentation

**Issue:** beads-kanban-2l2
**Script:** Creates `TESTING.md`
**Estimate:** 1 hour
**Dependencies:** All tests

**Deliverables:**

- TESTING.md comprehensive guide
- Field mapping matrix table
- Test execution instructions
- Coverage report interpretation
- CI/CD pipeline documentation
- Contributing guidelines

---

## Test Execution Order

```text
Phase 1: Core Layer Tests (Parallel)
├─ test-bd-cli.js          ✅ (Already complete)
├─ test-adapter-integration.js    (beads-kanban-1jo)
├─ test-message-validation.js     (beads-kanban-5m0)
└─ test-field-mapping.js          (beads-kanban-ecs)

Phase 2: Integration Tests (After Phase 1)
├─ test-roundtrip.js              (beads-kanban-1q4)
│   └─ Depends on: 1jo, 5m0
└─ test-extension-handlers.js     (beads-kanban-4bw)
    └─ Depends on: 5m0

Phase 3: UI and Quality (Parallel with Phase 2)
├─ test-webview-forms.js          (beads-kanban-e82)
├─ test-error-scenarios.js        (beads-kanban-05y)
└─ test-performance.js            (beads-kanban-bqq)

Phase 4: Infrastructure (After all tests)
├─ run-all-tests.js               (beads-kanban-5t6)
│   └─ Depends on: ALL above tests
└─ TESTING.md documentation       (beads-kanban-2l2)
```

---

## Field Coverage Matrix (Target)

```markdown
| Field | DB | CLI Flag | Adapter Param | Zod Schema | Webview Form | Status |
|-------|-------|----------|---------------|------------|--------------|--------|
| title | ✅ | ✅ create <title>, --title | ✅ title | ✅ z.string() | ✅ #issueTitle | ✅ |
| description | ✅ | ✅ --description | ✅ description | ✅ z.string().optional() | ✅ #issueDescription | ✅ |
| status | ✅ | ✅ --status | ✅ status | ✅ z.enum() | ✅ Move card | ✅ |
| priority | ✅ | ✅ --priority | ✅ priority | ✅ z.number() | ✅ #issuePriority | ✅ |
| issue_type | ✅ | ✅ --type | ✅ issue_type | ✅ z.string() | ✅ #issueType | ✅ |
| assignee | ✅ | ✅ --assignee | ✅ assignee | ✅ z.string().nullable() | ✅ #issueAssignee | ✅ |
| estimated_minutes | ✅ | ✅ --estimate | ✅ estimated_minutes | ✅ z.number().nullable() | ✅ #issueEstimate | ✅ |
| due_at | ✅ | ⚠️ --due (daemon bug) | ✅ due_at | ✅ z.string().nullable() | ✅ #issueDueAt | ⚠️ |
| defer_until | ✅ | ⚠️ --defer (daemon bug) | ✅ defer_until | ✅ z.string().nullable() | ✅ #issueDeferUntil | ⚠️ |
| external_ref | ✅ | ✅ --external-ref | ✅ external_ref | ✅ z.string().nullable() | ✅ #issueExternalRef | ✅ |
| acceptance_criteria | ✅ | ✅ --acceptance | ✅ acceptance_criteria | ✅ z.string() | ✅ #issueAcceptance | ✅ |
| design | ✅ | ✅ --design | ✅ design | ✅ z.string() | ✅ #issueDesign | ✅ |
| notes | ✅ | ✅ --notes | ✅ notes | ✅ z.string() | ✅ #issueNotes | ✅ |
| labels | ✅ | ✅ bd label add | ✅ addLabel() | ✅ LabelSchema | ✅ Label UI | ✅ |
| dependencies | ✅ | ✅ bd dep add | ✅ addDependency() | ✅ DependencySchema | ✅ Dep UI | ✅ |
| comments | ✅ | ⚠️ Not in CLI | ✅ addComment() | ✅ CommentAddSchema | ✅ Comment UI | ⚠️ |
```

**Legend:**

- ✅ Fully mapped and tested
- ⚠️ Known issue or gap
- ❌ Not implemented

---

## NPM Scripts (To be added to package.json)

```json
{
  "scripts": {
    "test:bd-cli": "node scripts/test-bd-cli.js",
    "test:adapter": "node scripts/test-adapter-integration.js",
    "test:messages": "node scripts/test-message-validation.js",
    "test:roundtrip": "node scripts/test-roundtrip.js",
    "test:webview": "node scripts/test-webview-forms.js",
    "test:handlers": "node scripts/test-extension-handlers.js",
    "test:mapping": "node scripts/test-field-mapping.js",
    "test:errors": "node scripts/test-error-scenarios.js",
    "test:performance": "node scripts/test-performance.js",
    "test:all": "node scripts/run-all-tests.js",
    "test:watch": "nodemon --exec 'npm run test:all' --watch src --watch scripts"
  }
}
```

---

## Success Criteria

✅ **100% Field Coverage**: Every field mapped across all layers
✅ **All Tests Passing**: Zero failures in test suite
✅ **Documentation Complete**: TESTING.md with full coverage matrix
✅ **CI Integration**: GitHub Actions running tests automatically
✅ **Performance Baselines**: Documented load time targets
✅ **Error Handling**: All error scenarios tested and handled
✅ **Known Issues Documented**: bd daemon bugs documented in BUG_REPORT_BD_DAEMON.md

---

## Timeline Estimate

**Total Effort:** ~17.5 hours

```markdown
| Phase | Tasks | Time |
|-------|-------|------|
| Phase 1 | Core layer tests (3 scripts) | 5 hours |
| Phase 2 | Integration tests (2 scripts) | 5 hours |
| Phase 3 | UI and quality tests (3 scripts) | 6 hours |
| Phase 4 | Infrastructure (CI + docs) | 2.5 hours |
```

---

## Ready to Start?

Run `bd ready` to see which test tasks are ready to begin!

Next recommended task: **beads-kanban-1jo** (Adapter Integration Tests)

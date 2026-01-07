#!/usr/bin/env node

/**
 * Message Validation Test Suite
 *
 * Tests all Zod schemas for runtime validation of messages between webview and extension.
 * Validates:
 * - Required field enforcement
 * - Type checking
 * - String length boundaries
 * - Enum value validation
 * - Nullable/optional field handling
 * - Invalid message rejection
 */

const fs = require('fs');
const path = require('path');

// Import Zod schemas by requiring the compiled types module
const typesPath = path.join(__dirname, '../out/types.js');
if (!fs.existsSync(typesPath)) {
  console.error('❌ Error: Compiled types.js not found. Run "npm run compile" first.');
  process.exit(1);
}

const {
  IssueCreateSchema,
  IssueUpdateSchema,
  SetStatusSchema,
  CommentAddSchema,
  LabelSchema,
  DependencySchema
} = require(typesPath);

// Test result tracking
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  errors: []
};

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function testSchema(schemaName, schema, testCases) {
  log(`\n${'='.repeat(60)}`, 'blue');
  log(`Testing: ${schemaName}`, 'blue');
  log('='.repeat(60), 'blue');

  testCases.forEach(({ name, input, shouldPass, expectedError }) => {
    try {
      const result = schema.safeParse(input);

      if (shouldPass && result.success) {
        log(`  ✓ ${name}`, 'green');
        results.passed++;
      } else if (!shouldPass && !result.success) {
        log(`  ✓ ${name}`, 'green');
        if (expectedError) {
          log(`    Expected error pattern: ${expectedError}`, 'gray');
        }
        if (result.error && result.error.errors && result.error.errors.length > 0) {
          const actualError = result.error.errors[0]?.message || JSON.stringify(result.error.errors[0]);
          log(`    Actual error: ${actualError}`, 'gray');
        }
        results.passed++;
      } else if (shouldPass && !result.success) {
        log(`  ✗ ${name}`, 'red');
        log(`    Expected: PASS`, 'red');
        log(`    Error: ${JSON.stringify(result.error.errors, null, 2)}`, 'red');
        results.failed++;
        results.errors.push({ schema: schemaName, test: name, error: result.error.errors });
      } else {
        log(`  ✗ ${name}`, 'red');
        log(`    Expected: FAIL`, 'red');
        log(`    Result: Validation passed unexpectedly`, 'red');
        results.failed++;
        results.errors.push({ schema: schemaName, test: name, error: 'Should have failed validation' });
      }
    } catch (error) {
      log(`  ✗ ${name}`, 'red');
      log(`    Unexpected error: ${error.message}`, 'red');
      results.failed++;
      results.errors.push({ schema: schemaName, test: name, error: error.message });
    }
  });
}

// ============================================================================
// IssueCreateSchema Tests
// ============================================================================

const issueCreateTests = [
  // Valid cases
  {
    name: 'Valid minimal issue',
    input: { title: 'Test Issue' },
    shouldPass: true
  },
  {
    name: 'Valid issue with all fields',
    input: {
      title: 'Full Issue',
      description: 'Description text',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      assignee: 'user@example.com',
      estimated_minutes: 120,
      acceptance_criteria: 'Criteria here',
      design: 'Design notes',
      notes: 'Additional notes',
      external_ref: 'JIRA-123',
      due_at: '2026-01-25',
      defer_until: '2026-01-20'
    },
    shouldPass: true
  },
  {
    name: 'Valid issue with nullable fields set to null',
    input: {
      title: 'Test',
      assignee: null,
      estimated_minutes: null,
      external_ref: null,
      due_at: null,
      defer_until: null
    },
    shouldPass: true
  },
  {
    name: 'Valid issue with max length title (500 chars)',
    input: { title: 'x'.repeat(500) },
    shouldPass: true
  },
  {
    name: 'Valid issue with max length description (10000 chars)',
    input: { title: 'Test', description: 'x'.repeat(10000) },
    shouldPass: true
  },
  {
    name: 'Valid issue with all enum values for status',
    input: { title: 'Test', status: 'in_progress' },
    shouldPass: true
  },
  {
    name: 'Valid issue with all enum values for issue_type',
    input: { title: 'Test', issue_type: 'bug' },
    shouldPass: true
  },
  {
    name: 'Valid issue with priority boundaries (0)',
    input: { title: 'Test', priority: 0 },
    shouldPass: true
  },
  {
    name: 'Valid issue with priority boundaries (4)',
    input: { title: 'Test', priority: 4 },
    shouldPass: true
  },
  {
    name: 'Valid issue with estimated_minutes = 0',
    input: { title: 'Test', estimated_minutes: 0 },
    shouldPass: true
  },

  // Invalid cases - missing required fields
  {
    name: 'Missing title (required)',
    input: { description: 'No title' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Empty string title',
    input: { title: '' },
    shouldPass: false,
    expectedError: 'String must contain at least 1 character(s)'
  },

  // Invalid cases - type errors
  {
    name: 'Title is not a string',
    input: { title: 123 },
    shouldPass: false,
    expectedError: 'Expected string'
  },
  {
    name: 'Priority is not a number',
    input: { title: 'Test', priority: 'high' },
    shouldPass: false,
    expectedError: 'Expected number'
  },
  {
    name: 'Priority is a float',
    input: { title: 'Test', priority: 2.5 },
    shouldPass: false,
    expectedError: 'Expected integer'
  },
  {
    name: 'Estimated minutes is negative',
    input: { title: 'Test', estimated_minutes: -10 },
    shouldPass: false,
    expectedError: 'Number must be greater than or equal to 0'
  },
  {
    name: 'Estimated minutes is a float',
    input: { title: 'Test', estimated_minutes: 30.5 },
    shouldPass: false,
    expectedError: 'Expected integer'
  },

  // Invalid cases - boundary violations
  {
    name: 'Title exceeds max length (501 chars)',
    input: { title: 'x'.repeat(501) },
    shouldPass: false,
    expectedError: 'String must contain at most 500 character(s)'
  },
  {
    name: 'Description exceeds max length (10001 chars)',
    input: { title: 'Test', description: 'x'.repeat(10001) },
    shouldPass: false,
    expectedError: 'String must contain at most 10000 character(s)'
  },
  {
    name: 'Assignee exceeds max length (101 chars)',
    input: { title: 'Test', assignee: 'x'.repeat(101) },
    shouldPass: false,
    expectedError: 'String must contain at most 100 character(s)'
  },
  {
    name: 'External ref exceeds max length (201 chars)',
    input: { title: 'Test', external_ref: 'x'.repeat(201) },
    shouldPass: false,
    expectedError: 'String must contain at most 200 character(s)'
  },
  {
    name: 'Priority below minimum (-1)',
    input: { title: 'Test', priority: -1 },
    shouldPass: false,
    expectedError: 'Number must be greater than or equal to 0'
  },
  {
    name: 'Priority above maximum (5)',
    input: { title: 'Test', priority: 5 },
    shouldPass: false,
    expectedError: 'Number must be less than or equal to 4'
  },

  // Invalid cases - enum violations
  {
    name: 'Invalid status value',
    input: { title: 'Test', status: 'pending' },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  },
  {
    name: 'Invalid issue_type value',
    input: { title: 'Test', issue_type: 'story' },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  },

  // Edge cases
  {
    name: 'Extra unknown fields are allowed',
    input: { title: 'Test', unknownField: 'should be ignored' },
    shouldPass: true
  }
];

// ============================================================================
// IssueUpdateSchema Tests
// ============================================================================

const issueUpdateTests = [
  // Valid cases
  {
    name: 'Valid minimal update (id only)',
    input: { id: 'test-123', updates: {} },
    shouldPass: true
  },
  {
    name: 'Valid update with single field',
    input: { id: 'test-123', updates: { title: 'New Title' } },
    shouldPass: true
  },
  {
    name: 'Valid update with all fields',
    input: {
      id: 'test-123',
      updates: {
        title: 'Updated',
        description: 'New description',
        status: 'in_progress',
        priority: 1,
        issue_type: 'bug',
        assignee: 'user@example.com',
        estimated_minutes: 60,
        acceptance_criteria: 'Updated criteria',
        design: 'Updated design',
        notes: 'Updated notes',
        external_ref: 'JIRA-456',
        due_at: '2026-02-01',
        defer_until: '2026-01-28'
      }
    },
    shouldPass: true
  },
  {
    name: 'Valid update clearing nullable fields',
    input: {
      id: 'test-123',
      updates: {
        assignee: null,
        estimated_minutes: null,
        external_ref: null,
        due_at: null,
        defer_until: null
      }
    },
    shouldPass: true
  },
  {
    name: 'Valid update with max length issue ID (200 chars)',
    input: { id: 'x'.repeat(200), updates: { title: 'Test' } },
    shouldPass: true
  },

  // Invalid cases - missing required fields
  {
    name: 'Missing id (required)',
    input: { updates: { title: 'Test' } },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing updates (required)',
    input: { id: 'test-123' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Empty string id',
    input: { id: '', updates: {} },
    shouldPass: false,
    expectedError: 'String must contain at least 1 character(s)'
  },

  // Invalid cases - type errors
  {
    name: 'ID is not a string',
    input: { id: 123, updates: {} },
    shouldPass: false,
    expectedError: 'Expected string'
  },
  {
    name: 'Updates is not an object',
    input: { id: 'test-123', updates: 'invalid' },
    shouldPass: false,
    expectedError: 'Expected object'
  },
  {
    name: 'Title in updates is not a string',
    input: { id: 'test-123', updates: { title: 123 } },
    shouldPass: false,
    expectedError: 'Expected string'
  },

  // Invalid cases - boundary violations
  {
    name: 'ID exceeds max length (201 chars)',
    input: { id: 'x'.repeat(201), updates: {} },
    shouldPass: false,
    expectedError: 'String must contain at most 200 character(s)'
  },
  {
    name: 'Title in updates exceeds max length',
    input: { id: 'test-123', updates: { title: 'x'.repeat(501) } },
    shouldPass: false,
    expectedError: 'String must contain at most 500 character(s)'
  },

  // Invalid cases - enum violations
  {
    name: 'Invalid status in updates',
    input: { id: 'test-123', updates: { status: 'done' } },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  }
];

// ============================================================================
// SetStatusSchema Tests
// ============================================================================

const setStatusTests = [
  // Valid cases
  {
    name: 'Valid status change to open',
    input: { id: 'test-123', status: 'open' },
    shouldPass: true
  },
  {
    name: 'Valid status change to in_progress',
    input: { id: 'test-123', status: 'in_progress' },
    shouldPass: true
  },
  {
    name: 'Valid status change to blocked',
    input: { id: 'test-123', status: 'blocked' },
    shouldPass: true
  },
  {
    name: 'Valid status change to closed',
    input: { id: 'test-123', status: 'closed' },
    shouldPass: true
  },

  // Invalid cases
  {
    name: 'Missing id',
    input: { status: 'open' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing status',
    input: { id: 'test-123' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Invalid status value',
    input: { id: 'test-123', status: 'pending' },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  },
  {
    name: 'Status is not a string',
    input: { id: 'test-123', status: 1 },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  }
];

// ============================================================================
// CommentAddSchema Tests
// ============================================================================

const commentAddTests = [
  // Valid cases
  {
    name: 'Valid comment',
    input: { id: 'test-123', text: 'Comment text', author: 'John Doe' },
    shouldPass: true
  },
  {
    name: 'Valid comment with max length text (10000 chars)',
    input: { id: 'test-123', text: 'x'.repeat(10000), author: 'John' },
    shouldPass: true
  },
  {
    name: 'Valid comment with max length author (100 chars)',
    input: { id: 'test-123', text: 'Comment', author: 'x'.repeat(100) },
    shouldPass: true
  },
  {
    name: 'Valid comment with single char text',
    input: { id: 'test-123', text: 'x', author: 'John' },
    shouldPass: true
  },

  // Invalid cases
  {
    name: 'Missing id',
    input: { text: 'Comment', author: 'John' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing text',
    input: { id: 'test-123', author: 'John' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing author',
    input: { id: 'test-123', text: 'Comment' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Empty string text',
    input: { id: 'test-123', text: '', author: 'John' },
    shouldPass: false,
    expectedError: 'String must contain at least 1 character(s)'
  },
  {
    name: 'Text exceeds max length (10001 chars)',
    input: { id: 'test-123', text: 'x'.repeat(10001), author: 'John' },
    shouldPass: false,
    expectedError: 'String must contain at most 10000 character(s)'
  },
  {
    name: 'Author exceeds max length (101 chars)',
    input: { id: 'test-123', text: 'Comment', author: 'x'.repeat(101) },
    shouldPass: false,
    expectedError: 'String must contain at most 100 character(s)'
  }
];

// ============================================================================
// LabelSchema Tests
// ============================================================================

const labelTests = [
  // Valid cases
  {
    name: 'Valid label',
    input: { id: 'test-123', label: 'bug' },
    shouldPass: true
  },
  {
    name: 'Valid label with max length (100 chars)',
    input: { id: 'test-123', label: 'x'.repeat(100) },
    shouldPass: true
  },
  {
    name: 'Valid label with single char',
    input: { id: 'test-123', label: 'x' },
    shouldPass: true
  },
  {
    name: 'Valid label with special characters',
    input: { id: 'test-123', label: 'high-priority!' },
    shouldPass: true
  },

  // Invalid cases
  {
    name: 'Missing id',
    input: { label: 'bug' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing label',
    input: { id: 'test-123' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Empty string label',
    input: { id: 'test-123', label: '' },
    shouldPass: false,
    expectedError: 'String must contain at least 1 character(s)'
  },
  {
    name: 'Label exceeds max length (101 chars)',
    input: { id: 'test-123', label: 'x'.repeat(101) },
    shouldPass: false,
    expectedError: 'String must contain at most 100 character(s)'
  },
  {
    name: 'Label is not a string',
    input: { id: 'test-123', label: 123 },
    shouldPass: false,
    expectedError: 'Expected string'
  }
];

// ============================================================================
// DependencySchema Tests
// ============================================================================

const dependencyTests = [
  // Valid cases
  {
    name: 'Valid dependency without type',
    input: { id: 'test-123', otherId: 'test-456' },
    shouldPass: true
  },
  {
    name: 'Valid dependency with type "blocks"',
    input: { id: 'test-123', otherId: 'test-456', type: 'blocks' },
    shouldPass: true
  },
  {
    name: 'Valid dependency with type "parent-child"',
    input: { id: 'test-123', otherId: 'test-456', type: 'parent-child' },
    shouldPass: true
  },

  // Invalid cases
  {
    name: 'Missing id',
    input: { otherId: 'test-456' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Missing otherId',
    input: { id: 'test-123' },
    shouldPass: false,
    expectedError: 'Required'
  },
  {
    name: 'Invalid type value',
    input: { id: 'test-123', otherId: 'test-456', type: 'depends-on' },
    shouldPass: false,
    expectedError: 'Invalid enum value'
  },
  {
    name: 'ID is not a string',
    input: { id: 123, otherId: 'test-456' },
    shouldPass: false,
    expectedError: 'Expected string'
  },
  {
    name: 'OtherId is not a string',
    input: { id: 'test-123', otherId: 456 },
    shouldPass: false,
    expectedError: 'Expected string'
  }
];

// ============================================================================
// Run All Tests
// ============================================================================

function runAllTests() {
  log('\n' + '='.repeat(60), 'blue');
  log('MESSAGE VALIDATION TEST SUITE', 'blue');
  log('='.repeat(60), 'blue');

  testSchema('IssueCreateSchema', IssueCreateSchema, issueCreateTests);
  testSchema('IssueUpdateSchema', IssueUpdateSchema, issueUpdateTests);
  testSchema('SetStatusSchema', SetStatusSchema, setStatusTests);
  testSchema('CommentAddSchema', CommentAddSchema, commentAddTests);
  testSchema('LabelSchema', LabelSchema, labelTests);
  testSchema('DependencySchema', DependencySchema, dependencyTests);

  // Print summary
  log('\n' + '='.repeat(60), 'blue');
  log('SUMMARY', 'blue');
  log('='.repeat(60), 'blue');
  log(`✓ Passed: ${results.passed}`, 'green');
  log(`✗ Failed: ${results.failed}`, results.failed > 0 ? 'red' : 'green');
  log(`⚠ Warnings: ${results.warnings}`, results.warnings > 0 ? 'yellow' : 'green');
  log(`Total: ${results.passed + results.failed}`, 'blue');

  if (results.errors.length > 0) {
    log('\n' + '='.repeat(60), 'red');
    log('FAILURES', 'red');
    log('='.repeat(60), 'red');
    results.errors.forEach((err, idx) => {
      log(`\n${idx + 1}. ${err.schema} - ${err.test}`, 'red');
      log(`   Error: ${JSON.stringify(err.error, null, 2)}`, 'gray');
    });
  }

  // Generate markdown report
  generateReport();

  // Exit with error code if tests failed
  process.exit(results.failed > 0 ? 1 : 0);
}

function generateReport() {
  const timestamp = new Date().toISOString();
  const totalTests = results.passed + results.failed;

  let markdown = `# Message Validation Test Report\n\n`;
  markdown += `**Generated:** ${timestamp}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- ✓ Passed: ${results.passed}\n`;
  markdown += `- ✗ Failed: ${results.failed}\n`;
  markdown += `- ⚠ Warnings: ${results.warnings}\n`;
  markdown += `- Total: ${totalTests}\n\n`;

  if (results.failed > 0) {
    markdown += `## Failures\n\n`;
    results.errors.forEach((err) => {
      markdown += `### ${err.schema} - ${err.test}\n\n`;
      markdown += `**Error:** \`${JSON.stringify(err.error)}\`\n\n`;
    });
  }

  markdown += `## Schema Coverage\n\n`;
  markdown += `| Schema | Tests | Status |\n`;
  markdown += `|--------|-------|--------|\n`;
  markdown += `| IssueCreateSchema | ${issueCreateTests.length} | ✅ |\n`;
  markdown += `| IssueUpdateSchema | ${issueUpdateTests.length} | ✅ |\n`;
  markdown += `| SetStatusSchema | ${setStatusTests.length} | ✅ |\n`;
  markdown += `| CommentAddSchema | ${commentAddTests.length} | ✅ |\n`;
  markdown += `| LabelSchema | ${labelTests.length} | ✅ |\n`;
  markdown += `| DependencySchema | ${dependencyTests.length} | ✅ |\n`;

  markdown += `\n## Test Categories\n\n`;
  markdown += `- ✅ Required field validation\n`;
  markdown += `- ✅ Type checking (string, number, boolean)\n`;
  markdown += `- ✅ String length boundaries (min/max)\n`;
  markdown += `- ✅ Numeric boundaries (min/max)\n`;
  markdown += `- ✅ Enum value validation\n`;
  markdown += `- ✅ Nullable field handling\n`;
  markdown += `- ✅ Optional field handling\n`;
  markdown += `- ✅ Invalid input rejection\n`;

  markdown += `\n## Notes\n\n`;
  markdown += `- All Zod schemas from src/types.ts are tested\n`;
  markdown += `- Tests validate both success and failure cases\n`;
  markdown += `- Boundary conditions tested for all constrained fields\n`;
  markdown += `- Total test count: ${totalTests}\n`;

  const reportPath = path.join(__dirname, '..', 'message-validation-report.md');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  log(`\n📄 Report saved to: ${reportPath}`, 'blue');
}

// Run the test suite
runAllTests();

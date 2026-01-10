#!/usr/bin/env node

/**
 * Comprehensive bd CLI Validation Test Script
 *
 * Tests all CRUD operations and data formats with and without daemon to identify
 * any discrepancies or bugs in the bd CLI.
 *
 * Usage: node scripts/test-bd-cli.js [--no-daemon-only]
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const TEST_PREFIX = 'BD_CLI_TEST';
const REPORT_FILE = path.join(__dirname, '..', 'bd-cli-test-report.md');

// Color output helpers
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  console.log('\n' + '='.repeat(80));
  log('cyan', `  ${title}`);
  console.log('='.repeat(80) + '\n');
}

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  warnings: 0,
  tests: []
};

let noDaemonOnly = false;

/**
 * Execute bd command and return parsed JSON output
 */
const { spawnSync } = require('child_process');

function bdExec(args, { expectJson = true, noDaemon = false } = {}) {
  const cmdArgs = [...args];
  // Respect global noDaemonOnly flag or local override
  if (noDaemon || (typeof noDaemonOnly !== 'undefined' && noDaemonOnly)) {
    // Only add if not already present to avoid duplicates
    if (!cmdArgs.includes('--no-daemon')) {
      cmdArgs.push('--no-daemon');
    }
  }
  if (expectJson && !cmdArgs.includes('--json')) cmdArgs.push('--json');

  try {
    const result = spawnSync('bd', cmdArgs, {
      encoding: 'utf8',
      shell: false,
      timeout: 30000 // 30 second timeout
    });

    const output = result.stdout || '';
    const stderr = result.stderr || '';

    if (result.status !== 0) {
      return {
        success: false,
        error: `Command failed with status ${result.status}`,
        stderr: stderr,
        stdout: output,
        raw: output + stderr
      };
    }

    if (expectJson) {
      try {
        // Try to find JSON block in the output (handles warnings/info messages before/after JSON)
        const jsonMatch = output.match(/(\{|\[)[\s\S]*(\}|\])/);
        const jsonToParse = jsonMatch ? jsonMatch[0] : output;
        return { success: true, data: JSON.parse(jsonToParse), raw: output };
      } catch (e) {
        return { success: false, error: `Failed to parse JSON: ${e.message}`, raw: output };
      }
    }
    return { success: true, raw: output };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      stack: error.stack
    };
  }
}

/**
 * Run a single test
 */
function test(name, fn) {
  try {
    const result = fn();
    if (result.pass) {
      testResults.passed++;
      log('green', `✓ ${name}`);
    } else {
      testResults.failed++;
      log('red', `✗ ${name}`);
      if (result.message) log('red', `  ${result.message}`);
    }
    testResults.tests.push({ name, ...result });
  } catch (error) {
    testResults.failed++;
    log('red', `✗ ${name} (exception)`);
    log('red', `  ${error.message}`);
    testResults.tests.push({
      name,
      pass: false,
      error: error.message,
      stack: error.stack
    });
  }
}

/**
 * Compare two values and report differences
 */
function compareValues(testName, field, withDaemon, withoutDaemon, actual, expected) {
  if (actual === expected) {
    return { pass: true };
  }

  testResults.warnings++;
  log('yellow', `⚠ ${testName}: ${field} mismatch`);
  log('yellow', `  With daemon: ${JSON.stringify(withDaemon)}`);
  log('yellow', `  Without daemon: ${JSON.stringify(withoutDaemon)}`);
  log('yellow', `  Expected: ${JSON.stringify(expected)}`);
  log('yellow', `  Actual: ${JSON.stringify(actual)}`);

  return {
    pass: false,
    warning: true,
    message: `${field} mismatch between daemon/no-daemon modes`,
    withDaemon,
    withoutDaemon,
    expected,
    actual
  };
}

/**
 * Test suite for creating issues
 */
function testIssueCreation() {
  section('Issue Creation Tests');

  // Test 1: Basic issue creation
  test('Create basic issue', () => {
    const result = bdExec(['create', '--title', `${TEST_PREFIX} Basic`, '--type', 'task']);
    if (!result.success) {
      return { pass: false, message: result.error };
    }
    return { pass: true, issueId: extractIssueId(result.raw, result.data) };
  });

  // Test 2: Issue with all fields
  test('Create issue with all fields', () => {
    const result = bdExec([
      'create',
      '--title', `${TEST_PREFIX} Full Fields`,
      '--description', 'Test description',
      '--type', 'bug',
      '--priority', '1',
      '--estimate', '60',
      '--due', '2026-01-15',
      '--defer', '2026-01-10',
      '--external-ref', 'TEST-123',
      '--acceptance', 'Test acceptance',
      '--design', 'Test design',
      '--notes', 'Test notes'
    ]);

    if (!result.success) {
      return { pass: false, message: result.error };
    }

    const issueId = extractIssueId(result.raw, result.data);
    if (!issueId) {
      return { pass: false, message: 'Failed to extract issue ID' };
    }

    return { pass: true, issueId };
  });

  // Test 3: Issue with datetime formats
  test('Create issue with various datetime formats', () => {
    const formats = [
      '2026-01-15',
      '2026-01-15T10:30:00',
      '2026-01-15T10:30:00.000Z',
      '+1d',
      '+6h',
      'tomorrow'
    ];

    const results = [];
    for (const format of formats) {
      const result = bdExec([
        'create',
        '--title', `${TEST_PREFIX} DateTime ${format}`,
        '--type', 'task',
        '--due', format
      ]);

      if (!result.success) {
        results.push({ format, success: false, error: result.error });
        continue;
      }

      const issueId = extractIssueId(result.raw, result.data);
      const showResult = bdExec(['show', issueId]);

      results.push({
        format,
        success: true,
        issueId,
        hasDueAt: showResult.data?.[0]?.due_at !== undefined
      });
    }

    const allSuccess = results.every(r => r.success && r.hasDueAt);
    return {
      pass: allSuccess,
      results,
      message: allSuccess ? undefined : 'Some datetime formats not accepted'
    };
  });
}

/**
 * Test suite for updating issues (daemon vs no-daemon)
 */
function testIssueUpdates() {
  section('Issue Update Tests (Daemon vs No-Daemon Comparison)');

  // Create a test issue first
  const createResult = bdExec([
    'create',
    '--title', `${TEST_PREFIX} Update Test`,
    '--type', 'task'
  ]);

  if (!createResult.success) {
    log('red', 'Failed to create test issue for updates');
    return;
  }

  const issueId = extractIssueId(createResult.raw, createResult.data);

  // Test each updateable field
  const fieldsToTest = [
    { flag: '--title', value: `${TEST_PREFIX} Updated Title`, jsonField: 'title' },
    { flag: '--description', value: 'Updated description', jsonField: 'description' },
    { flag: '--priority', value: '3', jsonField: 'priority', expectedValue: 3 },
    { flag: '--type', value: 'bug', jsonField: 'issue_type' },
    // Skip assignee - requires existing user due to FK constraint
    // { flag: '--assignee', value: 'UpdatedUser', jsonField: 'assignee' },
    { flag: '--estimate', value: '120', jsonField: 'estimated_minutes', expectedValue: 120 },
    { flag: '--due', value: '2026-01-20', jsonField: 'due_at' },
    { flag: '--defer', value: '2026-01-18', jsonField: 'defer_until' },
    { flag: '--external-ref', value: 'UPDATED-456', jsonField: 'external_ref' },
    { flag: '--acceptance', value: 'Updated acceptance', jsonField: 'acceptance_criteria' },
    { flag: '--design', value: 'Updated design', jsonField: 'design' },
    { flag: '--notes', value: 'Updated notes', jsonField: 'notes' },
    { flag: '--status', value: 'in_progress', jsonField: 'status' }
  ];

  for (const field of fieldsToTest) {
    const testName = `Update ${field.jsonField}`;

    // Test WITH daemon
    let valueWithDaemon;
    if (!noDaemonOnly) {
      const withDaemonResult = bdExec(['update', issueId, field.flag, field.value], { noDaemon: false });
      const afterDaemon = bdExec(['show', issueId]);
      valueWithDaemon = afterDaemon.data?.[0]?.[field.jsonField];
    }

    // Test WITHOUT daemon
    const withoutDaemonResult = bdExec(['update', issueId, field.flag, field.value], { noDaemon: true });
    const afterNoDaemon = bdExec(['show', issueId, '--no-daemon']);
    const valueWithoutDaemon = afterNoDaemon.data?.[0]?.[field.jsonField];

    // Compare results
    const expected = field.expectedValue !== undefined ? field.expectedValue : field.value;

    test(testName, () => {
      const daemonMatch = noDaemonOnly || valueWithDaemon === expected ||
                         (field.jsonField === 'due_at' && valueWithDaemon && valueWithDaemon.includes(field.value)) ||
                         (field.jsonField === 'defer_until' && valueWithDaemon && valueWithDaemon.includes(field.value));
      const noDaemonMatch = valueWithoutDaemon === expected ||
                           (field.jsonField === 'due_at' && valueWithoutDaemon && valueWithoutDaemon.includes(field.value)) ||
                           (field.jsonField === 'defer_until' && valueWithoutDaemon && valueWithoutDaemon.includes(field.value));

      if (daemonMatch && noDaemonMatch) {
        return { pass: true };
      }

      if (!noDaemonOnly && !daemonMatch && noDaemonMatch) {
        return compareValues(
          testName,
          field.jsonField,
          valueWithDaemon,
          valueWithoutDaemon,
          valueWithoutDaemon,
          expected
        );
      }

      if (daemonMatch && !noDaemonMatch) {
        return {
          pass: false,
          message: `No-daemon mode failed to update ${field.jsonField}`,
          valueWithDaemon,
          valueWithoutDaemon
        };
      }

      return {
        pass: false,
        message: `Both modes failed to update ${field.jsonField}`,
        valueWithDaemon,
        valueWithoutDaemon,
        expected
      };
    });
  }
}

/**
 * Test suite for datetime format handling
 */
function testDateTimeFormats() {
  section('DateTime Format Tests');

  const formats = [
    { input: '2026-01-15', description: 'Date only (YYYY-MM-DD)' },
    { input: '2026-01-15T10:30:00', description: 'DateTime without timezone' },
    { input: '2026-01-15T10:30:00.000Z', description: 'ISO 8601 with milliseconds and Z' },
    { input: '2026-01-15T10:30:00-08:00', description: 'ISO 8601 with timezone offset' },
    { input: '+1d', description: 'Relative: +1 day' },
    { input: '+6h', description: 'Relative: +6 hours' },
    { input: '+2w', description: 'Relative: +2 weeks' },
    { input: 'tomorrow', description: 'Natural language: tomorrow' },
    { input: 'next monday', description: 'Natural language: next monday' }
  ];

  for (const format of formats) {
    test(`DateTime format: ${format.description}`, () => {
      // Create with this format
      const createResult = bdExec([
        'create',
        '--title', `${TEST_PREFIX} DateTime ${format.input}`,
        '--type', 'task',
        '--due', format.input
      ]);

      if (!createResult.success) {
        return { pass: false, message: `Create failed: ${createResult.error}` };
      }

      const issueId = extractIssueId(createResult.raw, createResult.data);
      const showResult = bdExec(['show', issueId]);
      const hasDueAt = showResult.data?.[0]?.due_at !== undefined;

      // Try update with same format
      const updateResult = bdExec(['update', issueId, '--due', format.input], { noDaemon: true });
      const afterUpdate = bdExec(['show', issueId, '--no-daemon']);
      const stillHasDueAt = afterUpdate.data?.[0]?.due_at !== undefined;

      return {
        pass: hasDueAt && stillHasDueAt,
        message: !hasDueAt ? 'Create did not set due_at' : !stillHasDueAt ? 'Update cleared due_at' : undefined,
        createDueAt: showResult.data?.[0]?.due_at,
        updateDueAt: afterUpdate.data?.[0]?.due_at
      };
    });
  }
}

/**
 * Test dependencies and labels
 */
function testDependenciesAndLabels() {
  section('Dependencies and Labels Tests');

  // Create two issues for dependency testing
  const issue1 = bdExec(['create', '--title', `${TEST_PREFIX} Dep Parent`, '--type', 'task']);
  const issue2 = bdExec(['create', '--title', `${TEST_PREFIX} Dep Child`, '--type', 'task']);

  const id1 = extractIssueId(issue1.raw, issue1.data);
  const id2 = extractIssueId(issue2.raw, issue2.data);

  test('Add dependency', () => {
    const result = bdExec(['dep', 'add', id2, id1]); // id2 depends on id1
    if (!result.success) {
      return { pass: false, message: result.error };
    }

    const show = bdExec(['show', id2]);
    const deps = show.data?.[0]?.dependencies;

    return {
      pass: deps && deps.length > 0,
      message: !deps || deps.length === 0 ? 'Dependency not added' : undefined
    };
  });

  test('Add label', () => {
    const result = bdExec(['label', 'add', id1, 'test-label']);
    if (!result.success) {
      return { pass: false, message: result.error };
    }

    const show = bdExec(['show', id1]);
    const labels = show.data?.[0]?.labels;

    return {
      pass: labels && labels.includes('test-label'),
      message: !labels || !labels.includes('test-label') ? 'Label not added' : undefined
    };
  });
}

/**
 * Extract issue ID from bd command output
 */
function extractIssueId(output, data) {
  // If we have parsed JSON data, use that first
  if (data) {
    if (data.id) return data.id;
    if (Array.isArray(data) && data[0]?.id) return data[0].id;
  }
  
  // Fallback to regex for non-JSON output
  if (typeof output === 'string') {
    const match = output.match(/([a-z0-9-]+\.[a-z0-9-]+\-[a-z0-9]+)/i);
    return match ? match[1] : null;
  }
  
  return null;
}

/**
 * Generate markdown report
 */
function generateReport() {
  section('Generating Report');

  let report = `# BD CLI Test Report\n\n`;
  report += `**Generated:** ${new Date().toISOString()}\n\n`;
  report += `**BD Version:** \`${execSync('bd version', { encoding: 'utf8' }).trim()}\`\n\n`;
  report += `## Summary\n\n`;
  report += `- ✓ Passed: ${testResults.passed}\n`;
  report += `- ✗ Failed: ${testResults.failed}\n`;
  report += `- ⚠ Warnings: ${testResults.warnings}\n`;
  report += `- Total: ${testResults.tests.length}\n\n`;

  report += `## Issues Found\n\n`;

  const failures = testResults.tests.filter(t => !t.pass && !t.warning);
  const warnings = testResults.tests.filter(t => t.warning);

  if (failures.length === 0 && warnings.length === 0) {
    report += `No issues found! All tests passed. ✓\n\n`;
  } else {
    if (failures.length > 0) {
      report += `### Critical Failures\n\n`;
      failures.forEach(t => {
        report += `#### ${t.name}\n\n`;
        report += `- **Status:** ✗ Failed\n`;
        if (t.message) report += `- **Message:** ${t.message}\n`;
        if (t.error) report += `- **Error:** \`${t.error}\`\n`;
        if (t.expected !== undefined) report += `- **Expected:** \`${JSON.stringify(t.expected)}\`\n`;
        if (t.actual !== undefined) report += `- **Actual:** \`${JSON.stringify(t.actual)}\`\n`;
        report += `\n`;
      });
    }

    if (warnings.length > 0) {
      report += `### Warnings (Daemon vs No-Daemon Discrepancies)\n\n`;
      warnings.forEach(t => {
        report += `#### ${t.name}\n\n`;
        report += `- **Status:** ⚠ Warning\n`;
        report += `- **Issue:** Behavior differs between daemon and no-daemon modes\n`;
        if (t.message) report += `- **Message:** ${t.message}\n`;
        if (t.withDaemon !== undefined) report += `- **With Daemon:** \`${JSON.stringify(t.withDaemon)}\`\n`;
        if (t.withoutDaemon !== undefined) report += `- **Without Daemon:** \`${JSON.stringify(t.withoutDaemon)}\`\n`;
        report += `\n`;
      });
    }
  }

  report += `## Detailed Test Results\n\n`;
  testResults.tests.forEach((t, i) => {
    const icon = t.pass ? '✓' : t.warning ? '⚠' : '✗';
    report += `${i + 1}. ${icon} **${t.name}**\n`;
  });

  report += `\n## Recommendations\n\n`;
  if (warnings.length > 0) {
    report += `The following issues should be reported to the bd CLI maintainers:\n\n`;
    report += `1. **Daemon Mode Inconsistencies:** Several fields behave differently when using the daemon vs direct database access.\n`;
    report += `2. **Affected Fields:** ${warnings.map(w => w.name).join(', ')}\n`;
    report += `3. **Workaround:** Use \`--no-daemon\` flag for reliable updates.\n\n`;
  }

  fs.writeFileSync(REPORT_FILE, report);
  log('green', `Report written to: ${REPORT_FILE}`);

  return report;
}

/**
 * Cleanup test issues
 */
function cleanup() {
  section('Cleanup');

  log('blue', 'Closing test issues...');

  const listResult = bdExec(['list', '--all']);
  if (!listResult.success || !Array.isArray(listResult.data)) {
    log('yellow', 'Could not list issues for cleanup');
    return;
  }

  const testIssues = listResult.data.filter(issue =>
    issue.title && issue.title.includes(TEST_PREFIX)
  );

  log('blue', `Found ${testIssues.length} test issues to close`);

  testIssues.forEach(issue => {
    bdExec(['close', issue.id, '--reason', 'Test cleanup'], { expectJson: false });
  });

  log('green', 'Cleanup complete');
}

/**
 * Main test execution
 */
function main() {
  const args = process.argv.slice(2);
  noDaemonOnly = args.includes('--no-daemon-only');

  log('cyan', '\n╔════════════════════════════════════════════════════════════╗');
  log('cyan', '║          BD CLI Comprehensive Validation Tests              ║');
  log('cyan', '╚════════════════════════════════════════════════════════════╝\n');

  if (noDaemonOnly) {
    log('yellow', 'Running in no-daemon-only mode\n');
  }

  // Run test suites
  testIssueCreation();
  testIssueUpdates();
  testDateTimeFormats();
  testDependenciesAndLabels();

  // Generate report
  const report = generateReport();

  // Summary
  section('Summary');
  log('blue', `Total Tests: ${testResults.tests.length}`);
  log('green', `Passed: ${testResults.passed}`);
  log('red', `Failed: ${testResults.failed}`);
  log('yellow', `Warnings: ${testResults.warnings}`);

  console.log('\n');

  // Ask about cleanup
  console.log('Run cleanup to close test issues? (press Ctrl+C to skip)');
  setTimeout(() => {
    cleanup();

    if (testResults.failed > 0) {
      log('red', '\n✗ Tests failed. See report for details.');
      process.exit(1);
    } else if (testResults.warnings > 0) {
      log('yellow', '\n⚠ Tests passed with warnings. See report for details.');
      process.exit(0);
    } else {
      log('green', '\n✓ All tests passed!');
      process.exit(0);
    }
  }, 3000);
}

// Handle graceful exit
process.on('SIGINT', () => {
  log('yellow', '\n\nTest interrupted. Skipping cleanup.');
  process.exit(0);
});

main();

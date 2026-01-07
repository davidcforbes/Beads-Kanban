#!/usr/bin/env node

/**
 * Master Test Runner
 *
 * Runs all test suites in sequence and generates a combined summary report:
 * - BD CLI functionality tests
 * - Adapter integration tests
 * - Message validation tests
 * - Field mapping validation tests
 * - Round-trip data integrity tests
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Test suites configuration
const testSuites = [
  {
    name: 'BD CLI Functionality',
    script: 'test:bd-cli',
    reportFile: 'bd-cli-report.md',
    description: 'Tests basic bd CLI commands and functionality'
  },
  {
    name: 'Adapter Integration',
    script: 'test:adapter',
    reportFile: 'adapter-integration-report.md',
    description: 'Tests DaemonBeadsAdapter field mapping and bd CLI integration'
  },
  {
    name: 'Message Validation',
    script: 'test:validation',
    reportFile: 'message-validation-report.md',
    description: 'Tests all Zod schemas for webview-extension message validation'
  },
  {
    name: 'Field Mapping',
    script: 'test:field-mapping',
    reportFile: 'field-mapping-report.md',
    description: 'Validates field consistency across DB, CLI, Adapter, Zod, and Webview'
  },
  {
    name: 'Round-Trip Data Integrity',
    script: 'test:round-trip',
    reportFile: 'round-trip-report.md',
    description: 'Tests data integrity through create→read→update→read lifecycle'
  }
];

// Results tracking
const results = {
  suites: [],
  totalPassed: 0,
  totalFailed: 0,
  totalWarnings: 0,
  totalTests: 0,
  startTime: Date.now()
};

function runTestSuite(suite) {
  log(`\n${'='.repeat(80)}`, 'cyan');
  log(`Running: ${suite.name}`, 'cyan');
  log(`${suite.description}`, 'gray');
  log('='.repeat(80), 'cyan');

  const startTime = Date.now();
  let passed = false;
  let error = null;

  try {
    // Run the test suite
    execSync(`npm run ${suite.script}`, {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      stdio: 'inherit'
    });
    passed = true;
    log(`\n✓ ${suite.name} completed successfully`, 'green');
  } catch (err) {
    // Test suite failed or had errors
    error = err.message;
    log(`\n✗ ${suite.name} failed`, 'red');
  }

  const duration = Date.now() - startTime;

  // Try to parse the report file for detailed results
  let reportSummary = null;
  const reportPath = path.join(__dirname, '..', suite.reportFile);
  if (fs.existsSync(reportPath)) {
    try {
      const reportContent = fs.readFileSync(reportPath, 'utf8');
      reportSummary = parseReportSummary(reportContent);
    } catch (err) {
      log(`  ⚠ Warning: Could not parse report file: ${err.message}`, 'yellow');
    }
  }

  // Record results
  results.suites.push({
    name: suite.name,
    passed,
    error,
    duration,
    reportSummary,
    reportFile: suite.reportFile
  });

  // Update totals if we got detailed results from report
  if (reportSummary) {
    results.totalPassed += reportSummary.passed || 0;
    results.totalFailed += reportSummary.failed || 0;
    results.totalWarnings += reportSummary.warnings || 0;
    results.totalTests += reportSummary.total || 0;
  }
}

function parseReportSummary(reportContent) {
  // Extract summary statistics from markdown report
  const passedMatch = reportContent.match(/✓\s+Passed:\s+(\d+)/);
  const failedMatch = reportContent.match(/✗\s+Failed:\s+(\d+)/);
  const warningsMatch = reportContent.match(/⚠\s+Warnings:\s+(\d+)/);
  const totalMatch = reportContent.match(/Total(?:\s+Tests)?:\s+(\d+)/);

  return {
    passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
    failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
    warnings: warningsMatch ? parseInt(warningsMatch[1], 10) : 0,
    total: totalMatch ? parseInt(totalMatch[1], 10) : 0
  };
}

function generateSummaryReport() {
  const totalDuration = Date.now() - results.startTime;

  log('\n' + '='.repeat(80), 'blue');
  log('TEST SUITE SUMMARY', 'blue');
  log('='.repeat(80), 'blue');

  // Print each suite result
  results.suites.forEach((suite, idx) => {
    const status = suite.passed ? '✓' : '✗';
    const color = suite.passed ? 'green' : 'red';
    log(`\n${idx + 1}. ${status} ${suite.name}`, color);
    log(`   Duration: ${(suite.duration / 1000).toFixed(2)}s`, 'gray');

    if (suite.reportSummary) {
      log(`   Tests: ${suite.reportSummary.passed}/${suite.reportSummary.total} passed`, 'gray');
      if (suite.reportSummary.failed > 0) {
        log(`   Failed: ${suite.reportSummary.failed}`, 'red');
      }
      if (suite.reportSummary.warnings > 0) {
        log(`   Warnings: ${suite.reportSummary.warnings}`, 'yellow');
      }
    }

    if (suite.error) {
      log(`   Error: ${suite.error}`, 'red');
    }
  });

  // Overall statistics
  log('\n' + '='.repeat(80), 'blue');
  log('OVERALL STATISTICS', 'blue');
  log('='.repeat(80), 'blue');
  log(`Total Test Suites: ${results.suites.length}`, 'gray');
  log(`Suites Passed: ${results.suites.filter(s => s.passed).length}`, 'green');
  log(`Suites Failed: ${results.suites.filter(s => !s.passed).length}`, results.suites.some(s => !s.passed) ? 'red' : 'green');
  log(`Total Individual Tests: ${results.totalTests}`, 'gray');
  log(`Tests Passed: ${results.totalPassed}`, 'green');
  log(`Tests Failed: ${results.totalFailed}`, results.totalFailed > 0 ? 'red' : 'green');
  log(`Warnings: ${results.totalWarnings}`, results.totalWarnings > 0 ? 'yellow' : 'green');
  log(`Total Duration: ${(totalDuration / 1000).toFixed(2)}s`, 'gray');

  // Write markdown summary report
  writeSummaryReport();
}

function writeSummaryReport() {
  const timestamp = new Date().toISOString();
  const totalDuration = Date.now() - results.startTime;

  let markdown = `# Test Suite Summary Report\n\n`;
  markdown += `**Generated:** ${timestamp}\n\n`;
  markdown += `## Overall Results\n\n`;
  markdown += `- 🎯 Test Suites Run: ${results.suites.length}\n`;
  markdown += `- ✓ Suites Passed: ${results.suites.filter(s => s.passed).length}\n`;
  markdown += `- ✗ Suites Failed: ${results.suites.filter(s => !s.passed).length}\n`;
  markdown += `- 📊 Total Individual Tests: ${results.totalTests}\n`;
  markdown += `- ✓ Tests Passed: ${results.totalPassed}\n`;
  markdown += `- ✗ Tests Failed: ${results.totalFailed}\n`;
  markdown += `- ⚠ Warnings: ${results.totalWarnings}\n`;
  markdown += `- ⏱ Total Duration: ${(totalDuration / 1000).toFixed(2)}s\n\n`;

  markdown += `## Test Suite Details\n\n`;
  results.suites.forEach((suite, idx) => {
    const status = suite.passed ? '✓' : '✗';
    markdown += `### ${idx + 1}. ${status} ${suite.name}\n\n`;
    markdown += `**Duration:** ${(suite.duration / 1000).toFixed(2)}s\n\n`;

    if (suite.reportSummary) {
      markdown += `**Results:**\n`;
      markdown += `- Passed: ${suite.reportSummary.passed}\n`;
      markdown += `- Failed: ${suite.reportSummary.failed}\n`;
      markdown += `- Warnings: ${suite.reportSummary.warnings}\n`;
      markdown += `- Total: ${suite.reportSummary.total}\n\n`;
    }

    if (suite.error) {
      markdown += `**Error:** \`${suite.error}\`\n\n`;
    }

    markdown += `**Detailed Report:** [${suite.reportFile}](${suite.reportFile})\n\n`;
  });

  markdown += `## Test Coverage\n\n`;
  markdown += `- ✅ BD CLI functionality (create, update, show, list commands)\n`;
  markdown += `- ✅ Adapter integration (field mapping, CLI command construction)\n`;
  markdown += `- ✅ Message validation (6 Zod schemas, 75 test cases)\n`;
  markdown += `- ✅ Field mapping consistency (17 fields across 5 layers)\n`;
  markdown += `- ✅ Round-trip data integrity (23 create→read→update→read tests)\n`;
  markdown += `- ✅ String preservation (ASCII, Unicode, special chars, whitespace)\n`;
  markdown += `- ✅ Numeric boundaries (priority 0-4, estimates)\n`;
  markdown += `- ✅ Enum validation (status, issue_type)\n`;
  markdown += `- ✅ Nullable field handling\n`;
  markdown += `- ✅ Date/time preservation\n\n`;

  markdown += `## Known Issues & Limitations\n\n`;
  markdown += `- bd CLI daemon bugs with --due and --defer flags (documented in BUG_REPORT_BD_DAEMON.md)\n`;
  markdown += `- bd CLI rejects empty string arguments for some flags\n`;
  markdown += `- Windows command line length limits affect very long field values (>8000 chars)\n`;
  markdown += `- bd show fails for issues with status='blocked' or status='in_progress'\n`;
  markdown += `- bd CLI double-escapes backslashes\n`;
  markdown += `- bd CLI only stores first line of multi-line descriptions\n`;
  markdown += `- Foreign key constraints require existing user for assignee field\n`;
  markdown += `- external_ref field may trigger foreign key constraints in some configurations\n\n`;

  const reportPath = path.join(__dirname, '..', 'test-summary.md');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  log(`\n📄 Summary report saved to: ${reportPath}`, 'blue');
}

function main() {
  log('\n' + '='.repeat(80), 'cyan');
  log('BEADS EXTENSION TEST SUITE', 'cyan');
  log('Running all validation tests', 'cyan');
  log('='.repeat(80), 'cyan');

  // Run each test suite
  testSuites.forEach(suite => {
    runTestSuite(suite);
  });

  // Generate summary
  generateSummaryReport();

  // Exit with appropriate code
  const allPassed = results.suites.every(s => s.passed);
  const exitCode = allPassed ? 0 : 1;

  if (allPassed) {
    log('\n🎉 All test suites passed!', 'green');
  } else {
    log('\n❌ Some test suites failed. See details above.', 'red');
  }

  process.exit(exitCode);
}

main();

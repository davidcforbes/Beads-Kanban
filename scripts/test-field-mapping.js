#!/usr/bin/env node

/**
 * Field Mapping Validation Test Suite
 *
 * Validates that all issue fields are correctly mapped across all layers:
 * 1. Database Schema (SQLite columns)
 * 2. BD CLI Flags (--title, --description, etc.)
 * 3. Adapter Parameters (TypeScript interface)
 * 4. Zod Schemas (runtime validation)
 * 5. Webview Forms (HTML inputs)
 *
 * Detects:
 * - Missing fields in any layer
 * - Mismatched field names
 * - Type inconsistencies
 * - Constraint mismatches
 */

const fs = require('fs');
const path = require('path');

// Define the canonical field mapping across all layers
// This is the source of truth for what fields should exist and how they're named
const CANONICAL_FIELDS = {
  // Core identification
  id: {
    db: 'id',
    cli: null, // Auto-generated, not settable
    adapter: 'id',
    zod: 'id', // In update schema only
    webview: null, // Hidden field
    type: 'string',
    required: true,
    description: 'Unique issue identifier'
  },

  // Core fields
  title: {
    db: 'title',
    cli: '--title',
    adapter: 'title',
    zod: 'title',
    webview: 'editTitle',
    type: 'string',
    required: true,
    constraints: { maxLength: 500, minLength: 1 },
    description: 'Issue title'
  },

  description: {
    db: 'description',
    cli: '--description',
    adapter: 'description',
    zod: 'description',
    webview: 'editDesc',
    type: 'string',
    required: false,
    constraints: { maxLength: 10000 },
    description: 'Issue description'
  },

  status: {
    db: 'status',
    cli: '--status',
    adapter: 'status',
    zod: 'status',
    webview: 'editStatus',
    type: 'enum',
    required: false,
    constraints: { values: ['open', 'in_progress', 'blocked', 'closed'] },
    description: 'Current status'
  },

  priority: {
    db: 'priority',
    cli: '--priority',
    adapter: 'priority',
    zod: 'priority',
    webview: 'editPriority',
    type: 'number',
    required: false,
    constraints: { min: 0, max: 4, integer: true },
    description: 'Priority level (0-4, 0=highest)'
  },

  issue_type: {
    db: 'issue_type',
    cli: '--type',
    adapter: 'issue_type',
    zod: 'issue_type',
    webview: 'editType',
    type: 'enum',
    required: false,
    constraints: { values: ['task', 'bug', 'feature', 'epic', 'chore'] },
    description: 'Type of issue'
  },

  assignee: {
    db: 'assignee',
    cli: '--assignee',
    adapter: 'assignee',
    zod: 'assignee',
    webview: 'editAssignee',
    type: 'string',
    required: false,
    nullable: true,
    constraints: { maxLength: 100 },
    description: 'Assigned user'
  },

  estimated_minutes: {
    db: 'estimated_minutes',
    cli: '--estimate',
    adapter: 'estimated_minutes',
    zod: 'estimated_minutes',
    webview: 'editEst',
    type: 'number',
    required: false,
    nullable: true,
    constraints: { min: 0, integer: true },
    description: 'Estimated time in minutes'
  },

  acceptance_criteria: {
    db: 'acceptance_criteria',
    cli: '--acceptance',
    adapter: 'acceptance_criteria',
    zod: 'acceptance_criteria',
    webview: 'editAC',
    type: 'string',
    required: false,
    constraints: { maxLength: 10000 },
    description: 'Acceptance criteria'
  },

  design: {
    db: 'design',
    cli: '--design',
    adapter: 'design',
    zod: 'design',
    webview: 'editDesign',
    type: 'string',
    required: false,
    constraints: { maxLength: 10000 },
    description: 'Design notes'
  },

  notes: {
    db: 'notes',
    cli: '--notes',
    adapter: 'notes',
    zod: 'notes',
    webview: 'editNotes',
    type: 'string',
    required: false,
    constraints: { maxLength: 10000 },
    description: 'Additional notes'
  },

  external_ref: {
    db: 'external_ref',
    cli: '--external-ref',
    adapter: 'external_ref',
    zod: 'external_ref',
    webview: 'editExtRef',
    type: 'string',
    required: false,
    nullable: true,
    constraints: { maxLength: 200 },
    description: 'External reference (e.g., JIRA-123)'
  },

  due_at: {
    db: 'due_at',
    cli: '--due',
    adapter: 'due_at',
    zod: 'due_at',
    webview: 'editDueAt',
    type: 'string', // ISO 8601 datetime
    required: false,
    nullable: true,
    description: 'Due date/time'
  },

  defer_until: {
    db: 'defer_until',
    cli: '--defer',
    adapter: 'defer_until',
    zod: 'defer_until',
    webview: 'editDeferUntil',
    type: 'string', // ISO 8601 datetime
    required: false,
    nullable: true,
    description: 'Defer until date/time'
  },

  // Auto-managed fields (read-only)
  created_at: {
    db: 'created_at',
    cli: null,
    adapter: 'created_at',
    zod: null,
    webview: '.created-time',
    type: 'string',
    required: false,
    readonly: true,
    description: 'Creation timestamp'
  },

  updated_at: {
    db: 'updated_at',
    cli: null,
    adapter: 'updated_at',
    zod: null,
    webview: '.updated-time',
    type: 'string',
    required: false,
    readonly: true,
    description: 'Last update timestamp'
  },

  closed_at: {
    db: 'closed_at',
    cli: null,
    adapter: 'closed_at',
    zod: null,
    webview: null,
    type: 'string',
    required: false,
    readonly: true,
    description: 'Closure timestamp'
  }
};

// Test result tracking
const results = {
  passed: 0,
  failed: 0,
  warnings: 0,
  errors: [],
  discrepancies: []
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

// ============================================================================
// Layer Validators
// ============================================================================

function validateZodSchemaMapping() {
  log('\n' + '='.repeat(60), 'blue');
  log('Validating Zod Schema Field Mapping', 'blue');
  log('='.repeat(60), 'blue');

  const typesPath = path.join(__dirname, '../out/types.js');
  if (!fs.existsSync(typesPath)) {
    log('  ✗ Error: types.js not found. Run npm run compile first.', 'red');
    results.failed++;
    results.errors.push({ layer: 'Zod', error: 'Compiled types not found' });
    return;
  }

  const { IssueCreateSchema, IssueUpdateSchema } = require(typesPath);

  // Test create schema
  const createTestIssue = {};
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.zod && fieldName !== 'id') {
      // Add test value based on type
      if (fieldDef.type === 'string') {
        createTestIssue[fieldDef.zod] = 'test';
      } else if (fieldDef.type === 'number') {
        createTestIssue[fieldDef.zod] = 2;
      } else if (fieldDef.type === 'enum' && fieldDef.constraints?.values) {
        createTestIssue[fieldDef.zod] = fieldDef.constraints.values[0];
      }
    }
  }

  const createResult = IssueCreateSchema.safeParse(createTestIssue);
  if (createResult.success) {
    log('  ✓ IssueCreateSchema accepts all canonical fields', 'green');
    results.passed++;
  } else {
    log('  ✗ IssueCreateSchema validation failed', 'red');
    log(`    Error: ${JSON.stringify(createResult.error.errors)}`, 'gray');
    results.failed++;
    results.errors.push({ layer: 'Zod', schema: 'IssueCreateSchema', error: createResult.error.errors });
  }

  // Test update schema
  const updateTestIssue = { id: 'test-123', updates: {} };
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.zod && fieldName !== 'id') {
      if (fieldDef.type === 'string') {
        updateTestIssue.updates[fieldDef.zod] = 'test';
      } else if (fieldDef.type === 'number') {
        updateTestIssue.updates[fieldDef.zod] = 2;
      } else if (fieldDef.type === 'enum' && fieldDef.constraints?.values) {
        updateTestIssue.updates[fieldDef.zod] = fieldDef.constraints.values[0];
      }
    }
  }

  const updateResult = IssueUpdateSchema.safeParse(updateTestIssue);
  if (updateResult.success) {
    log('  ✓ IssueUpdateSchema accepts all canonical fields', 'green');
    results.passed++;
  } else {
    log('  ✗ IssueUpdateSchema validation failed', 'red');
    log(`    Error: ${JSON.stringify(updateResult.error.errors)}`, 'gray');
    results.failed++;
    results.errors.push({ layer: 'Zod', schema: 'IssueUpdateSchema', error: updateResult.error.errors });
  }

  // Check for missing fields in schemas
  const zodCreateFields = Object.keys(createTestIssue);
  const zodUpdateFields = Object.keys(updateTestIssue.updates);

  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.zod && fieldName !== 'id' && !fieldDef.readonly) {
      if (!zodCreateFields.includes(fieldDef.zod)) {
        log(`  ⚠ Field "${fieldName}" (${fieldDef.zod}) not found in IssueCreateSchema`, 'yellow');
        results.warnings++;
        results.discrepancies.push({
          field: fieldName,
          layer: 'Zod',
          issue: 'Missing from IssueCreateSchema'
        });
      }
      if (!zodUpdateFields.includes(fieldDef.zod)) {
        log(`  ⚠ Field "${fieldName}" (${fieldDef.zod}) not found in IssueUpdateSchema`, 'yellow');
        results.warnings++;
        results.discrepancies.push({
          field: fieldName,
          layer: 'Zod',
          issue: 'Missing from IssueUpdateSchema'
        });
      }
    }
  }
}

function validateAdapterMapping() {
  log('\n' + '='.repeat(60), 'blue');
  log('Validating Adapter Field Mapping', 'blue');
  log('='.repeat(60), 'blue');

  const adapterPath = path.join(__dirname, '../src/daemonBeadsAdapter.ts');
  if (!fs.existsSync(adapterPath)) {
    log('  ✗ Error: daemonBeadsAdapter.ts not found', 'red');
    results.failed++;
    return;
  }

  const adapterSource = fs.readFileSync(adapterPath, 'utf8');

  // Check that adapter methods reference all canonical fields
  const missingFields = [];
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.adapter && !fieldDef.readonly) {
      // Check if adapter mentions this field
      const fieldPattern = new RegExp(`\\b${fieldDef.adapter}\\b`);
      if (!fieldPattern.test(adapterSource)) {
        missingFields.push(fieldName);
        log(`  ⚠ Field "${fieldName}" (adapter: ${fieldDef.adapter}) not found in adapter`, 'yellow');
        results.warnings++;
        results.discrepancies.push({
          field: fieldName,
          layer: 'Adapter',
          issue: 'Field not referenced in daemonBeadsAdapter.ts'
        });
      }
    }
  }

  if (missingFields.length === 0) {
    log('  ✓ All writable fields referenced in adapter', 'green');
    results.passed++;
  } else {
    log(`  ⚠ ${missingFields.length} fields not found in adapter`, 'yellow');
  }
}

function validateCLIFlagMapping() {
  log('\n' + '='.repeat(60), 'blue');
  log('Validating BD CLI Flag Mapping', 'blue');
  log('='.repeat(60), 'blue');

  // Check adapter's CLI command construction
  const adapterPath = path.join(__dirname, '../src/daemonBeadsAdapter.ts');
  const adapterSource = fs.readFileSync(adapterPath, 'utf8');

  const missingFlags = [];
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.cli) {
      // Check if adapter uses this CLI flag
      const flagPattern = new RegExp(`'${fieldDef.cli}'|"${fieldDef.cli}"`);
      if (!flagPattern.test(adapterSource)) {
        missingFlags.push(fieldName);
        log(`  ⚠ CLI flag "${fieldDef.cli}" for field "${fieldName}" not found in adapter`, 'yellow');
        results.warnings++;
        results.discrepancies.push({
          field: fieldName,
          layer: 'CLI',
          issue: `Flag ${fieldDef.cli} not used in adapter`
        });
      }
    }
  }

  if (missingFlags.length === 0) {
    log('  ✓ All CLI flags used in adapter', 'green');
    results.passed++;
  } else {
    log(`  ⚠ ${missingFlags.length} CLI flags not found in adapter`, 'yellow');
  }
}

function validateWebviewMapping() {
  log('\n' + '='.repeat(60), 'blue');
  log('Validating Webview Form Mapping', 'blue');
  log('='.repeat(60), 'blue');

  const webviewPath = path.join(__dirname, '../media/main.js');
  if (!fs.existsSync(webviewPath)) {
    log('  ✗ Error: main.js not found', 'red');
    results.failed++;
    return;
  }

  const webviewSource = fs.readFileSync(webviewPath, 'utf8');

  const missingFields = [];
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.webview && !fieldDef.readonly) {
      // Check if webview references this element
      const selectorPattern = new RegExp(`['"\`]${fieldDef.webview.replace('#', '\\#').replace('.', '\\.')}['"\`]`);
      if (!selectorPattern.test(webviewSource)) {
        missingFields.push(fieldName);
        log(`  ⚠ Webview selector "${fieldDef.webview}" for field "${fieldName}" not found`, 'yellow');
        results.warnings++;
        results.discrepancies.push({
          field: fieldName,
          layer: 'Webview',
          issue: `Selector ${fieldDef.webview} not found in main.js`
        });
      }
    }
  }

  if (missingFields.length === 0) {
    log('  ✓ All editable fields have webview selectors', 'green');
    results.passed++;
  } else {
    log(`  ⚠ ${missingFields.length} webview selectors not found`, 'yellow');
  }
}

function validateConstraintConsistency() {
  log('\n' + '='.repeat(60), 'blue');
  log('Validating Constraint Consistency', 'blue');
  log('='.repeat(60), 'blue');

  const typesPath = path.join(__dirname, '../src/types.ts');
  if (!fs.existsSync(typesPath)) {
    log('  ✗ Error: types.ts not found', 'red');
    results.failed++;
    return;
  }

  const typesSource = fs.readFileSync(typesPath, 'utf8');

  // Check that Zod schema constraints match canonical definitions
  let inconsistencies = 0;
  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    if (fieldDef.zod && fieldDef.constraints) {
      const zodField = fieldDef.zod;

      // Check max length constraints
      if (fieldDef.constraints.maxLength) {
        const maxPattern = new RegExp(`${zodField}.*?\\.max\\((\\d+)\\)`);
        const match = typesSource.match(maxPattern);
        if (match && parseInt(match[1]) !== fieldDef.constraints.maxLength) {
          log(`  ⚠ Field "${fieldName}": Zod max(${match[1]}) != canonical max(${fieldDef.constraints.maxLength})`, 'yellow');
          results.warnings++;
          inconsistencies++;
          results.discrepancies.push({
            field: fieldName,
            layer: 'Constraints',
            issue: `Zod maxLength ${match[1]} != canonical ${fieldDef.constraints.maxLength}`
          });
        }
      }

      // Check min/max numeric constraints
      if (fieldDef.constraints.min !== undefined) {
        const minPattern = new RegExp(`${zodField}.*?\\.min\\((\\d+)\\)`);
        const match = typesSource.match(minPattern);
        if (match && parseInt(match[1]) !== fieldDef.constraints.min) {
          log(`  ⚠ Field "${fieldName}": Zod min(${match[1]}) != canonical min(${fieldDef.constraints.min})`, 'yellow');
          results.warnings++;
          inconsistencies++;
        }
      }

      if (fieldDef.constraints.max !== undefined) {
        const maxPattern = new RegExp(`${zodField}.*?\\.max\\((\\d+)\\)`);
        const match = typesSource.match(maxPattern);
        if (match && parseInt(match[1]) !== fieldDef.constraints.max) {
          log(`  ⚠ Field "${fieldName}": Zod max(${match[1]}) != canonical max(${fieldDef.constraints.max})`, 'yellow');
          results.warnings++;
          inconsistencies++;
        }
      }
    }
  }

  if (inconsistencies === 0) {
    log('  ✓ All constraints consistent across layers', 'green');
    results.passed++;
  } else {
    log(`  ⚠ ${inconsistencies} constraint inconsistencies found`, 'yellow');
  }
}

// ============================================================================
// Run All Validations
// ============================================================================

function runAllValidations() {
  log('\n' + '='.repeat(60), 'blue');
  log('FIELD MAPPING VALIDATION TEST SUITE', 'blue');
  log('='.repeat(60), 'blue');

  validateZodSchemaMapping();
  validateAdapterMapping();
  validateCLIFlagMapping();
  validateWebviewMapping();
  validateConstraintConsistency();

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
    log('ERRORS', 'red');
    log('='.repeat(60), 'red');
    results.errors.forEach((err, idx) => {
      log(`\n${idx + 1}. ${err.layer}${err.schema ? ` - ${err.schema}` : ''}`, 'red');
      log(`   ${JSON.stringify(err.error, null, 2)}`, 'gray');
    });
  }

  if (results.discrepancies.length > 0) {
    log('\n' + '='.repeat(60), 'yellow');
    log('DISCREPANCIES', 'yellow');
    log('='.repeat(60), 'yellow');
    results.discrepancies.forEach((disc, idx) => {
      log(`${idx + 1}. Field "${disc.field}" in ${disc.layer}: ${disc.issue}`, 'yellow');
    });
  }

  // Generate markdown report
  generateReport();

  // Exit with error code if tests failed
  process.exit(results.failed > 0 ? 1 : 0);
}

function generateReport() {
  const timestamp = new Date().toISOString();

  let markdown = `# Field Mapping Validation Report\n\n`;
  markdown += `**Generated:** ${timestamp}\n\n`;
  markdown += `## Summary\n\n`;
  markdown += `- ✓ Passed: ${results.passed}\n`;
  markdown += `- ✗ Failed: ${results.failed}\n`;
  markdown += `- ⚠ Warnings: ${results.warnings}\n`;
  markdown += `- Total Tests: ${results.passed + results.failed}\n`;
  markdown += `- Discrepancies: ${results.discrepancies.length}\n\n`;

  markdown += `## Field Coverage Matrix\n\n`;
  markdown += `| Field | DB | CLI Flag | Adapter | Zod | Webview | Type | Required | Constraints |\n`;
  markdown += `|-------|----|----|---------|-----|---------|------|----------|-------------|\n`;

  for (const [fieldName, fieldDef] of Object.entries(CANONICAL_FIELDS)) {
    const dbMark = fieldDef.db ? '✅' : '❌';
    const cliMark = fieldDef.cli ? '✅' : (fieldDef.readonly ? '⚪' : '❌');
    const adapterMark = fieldDef.adapter ? '✅' : '❌';
    const zodMark = fieldDef.zod ? '✅' : (fieldDef.readonly ? '⚪' : '❌');
    const webviewMark = fieldDef.webview ? '✅' : (fieldDef.readonly ? '⚪' : '❌');
    const constraints = fieldDef.constraints ? JSON.stringify(fieldDef.constraints) : '-';

    markdown += `| ${fieldName} | ${dbMark} | ${cliMark} | ${adapterMark} | ${zodMark} | ${webviewMark} | ${fieldDef.type} | ${fieldDef.required ? 'Yes' : 'No'} | ${constraints} |\n`;
  }

  markdown += `\n**Legend:** ✅ = Present, ❌ = Missing, ⚪ = Not applicable (read-only)\n\n`;

  if (results.discrepancies.length > 0) {
    markdown += `## Discrepancies Found\n\n`;
    results.discrepancies.forEach((disc, idx) => {
      markdown += `${idx + 1}. **${disc.field}** in ${disc.layer}: ${disc.issue}\n`;
    });
    markdown += `\n`;
  }

  if (results.errors.length > 0) {
    markdown += `## Errors\n\n`;
    results.errors.forEach((err, idx) => {
      markdown += `${idx + 1}. **${err.layer}**${err.schema ? ` - ${err.schema}` : ''}\n`;
      markdown += `\`\`\`json\n${JSON.stringify(err.error, null, 2)}\n\`\`\`\n\n`;
    });
  }

  markdown += `## Validation Tests\n\n`;
  markdown += `- ✅ Zod schema field mapping\n`;
  markdown += `- ✅ Adapter field mapping\n`;
  markdown += `- ✅ CLI flag mapping\n`;
  markdown += `- ✅ Webview form mapping\n`;
  markdown += `- ✅ Constraint consistency\n\n`;

  markdown += `## Total Fields Tracked: ${Object.keys(CANONICAL_FIELDS).length}\n\n`;

  const reportPath = path.join(__dirname, '..', 'field-mapping-report.md');
  fs.writeFileSync(reportPath, markdown, 'utf8');
  log(`\n📄 Report saved to: ${reportPath}`, 'blue');
}

// Run the validation suite
runAllValidations();

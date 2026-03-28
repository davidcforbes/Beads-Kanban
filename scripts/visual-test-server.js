#!/usr/bin/env node

/**
 * Standalone Visual Test Server for Beads Kanban
 *
 * Serves the Kanban board webview in a regular Chrome browser for visual testing
 * with Chrome DevTools MCP. Unlike the VS Code-based visual-test-harness.js,
 * this bypasses Electron entirely and runs in stock Chrome.
 *
 * Usage:
 *   node scripts/visual-test-server.js [--port=3333] [--debug-port=9222] [--no-chrome] [--theme=dark|light]
 *
 * Options:
 *   --port=NNNN        HTTP server port (default: 3333)
 *   --debug-port=NNNN  Chrome remote debugging port (default: 9222)
 *   --no-chrome         Don't auto-launch Chrome (just start the HTTP server)
 *   --theme=dark|light  VS Code color theme to simulate (default: dark)
 *   --rebuild           Force rebuild webview bundle before serving
 *
 * How it works:
 *   1. Optionally rebuilds the webview bundle (npm run build-webview)
 *   2. Generates standalone HTML that mirrors the VS Code webview
 *   3. Injects a mock acquireVsCodeApi() that responds with mock board data
 *   4. Serves on http://localhost:<port>
 *   5. Launches Chrome with --remote-debugging-port for CDP access
 *
 * Routes:
 *   /           -> Standalone HTML with mock VS Code API + board.js
 *   /media/*    -> Static files from media/ directory
 *   /out/*      -> Bundled files from out/ directory
 *
 * Prerequisites:
 *   npm run build-webview  (or use --rebuild flag)
 *
 * Note: This script uses child_process.spawn (not exec) to launch Chrome.
 * All arguments are passed as array elements, not interpolated into a shell
 * string, so there is no command-injection risk. The only use of execFileSync
 * is for the hardcoded "npm run build-webview" command.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);

function getArg(name, defaultVal) {
  const prefix = '--' + name + '=';
  const found = cliArgs.find(function(a) { return a.startsWith(prefix); });
  if (found) { return found.slice(prefix.length); }
  return defaultVal;
}
function hasFlag(name) { return cliArgs.includes('--' + name); }

const HTTP_PORT = parseInt(getArg('port', '3333'), 10);
const DEBUG_PORT = parseInt(getArg('debug-port', '9222'), 10);
const NO_CHROME = hasFlag('no-chrome');
const THEME = getArg('theme', 'dark');
const REBUILD = hasFlag('rebuild');

// ---------------------------------------------------------------------------
// Mock Board Data
// ---------------------------------------------------------------------------

/**
 * Generate realistic mock board data matching the EnrichedCard interface.
 * The board.js webview expects a board.minimal response with an array of
 * EnrichedCard objects that get distributed into columns by columnForCard().
 */
function generateMockBoardData() {
  const now = new Date().toISOString();
  const yesterday = new Date(Date.now() - 86400000).toISOString();
  const lastWeek = new Date(Date.now() - 7 * 86400000).toISOString();
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString();

  return [
    // --- Ready column (status=open, is_ready=true, blocked_by_count=0) ---
    {
      id: 'mock-000001',
      title: 'Implement user authentication flow',
      description: 'Add OAuth2 login with Google and GitHub providers',
      status: 'open',
      priority: 1,
      issue_type: 'feature',
      created_at: lastWeek,
      created_by: 'alice',
      updated_at: yesterday,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 2,
      assignee: 'alice',
      estimated_minutes: 480,
      labels: ['auth', 'backend', 'security'],
      external_ref: 'PROJ-101',
      pinned: true,
      blocked_by_count: 0,
      is_ready: true
    },
    {
      id: 'mock-000002',
      title: 'This is an extremely long title that tests how the card layout handles overflow when a user enters a very verbose and detailed issue title that goes well beyond what would normally fit in the card width',
      description: 'Testing long title rendering',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      created_at: twoWeeksAgo,
      created_by: 'bob',
      updated_at: lastWeek,
      closed_at: null,
      close_reason: null,
      dependency_count: 1,
      dependent_count: 0,
      assignee: 'bob',
      estimated_minutes: 120,
      labels: ['ui'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: true
    },
    {
      id: 'mock-000003',
      title: 'Fix <script>alert("XSS")</script> & "special" chars: \' < > & entities',
      description: 'Test card with special characters and potential XSS vectors in title',
      status: 'open',
      priority: 0,
      issue_type: 'bug',
      created_at: yesterday,
      created_by: 'charlie',
      updated_at: now,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 0,
      assignee: 'charlie',
      estimated_minutes: 30,
      labels: ['security', 'bug', 'P0'],
      external_ref: 'PROJ-999',
      pinned: false,
      blocked_by_count: 0,
      is_ready: true
    },
    {
      id: 'mock-000004',
      title: 'Add CSV export functionality',
      description: 'Export board data as CSV for reporting',
      status: 'open',
      priority: 3,
      issue_type: 'feature',
      created_at: twoWeeksAgo,
      created_by: 'diana',
      updated_at: twoWeeksAgo,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 0,
      assignee: null,
      estimated_minutes: null,
      labels: [],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: true
    },
    {
      id: 'mock-000005',
      title: 'Update API documentation',
      description: 'Refresh OpenAPI spec with new endpoints',
      status: 'open',
      priority: 2,
      issue_type: 'chore',
      created_at: lastWeek,
      created_by: 'eve',
      updated_at: yesterday,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 1,
      assignee: 'eve',
      estimated_minutes: 240,
      labels: ['docs', 'api'],
      external_ref: 'PROJ-205',
      pinned: false,
      blocked_by_count: 0,
      is_ready: true
    },

    // --- In Progress column (status=in_progress) ---
    {
      id: 'mock-000006',
      title: 'Refactor database connection pooling',
      description: 'Switch from single connection to connection pool for better concurrency',
      status: 'in_progress',
      priority: 1,
      issue_type: 'task',
      created_at: twoWeeksAgo,
      created_by: 'alice',
      updated_at: now,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 3,
      assignee: 'alice',
      estimated_minutes: 360,
      labels: ['backend', 'performance', 'database'],
      external_ref: 'PROJ-150',
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000007',
      title: 'Design new dashboard layout',
      description: 'Create mockups for the redesigned analytics dashboard',
      status: 'in_progress',
      priority: 2,
      issue_type: 'feature',
      created_at: lastWeek,
      created_by: 'diana',
      updated_at: yesterday,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 1,
      assignee: 'diana',
      estimated_minutes: 480,
      labels: ['frontend', 'design', 'ui'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000008',
      title: 'Write integration tests for payment module',
      description: 'Cover all payment flows including edge cases',
      status: 'in_progress',
      priority: 1,
      issue_type: 'task',
      created_at: lastWeek,
      created_by: 'bob',
      updated_at: now,
      closed_at: null,
      close_reason: null,
      dependency_count: 1,
      dependent_count: 0,
      assignee: 'bob',
      estimated_minutes: 600,
      labels: ['testing', 'payments'],
      external_ref: 'PROJ-175',
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000009',
      title: 'Migrate to Node 22',
      description: 'Update runtime and fix any compatibility issues',
      status: 'in_progress',
      priority: 3,
      issue_type: 'chore',
      created_at: twoWeeksAgo,
      created_by: 'eve',
      updated_at: lastWeek,
      closed_at: null,
      close_reason: null,
      dependency_count: 0,
      dependent_count: 0,
      assignee: 'eve',
      estimated_minutes: 120,
      labels: ['devops', 'infrastructure'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },

    // --- Blocked column (status=blocked or open with blocked_by_count > 0) ---
    {
      id: 'mock-000010',
      title: 'Deploy to production',
      description: 'Release v2.0 to production environment',
      status: 'blocked',
      priority: 0,
      issue_type: 'task',
      created_at: lastWeek,
      created_by: 'alice',
      updated_at: yesterday,
      closed_at: null,
      close_reason: null,
      dependency_count: 3,
      dependent_count: 0,
      assignee: 'alice',
      estimated_minutes: 60,
      labels: ['devops', 'release', 'P0'],
      external_ref: 'PROJ-200',
      pinned: true,
      blocked_by_count: 3,
      is_ready: false
    },
    {
      id: 'mock-000011',
      title: 'Update user permissions schema',
      description: 'Add new role-based access control fields to the database',
      status: 'open',
      priority: 2,
      issue_type: 'task',
      created_at: twoWeeksAgo,
      created_by: 'charlie',
      updated_at: lastWeek,
      closed_at: null,
      close_reason: null,
      dependency_count: 1,
      dependent_count: 2,
      assignee: 'charlie',
      estimated_minutes: 240,
      labels: ['backend', 'auth'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 1,
      is_ready: false
    },
    {
      id: 'mock-000012',
      title: 'Performance audit for mobile clients',
      description: 'Profile and optimize API response times for mobile app',
      status: 'blocked',
      priority: 1,
      issue_type: 'task',
      created_at: lastWeek,
      created_by: 'diana',
      updated_at: lastWeek,
      closed_at: null,
      close_reason: null,
      dependency_count: 2,
      dependent_count: 0,
      assignee: null,
      estimated_minutes: 480,
      labels: ['performance', 'mobile'],
      external_ref: 'PROJ-188',
      pinned: false,
      blocked_by_count: 2,
      is_ready: false
    },

    // --- Closed column (status=closed) ---
    {
      id: 'mock-000013',
      title: 'Set up CI/CD pipeline',
      description: 'Configure GitHub Actions for automated testing and deployment',
      status: 'closed',
      priority: 1,
      issue_type: 'task',
      created_at: twoWeeksAgo,
      created_by: 'bob',
      updated_at: lastWeek,
      closed_at: lastWeek,
      close_reason: 'completed',
      dependency_count: 0,
      dependent_count: 4,
      assignee: 'bob',
      estimated_minutes: 360,
      labels: ['devops', 'ci'],
      external_ref: 'PROJ-050',
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000014',
      title: 'Fix login redirect on Safari',
      description: 'Users on Safari were not redirected after OAuth login',
      status: 'closed',
      priority: 0,
      issue_type: 'bug',
      created_at: twoWeeksAgo,
      created_by: 'charlie',
      updated_at: lastWeek,
      closed_at: lastWeek,
      close_reason: 'completed',
      dependency_count: 0,
      dependent_count: 0,
      assignee: 'charlie',
      estimated_minutes: 60,
      labels: ['bug', 'auth', 'safari'],
      external_ref: 'PROJ-089',
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000015',
      title: 'Initial project scaffolding',
      description: 'Create repo, set up TypeScript, ESLint, testing framework',
      status: 'closed',
      priority: 1,
      issue_type: 'epic',
      created_at: twoWeeksAgo,
      created_by: 'alice',
      updated_at: twoWeeksAgo,
      closed_at: twoWeeksAgo,
      close_reason: 'completed',
      dependency_count: 0,
      dependent_count: 8,
      assignee: 'alice',
      estimated_minutes: 480,
      labels: ['infrastructure', 'setup'],
      external_ref: 'PROJ-001',
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000016',
      title: 'Fix typo in contribution guidelines',
      description: 'Corrected several misspellings in CONTRIBUTING.md',
      status: 'closed',
      priority: 4,
      issue_type: 'chore',
      created_at: lastWeek,
      created_by: 'eve',
      updated_at: lastWeek,
      closed_at: lastWeek,
      close_reason: 'completed',
      dependency_count: 0,
      dependent_count: 0,
      assignee: null,
      estimated_minutes: 10,
      labels: ['docs'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    },
    {
      id: 'mock-000017',
      title: 'Evaluate database migration tools',
      description: 'Compare Flyway, Liquibase, and custom migration approaches',
      status: 'closed',
      priority: 2,
      issue_type: 'task',
      created_at: twoWeeksAgo,
      created_by: 'diana',
      updated_at: lastWeek,
      closed_at: lastWeek,
      close_reason: 'wontfix',
      dependency_count: 0,
      dependent_count: 0,
      assignee: 'diana',
      estimated_minutes: 240,
      labels: ['backend', 'database', 'evaluation'],
      external_ref: null,
      pinned: false,
      blocked_by_count: 0,
      is_ready: false
    }
  ];
}

// ---------------------------------------------------------------------------
// VS Code Theme CSS Variables
// ---------------------------------------------------------------------------

/**
 * Generate CSS custom properties that mimic the VS Code theme.
 * The webview's styles.css uses these variables for theming.
 */
function getThemeCss(theme) {
  if (theme === 'light') {
    return [
      ':root {',
      '  --vscode-editor-background: #ffffff;',
      '  --vscode-editor-foreground: #1e1e1e;',
      '  --vscode-sideBar-background: #f3f3f3;',
      '  --vscode-sideBarSectionHeader-background: #e8e8e8;',
      '  --vscode-input-background: #ffffff;',
      '  --vscode-input-foreground: #1e1e1e;',
      '  --vscode-input-border: #cecece;',
      '  --vscode-input-placeholderForeground: #767676;',
      '  --vscode-focusBorder: #0078d4;',
      '  --vscode-button-background: #0078d4;',
      '  --vscode-button-foreground: #ffffff;',
      '  --vscode-button-hoverBackground: #0066b8;',
      '  --vscode-button-secondaryBackground: #e5e5e5;',
      '  --vscode-button-secondaryForeground: #1e1e1e;',
      '  --vscode-button-secondaryHoverBackground: #cccccc;',
      '  --vscode-badge-background: #0078d4;',
      '  --vscode-badge-foreground: #ffffff;',
      '  --vscode-list-hoverBackground: #e8e8e8;',
      '  --vscode-list-activeSelectionBackground: #0078d4;',
      '  --vscode-list-activeSelectionForeground: #ffffff;',
      '  --vscode-textLink-foreground: #006ab1;',
      '  --vscode-foreground: #1e1e1e;',
      '  --vscode-descriptionForeground: #717171;',
      '  --vscode-errorForeground: #f85149;',
      '  --vscode-widget-border: #d4d4d4;',
      '  --vscode-widget-shadow: rgba(0, 0, 0, 0.16);',
      '  --vscode-scrollbar-shadow: rgba(0, 0, 0, 0.1);',
      '  --vscode-dropdown-background: #ffffff;',
      '  --vscode-dropdown-foreground: #1e1e1e;',
      '  --vscode-dropdown-border: #cecece;',
      '  --vscode-checkbox-background: #ffffff;',
      '  --vscode-checkbox-border: #cecece;',
      '  --vscode-checkbox-foreground: #1e1e1e;',
      '  --vscode-textBlockQuote-background: #f2f2f2;',
      '  --vscode-textBlockQuote-border: #0078d4;',
      '  --vscode-panel-border: #e5e5e5;',
      '}',
      'body { color-scheme: light; }'
    ].join('\n');
  }

  // Default: Dark theme (VS Code Dark+)
  return [
    ':root {',
    '  --vscode-editor-background: #1e1e1e;',
    '  --vscode-editor-foreground: #d4d4d4;',
    '  --vscode-sideBar-background: #252526;',
    '  --vscode-sideBarSectionHeader-background: #333333;',
    '  --vscode-input-background: #3c3c3c;',
    '  --vscode-input-foreground: #cccccc;',
    '  --vscode-input-border: #3c3c3c;',
    '  --vscode-input-placeholderForeground: #a0a0a0;',
    '  --vscode-focusBorder: #007acc;',
    '  --vscode-button-background: #0e639c;',
    '  --vscode-button-foreground: #ffffff;',
    '  --vscode-button-hoverBackground: #1177bb;',
    '  --vscode-button-secondaryBackground: #3a3d41;',
    '  --vscode-button-secondaryForeground: #cccccc;',
    '  --vscode-button-secondaryHoverBackground: #4a4d51;',
    '  --vscode-badge-background: #4d4d4d;',
    '  --vscode-badge-foreground: #d4d4d4;',
    '  --vscode-list-hoverBackground: #2a2d2e;',
    '  --vscode-list-activeSelectionBackground: #094771;',
    '  --vscode-list-activeSelectionForeground: #ffffff;',
    '  --vscode-textLink-foreground: #3794ff;',
    '  --vscode-foreground: #cccccc;',
    '  --vscode-descriptionForeground: #9d9d9d;',
    '  --vscode-errorForeground: #f85149;',
    '  --vscode-widget-border: #303031;',
    '  --vscode-widget-shadow: rgba(0, 0, 0, 0.36);',
    '  --vscode-scrollbar-shadow: rgba(0, 0, 0, 0.25);',
    '  --vscode-dropdown-background: #3c3c3c;',
    '  --vscode-dropdown-foreground: #cccccc;',
    '  --vscode-dropdown-border: #3c3c3c;',
    '  --vscode-checkbox-background: #3c3c3c;',
    '  --vscode-checkbox-border: #3c3c3c;',
    '  --vscode-checkbox-foreground: #cccccc;',
    '  --vscode-textBlockQuote-background: #2b2b2b;',
    '  --vscode-textBlockQuote-border: #007acc;',
    '  --vscode-panel-border: #2b2b2b;',
    '}',
    'body { color-scheme: dark; }'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// HTML Generation
// ---------------------------------------------------------------------------

/**
 * Generate the standalone HTML page.
 * This mirrors the structure from src/webview.ts but adapted for standalone use:
 * - No CSP nonce (not in VS Code sandbox)
 * - Mock acquireVsCodeApi injected before board.js
 * - VS Code theme CSS variables injected
 * - Scripts loaded from HTTP server paths
 */
function generateHtml() {
  // Escape </ sequences in JSON to prevent premature script tag closure (XSS test card has <script> in title)
  var mockCards = JSON.stringify(generateMockBoardData()).replace(/<\//g, '<\\/');
  var themeCss = getThemeCss(THEME);
  var modKey = 'Ctrl';

  return '<!DOCTYPE html>\n' +
'<!-- Beads Kanban - Standalone Visual Test Server -->\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>Beads Kanban - Visual Test</title>\n' +
'  <style>\n' +
'    ' + themeCss + '\n' +
'  </style>\n' +
'  <link href="/media/styles.css" rel="stylesheet" />\n' +
'  <link href="/media/graph-styles.css" rel="stylesheet" />\n' +
'  <style>\n' +
'    /* Visual test server indicator */\n' +
'    .vts-banner {\n' +
'      position: fixed;\n' +
'      bottom: 8px;\n' +
'      right: 8px;\n' +
'      background: rgba(14, 99, 156, 0.85);\n' +
'      color: #fff;\n' +
'      font-size: 11px;\n' +
'      padding: 3px 8px;\n' +
'      border-radius: 4px;\n' +
'      z-index: 99999;\n' +
'      pointer-events: none;\n' +
'      font-family: -apple-system, BlinkMacSystemFont, sans-serif;\n' +
'    }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <header class="topbar">\n' +
'    <div class="title">\n' +
'      <span class="title-text">Agent Native Abstraction Layer for Beads</span>\n' +
'      <button id="repoMenuBtn" class="repo-menu-btn" title="Select Repository">&#x22EF;</button>\n' +
'    </div>\n' +
'    <div class="actions">\n' +
'      <div class="view-toggle">\n' +
'        <button id="viewKanbanBtn" class="view-toggle-btn active">Kanban</button>\n' +
'        <button id="viewTableBtn" class="view-toggle-btn">Table</button>\n' +
'        <button id="viewGraphBtn" class="view-toggle-btn">Graph</button>\n' +
'      </div>\n' +
'      <div class="filters">\n' +
'        <input id="filterSearch" type="text" placeholder="Search... (' + modKey + '+F)" title="Focus search (' + modKey + '+F)" class="search-input" />\n' +
'        <div class="status-filter-wrapper">\n' +
'          <button id="filterPriorityBtn" class="select status-filter-btn" type="button" title="Filter by priority">\n' +
'            <span id="filterPriorityLabel">Priority: All</span>\n' +
'            <span class="dropdown-arrow">&#x25BC;</span>\n' +
'          </button>\n' +
'          <div id="filterPriorityDropdown" class="status-dropdown hidden">\n' +
'            <label class="status-option"><input type="checkbox" value="" checked /> All</label>\n' +
'            <label class="status-option"><input type="checkbox" value="0" /> P0</label>\n' +
'            <label class="status-option"><input type="checkbox" value="1" /> P1</label>\n' +
'            <label class="status-option"><input type="checkbox" value="2" /> P2</label>\n' +
'            <label class="status-option"><input type="checkbox" value="3" /> P3</label>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="status-filter-wrapper">\n' +
'          <button id="filterTypeBtn" class="select status-filter-btn" type="button" title="Filter by type">\n' +
'            <span id="filterTypeLabel">Type: All</span>\n' +
'            <span class="dropdown-arrow">&#x25BC;</span>\n' +
'          </button>\n' +
'          <div id="filterTypeDropdown" class="status-dropdown hidden">\n' +
'            <label class="status-option"><input type="checkbox" value="" checked /> All</label>\n' +
'            <label class="status-option"><input type="checkbox" value="task" /> Task</label>\n' +
'            <label class="status-option"><input type="checkbox" value="bug" /> Bug</label>\n' +
'            <label class="status-option"><input type="checkbox" value="feature" /> Feature</label>\n' +
'            <label class="status-option"><input type="checkbox" value="epic" /> Epic</label>\n' +
'            <label class="status-option"><input type="checkbox" value="chore" /> Chore</label>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="status-filter-wrapper">\n' +
'          <button id="filterStatusBtn" class="select status-filter-btn" type="button" title="Filter by status">\n' +
'            <span id="filterStatusLabel">Status: All</span>\n' +
'            <span class="dropdown-arrow">&#x25BC;</span>\n' +
'          </button>\n' +
'          <div id="filterStatusDropdown" class="status-dropdown hidden">\n' +
'            <label class="status-option"><input type="checkbox" value="" checked /> All</label>\n' +
'            <label class="status-option"><input type="checkbox" value="open" /> Open</label>\n' +
'            <label class="status-option"><input type="checkbox" value="in_progress" /> In Progress</label>\n' +
'            <label class="status-option"><input type="checkbox" value="blocked" /> Blocked</label>\n' +
'            <label class="status-option"><input type="checkbox" value="deferred" /> Deferred</label>\n' +
'            <label class="status-option"><input type="checkbox" value="closed" /> Closed</label>\n' +
'            <label class="status-option"><input type="checkbox" value="tombstone" /> Tombstone</label>\n' +
'            <label class="status-option"><input type="checkbox" value="pinned" /> Pinned</label>\n' +
'          </div>\n' +
'        </div>\n' +
'        <button id="clearFiltersBtn" class="btn" title="Clear all filters">Clear Filters</button>\n' +
'      </div>\n' +
'      <button id="refreshBtn" class="btn" title="Refresh board (' + modKey + '+R)">Refresh</button>\n' +
'      <button id="newBtn" class="btn primary" title="Create new issue (' + modKey + '+N)">New</button>\n' +
'    </div>\n' +
'  </header>\n' +
'\n' +
'  <main>\n' +
'    <div id="board" class="board"></div>\n' +
'    <div id="dependencyDiagram" class="dependency-diagram hidden">\n' +
'      <div class="graph-sidebar">\n' +
'        <div class="graph-sidebar-header"><h3>ISSUES</h3></div>\n' +
'        <div id="graphIssueList" class="graph-issue-list"></div>\n' +
'      </div>\n' +
'      <div class="graph-main">\n' +
'        <div class="graph-controls">\n' +
'          <div class="graph-controls-group">\n' +
'            <label><input type="checkbox" id="focusModeToggle" /> Focus Mode</label>\n' +
'            <label for="focusDepth">Depth:</label>\n' +
'            <input type="number" id="focusDepth" min="1" max="5" value="2" style="width: 50px;" />\n' +
'          </div>\n' +
'          <div class="graph-controls-group">\n' +
'            <label for="graphDirection">Direction:</label>\n' +
'            <select id="graphDirection">\n' +
'              <option value="TB">Top to Bottom</option>\n' +
'              <option value="LR">Left to Right</option>\n' +
'            </select>\n' +
'          </div>\n' +
'          <div class="graph-controls-group">\n' +
'            <button id="autoLayoutBtn" class="secondary">Auto Layout</button>\n' +
'            <button id="resetLayoutBtn" class="secondary">Reset View</button>\n' +
'            <button id="centerViewBtn" class="secondary">Center View</button>\n' +
'          </div>\n' +
'          <div class="graph-stats">\n' +
'            <div class="graph-stat"><span class="graph-stat-label">Nodes:</span><span id="nodeCount" class="graph-stat-value">0</span></div>\n' +
'            <div class="graph-stat"><span class="graph-stat-label">Edges:</span><span id="edgeCount" class="graph-stat-value">0</span></div>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="graph-canvas-container">\n' +
'          <svg id="graphSvg" class="graph-svg"></svg>\n' +
'          <div class="graph-legend">\n' +
'            <h4>Legend</h4>\n' +
'            <div class="graph-legend-section">\n' +
'              <h5>Node Status</h5>\n' +
'              <div class="graph-legend-item"><div class="legend-color-box status-ready"></div><span class="legend-text">Ready</span></div>\n' +
'              <div class="graph-legend-item"><div class="legend-color-box status-in_progress"></div><span class="legend-text">In Progress</span></div>\n' +
'              <div class="graph-legend-item"><div class="legend-color-box status-blocked"></div><span class="legend-text">Blocked</span></div>\n' +
'              <div class="graph-legend-item"><div class="legend-color-box status-closed"></div><span class="legend-text">Closed</span></div>\n' +
'            </div>\n' +
'            <div class="graph-legend-section">\n' +
'              <h5>Dependencies</h5>\n' +
'              <div class="graph-legend-item"><div class="legend-line parent-child"></div><span class="legend-text">Parent-Child</span></div>\n' +
'              <div class="graph-legend-item"><div class="legend-line blocks"></div><span class="legend-text">Blocks</span></div>\n' +
'              <div class="graph-legend-item"><div class="legend-line blocked-by"></div><span class="legend-text">Blocked By</span></div>\n' +
'            </div>\n' +
'          </div>\n' +
'          <div class="zoom-controls">\n' +
'            <button id="zoomInBtn" title="Zoom In">+</button>\n' +
'            <button id="zoomOutBtn" title="Zoom Out">&#x2212;</button>\n' +
'            <button id="zoomResetBtn" title="Reset Zoom">&#x2299;</button>\n' +
'          </div>\n' +
'        </div>\n' +
'      </div>\n' +
'      <div id="graphContextMenu" class="graph-context-menu hidden">\n' +
'        <div class="context-menu-item" data-action="link">Link Selected Issues</div>\n' +
'        <div class="context-menu-item" data-action="unlink">Remove Dependency</div>\n' +
'        <div class="context-menu-separator"></div>\n' +
'        <div class="context-menu-item" data-action="focus">Focus on Node</div>\n' +
'      </div>\n' +
'    </div>\n' +
'  </main>\n' +
'\n' +
'  <!-- Static Edit Issue Dialog -->\n' +
'  <dialog id="detailDialog" class="dialog">\n' +
'    <form method="dialog" class="dialogForm">\n' +
'      <div class="edit-form-container">\n' +
'        <h3 id="editFormHeader" class="form-section-header">Edit Issue</h3>\n' +
'        <div class="form-row">\n' +
'          <label class="form-label" for="editTitle">Title:</label>\n' +
'          <input id="editTitle" type="text" class="form-input-title" placeholder="Issue title" />\n' +
'        </div>\n' +
'        <div class="form-row-multi">\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editStatus">Status:</label>\n' +
'            <select id="editStatus" class="form-input-inline">\n' +
'              <option value="open">Open</option>\n' +
'              <option value="in_progress">In Progress</option>\n' +
'              <option value="blocked">Blocked</option>\n' +
'              <option value="deferred">Deferred</option>\n' +
'              <option value="closed">Closed</option>\n' +
'            </select>\n' +
'          </div>\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editType">Type:</label>\n' +
'            <select id="editType" class="form-input-inline">\n' +
'              <option value="task">task</option>\n' +
'              <option value="bug">bug</option>\n' +
'              <option value="feature">feature</option>\n' +
'              <option value="epic">epic</option>\n' +
'              <option value="chore">chore</option>\n' +
'            </select>\n' +
'          </div>\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editPriority">Priority:</label>\n' +
'            <select id="editPriority" class="form-input-inline">\n' +
'              <option value="0">P0</option>\n' +
'              <option value="1">P1</option>\n' +
'              <option value="2">P2</option>\n' +
'              <option value="3">P3</option>\n' +
'              <option value="4">P4</option>\n' +
'            </select>\n' +
'          </div>\n' +
'          <div class="form-group-large">\n' +
'            <label class="form-label" for="editAssignee">Assignee:</label>\n' +
'            <input id="editAssignee" type="text" placeholder="Unassigned" class="form-input-inline" />\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="form-row-multi">\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editEst">Est. Minutes:</label>\n' +
'            <input id="editEst" type="number" placeholder="Min" class="form-input-inline" />\n' +
'          </div>\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editDueAt">Due At:</label>\n' +
'            <input id="editDueAt" type="datetime-local" class="form-input-inline" />\n' +
'          </div>\n' +
'          <div class="form-group">\n' +
'            <label class="form-label" for="editDeferUntil">Defer Until:</label>\n' +
'            <input id="editDeferUntil" type="datetime-local" class="form-input-inline" />\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="form-section">\n' +
'          <label class="form-label-small">Tags</label>\n' +
'          <div id="labelsContainer" class="labels-container"></div>\n' +
'          <div class="inline-add-row">\n' +
'            <input id="newLabel" type="text" placeholder="Add tag..." class="inline-input" />\n' +
'            <button type="button" id="btnAddLabel" class="btn btn-small">+</button>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="form-section">\n' +
'          <label class="form-label-small">Flags</label>\n' +
'          <div class="flags-row">\n' +
'            <label class="flag-label"><input type="checkbox" id="editPinned" /> &#x1F4CC; Pinned</label>\n' +
'            <label class="flag-label"><input type="checkbox" id="editTemplate" /> &#x1F4C4; Template</label>\n' +
'            <label class="flag-label"><input type="checkbox" id="editEphemeral" /> &#x23F1; Ephemeral</label>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="form-row-wide-label">\n' +
'          <label class="form-label" for="editExtRef">Ext Ref:</label>\n' +
'          <input id="editExtRef" type="text" placeholder="JIRA-123" class="form-input-full" />\n' +
'        </div>\n' +
'        <hr class="form-hr">\n' +
'        <div class="markdown-fields-container">\n' +
'          <div class="markdown-field-wrapper">\n' +
'            <div class="markdown-field-header">\n' +
'              <label class="form-label-small" for="editDesc">Description</label>\n' +
'              <button type="button" class="btn btn-small toggle-preview" data-target="editDesc">Preview</button>\n' +
'            </div>\n' +
'            <textarea id="editDesc" class="markdown-field-editor" rows="4"></textarea>\n' +
'            <div id="editDesc-preview" class="markdown-body markdown-field-preview hidden"></div>\n' +
'          </div>\n' +
'          <div class="markdown-field-wrapper">\n' +
'            <div class="markdown-field-header">\n' +
'              <label class="form-label-small" for="editAC">Acceptance Criteria</label>\n' +
'              <button type="button" class="btn btn-small toggle-preview" data-target="editAC">Preview</button>\n' +
'            </div>\n' +
'            <textarea id="editAC" class="markdown-field-editor" rows="3"></textarea>\n' +
'            <div id="editAC-preview" class="markdown-body markdown-field-preview hidden"></div>\n' +
'          </div>\n' +
'          <div class="markdown-field-wrapper">\n' +
'            <div class="markdown-field-header">\n' +
'              <label class="form-label-small" for="editDesign">Design Notes</label>\n' +
'              <button type="button" class="btn btn-small toggle-preview" data-target="editDesign">Preview</button>\n' +
'            </div>\n' +
'            <textarea id="editDesign" class="markdown-field-editor" rows="3"></textarea>\n' +
'            <div id="editDesign-preview" class="markdown-body markdown-field-preview hidden"></div>\n' +
'          </div>\n' +
'          <div class="markdown-field-wrapper">\n' +
'            <div class="markdown-field-header">\n' +
'              <label class="form-label-small" for="editNotes">Notes</label>\n' +
'              <button type="button" class="btn btn-small toggle-preview" data-target="editNotes">Preview</button>\n' +
'            </div>\n' +
'            <textarea id="editNotes" class="markdown-field-editor" rows="3"></textarea>\n' +
'            <div id="editNotes-preview" class="markdown-body markdown-field-preview hidden"></div>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div class="form-section-bordered">\n' +
'          <label class="form-label-small section-label">Structure</label>\n' +
'          <div class="relationship-group">\n' +
'            <span class="relationship-label">Parent:</span>\n' +
'            <span id="parentDisplay" class="relationship-value">None</span>\n' +
'            <span id="removeParent" class="remove-link hidden">(Unlink)</span>\n' +
'          </div>\n' +
'          <div id="parentAddRow" class="inline-add-row">\n' +
'            <input id="newParentId" type="text" placeholder="Parent Issue ID" list="issueIdOptions" class="inline-input" />\n' +
'            <button type="button" id="btnSetParent" class="btn btn-small">Set</button>\n' +
'          </div>\n' +
'          <div class="relationship-group"><span class="relationship-label">Blocked By:</span></div>\n' +
'          <ul id="blockedByList" class="relationship-list"></ul>\n' +
'          <div class="inline-add-row">\n' +
'            <input id="newBlockerId" type="text" placeholder="Blocker Issue ID" list="issueIdOptions" class="inline-input" />\n' +
'            <button type="button" id="btnAddBlocker" class="btn btn-small">Add</button>\n' +
'          </div>\n' +
'          <div class="relationship-group"><span class="relationship-label">Blocks:</span></div>\n' +
'          <ul id="blocksList" class="relationship-list"></ul>\n' +
'          <div class="relationship-group"><span class="relationship-label">Children:</span></div>\n' +
'          <ul id="childrenList" class="relationship-list"></ul>\n' +
'          <div class="inline-add-row">\n' +
'            <input id="newChildId" type="text" placeholder="Child Issue ID" list="issueIdOptions" class="inline-input" />\n' +
'            <button type="button" id="btnAddChild" class="btn btn-small">Add</button>\n' +
'          </div>\n' +
'        </div>\n' +
'        <datalist id="issueIdOptions"></datalist>\n' +
'        <details id="advancedMetadata" class="form-section-bordered hidden">\n' +
'          <summary class="form-label-small section-label clickable">Advanced Metadata (Event/Agent)</summary>\n' +
'          <div id="advancedMetadataContent" class="metadata-grid"></div>\n' +
'        </details>\n' +
'        <div class="form-section-bordered">\n' +
'          <label class="form-label-small section-label">Comments</label>\n' +
'          <div id="commentsList" class="comments-list"></div>\n' +
'          <div class="comment-add-row">\n' +
'            <textarea id="newCommentText" rows="2" placeholder="Write a comment..." class="comment-input"></textarea>\n' +
'            <button type="button" id="btnPostComment" class="btn">Post</button>\n' +
'          </div>\n' +
'          <div id="createModeCommentNote" class="muted-note hidden">Comments will be added after issue creation.</div>\n' +
'        </div>\n' +
'        <div class="dialogActions form-actions">\n' +
'          <div class="actions-left">\n' +
'            <button type="button" id="btnSave" class="btn primary">Save Changes</button>\n' +
'            <button type="button" id="btnClose" class="btn">Close</button>\n' +
'          </div>\n' +
'          <div class="actions-right">\n' +
'            <button type="button" id="btnChat" class="btn icon-btn" title="Add to Chat">&#x1F4AC; Chat</button>\n' +
'            <button type="button" id="btnCopy" class="btn icon-btn" title="Copy Context">&#x1F4CB; Copy</button>\n' +
'          </div>\n' +
'        </div>\n' +
'        <div id="editFormFooter" class="form-footer"></div>\n' +
'      </div>\n' +
'    </form>\n' +
'  </dialog>\n' +
'\n' +
'  <div id="toast" class="toast hidden"></div>\n' +
'\n' +
'  <div id="loadingOverlay" class="loading-overlay hidden">\n' +
'    <div class="loading-spinner"></div>\n' +
'    <div id="loadingText" class="loading-text">Loading...</div>\n' +
'  </div>\n' +
'\n' +
'  <div class="vts-banner">Visual Test Server (mock data)</div>\n' +
'\n' +
'  <!-- DOMPurify and marked for markdown rendering -->\n' +
'  <script src="/media/purify.min.js"></script>\n' +
'  <script src="/media/marked.min.js"></script>\n' +
'\n' +
'  <!-- Mock VS Code API - must be loaded BEFORE board.js -->\n' +
'  <script>\n' +
'    // Mock VS Code API for standalone testing\n' +
'    var _mockBoardCards = ' + mockCards + ';\n' +
'    var _mockMessageLog = [];\n' +
'    var _mockState = {};\n' +
'\n' +
'    window.acquireVsCodeApi = function() {\n' +
'      return {\n' +
'        postMessage: function(msg) {\n' +
'          console.log("[mock-vscode] postMessage:", msg.type, msg);\n' +
'          _mockMessageLog.push({ direction: "out", msg: msg, timestamp: Date.now() });\n' +
'\n' +
'          // Handle board.loadMinimal - respond with mock board.minimal\n' +
'          if (msg.type === "board.loadMinimal" || msg.type === "board.load" || msg.type === "board.refresh") {\n' +
'            setTimeout(function() {\n' +
'              var response = {\n' +
'                data: {\n' +
'                  type: "board.minimal",\n' +
'                  requestId: msg.requestId || "mock-req-1",\n' +
'                  payload: { cards: _mockBoardCards }\n' +
'                }\n' +
'              };\n' +
'              console.log("[mock-vscode] Responding with board.minimal (" + _mockBoardCards.length + " cards)");\n' +
'              _mockMessageLog.push({ direction: "in", msg: response.data, timestamp: Date.now() });\n' +
'              window.dispatchEvent(new MessageEvent("message", response));\n' +
'            }, 100);\n' +
'            return;\n' +
'          }\n' +
'\n' +
'          // Handle issue.getFull - respond with mock full card data\n' +
'          if (msg.type === "issue.getFull" && msg.payload && msg.payload.id) {\n' +
'            var card = _mockBoardCards.find(function(c) { return c.id === msg.payload.id; });\n' +
'            if (card) {\n' +
'              setTimeout(function() {\n' +
'                var fullCard = Object.assign({}, card, {\n' +
'                  acceptance_criteria: "- [ ] Acceptance criteria item 1\\n- [ ] Acceptance criteria item 2",\n' +
'                  design: "## Design Notes\\n\\nSample design notes for **" + card.title + "**",\n' +
'                  notes: "Implementation notes go here.",\n' +
'                  due_at: null,\n' +
'                  defer_until: null,\n' +
'                  is_template: false,\n' +
'                  ephemeral: false,\n' +
'                  parent: null,\n' +
'                  children: [],\n' +
'                  blocks: [],\n' +
'                  blocked_by: [],\n' +
'                  comments: [\n' +
'                    { id: 1, author: "alice", text: "This looks good. Ready for review.", created_at: new Date().toISOString() },\n' +
'                    { id: 2, author: "bob", text: "Agreed, merging.", created_at: new Date().toISOString() }\n' +
'                  ]\n' +
'                });\n' +
'                var response = {\n' +
'                  data: {\n' +
'                    type: "issue.full",\n' +
'                    requestId: msg.requestId || "mock-req-full",\n' +
'                    payload: { card: fullCard }\n' +
'                  }\n' +
'                };\n' +
'                console.log("[mock-vscode] Responding with issue.full for " + card.id);\n' +
'                _mockMessageLog.push({ direction: "in", msg: response.data, timestamp: Date.now() });\n' +
'                window.dispatchEvent(new MessageEvent("message", response));\n' +
'              }, 50);\n' +
'            } else {\n' +
'              setTimeout(function() {\n' +
'                window.dispatchEvent(new MessageEvent("message", {\n' +
'                  data: {\n' +
'                    type: "mutation.error",\n' +
'                    requestId: msg.requestId || "mock-req-err",\n' +
'                    error: "Issue not found: " + msg.payload.id\n' +
'                  }\n' +
'                }));\n' +
'              }, 50);\n' +
'            }\n' +
'            return;\n' +
'          }\n' +
'\n' +
'          // Handle mutations - respond with mock success\n' +
'          if (msg.type === "issue.create" || msg.type === "issue.update" ||\n' +
'              msg.type === "issue.move" || msg.type === "issue.addComment" ||\n' +
'              msg.type === "issue.addLabel" || msg.type === "issue.removeLabel" ||\n' +
'              msg.type === "issue.addDependency" || msg.type === "issue.removeDependency") {\n' +
'            setTimeout(function() {\n' +
'              var response = {\n' +
'                data: {\n' +
'                  type: "mutation.ok",\n' +
'                  requestId: msg.requestId || "mock-req-mut",\n' +
'                  payload: msg.type === "issue.create"\n' +
'                    ? { id: "mock-new-" + Date.now(), title: (msg.payload && msg.payload.title) || "New Issue" }\n' +
'                    : {}\n' +
'                }\n' +
'              };\n' +
'              console.log("[mock-vscode] Responding with mutation.ok for " + msg.type);\n' +
'              _mockMessageLog.push({ direction: "in", msg: response.data, timestamp: Date.now() });\n' +
'              window.dispatchEvent(new MessageEvent("message", response));\n' +
'            }, 50);\n' +
'            return;\n' +
'          }\n' +
'\n' +
'          // Log unhandled messages\n' +
'          console.log("[mock-vscode] Unhandled message type:", msg.type);\n' +
'        },\n' +
'        getState: function() { return _mockState; },\n' +
'        setState: function(s) { _mockState = s; return s; }\n' +
'      };\n' +
'    };\n' +
'  </script>\n' +
'\n' +
'  <!-- Graph view scripts (module type, loaded before board.js) -->\n' +
'  <script type="module" src="/out/webview/graph-layout.js"></script>\n' +
'  <script type="module" src="/out/webview/graph-view.js"></script>\n' +
'\n' +
'  <!-- Board.js bundle (bundled with Pragmatic Drag and Drop) -->\n' +
'  <script src="/out/webview/board.js"></script>\n' +
'</body>\n' +
'</html>';
}

// ---------------------------------------------------------------------------
// MIME types
// ---------------------------------------------------------------------------
var MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function getMimeType(filePath) {
  var ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

// ---------------------------------------------------------------------------
// HTTP Server
// ---------------------------------------------------------------------------
function createServer() {
  return http.createServer(function(req, res) {
    var url = req.url.split('?')[0]; // Strip query string

    // Route: / -> generated HTML
    if (url === '/' || url === '/index.html') {
      var html = generateHtml();
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Length': Buffer.byteLength(html)
      });
      res.end(html);
      return;
    }

    // Route: /media/* -> serve from PROJECT_ROOT/media/
    // Route: /out/* -> serve from PROJECT_ROOT/out/
    var filePath = null;
    if (url.startsWith('/media/')) {
      filePath = path.join(PROJECT_ROOT, 'media', url.slice('/media/'.length));
    } else if (url.startsWith('/out/')) {
      filePath = path.join(PROJECT_ROOT, 'out', url.slice('/out/'.length));
    }

    if (filePath) {
      // Security: Prevent directory traversal
      var resolvedPath = path.resolve(filePath);
      if (!resolvedPath.startsWith(path.resolve(PROJECT_ROOT))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      try {
        var content = fs.readFileSync(resolvedPath);
        res.writeHead(200, {
          'Content-Type': getMimeType(resolvedPath),
          'Cache-Control': 'no-cache',
          'Content-Length': content.length
        });
        res.end(content);
      } catch (err) {
        res.writeHead(404);
        res.end('Not found: ' + url);
      }
      return;
    }

    // Fallback: 404
    res.writeHead(404);
    res.end('Not found: ' + url);
  });
}

// ---------------------------------------------------------------------------
// Chrome Launcher
// ---------------------------------------------------------------------------
function launchChrome(url, debugPort) {
  // Try common Chrome locations
  var chromePaths = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA + '/Google/Chrome/Application/chrome.exe'
  ];

  if (process.platform === 'darwin') {
    chromePaths = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  } else if (process.platform === 'linux') {
    chromePaths = ['google-chrome', 'chromium-browser', 'chromium'];
  }

  var chromePath = null;
  for (var i = 0; i < chromePaths.length; i++) {
    try {
      if (fs.existsSync(chromePaths[i])) {
        chromePath = chromePaths[i];
        break;
      }
    } catch (_e) {
      // On Linux, the path might be a command name, not a file path
      if (process.platform === 'linux') {
        chromePath = chromePaths[i];
        break;
      }
    }
  }

  if (!chromePath) {
    console.log('  WARNING: Could not find Chrome. Please open manually:');
    console.log('    ' + url);
    return null;
  }

  // Create a temporary user-data-dir so we don't interfere with the user's profile
  var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-vts-chrome-'));

  var args = [
    '--remote-debugging-port=' + debugPort,
    '--user-data-dir=' + tempDir,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-extensions',
    url
  ];

  console.log('  Launching Chrome: ' + chromePath);
  console.log('  Debug port: ' + debugPort);
  console.log('  User data: ' + tempDir);

  // Use spawn with explicit args array (no shell injection risk)
  var useShell = process.platform === 'win32';
  var proc = childProcess.spawn(
    useShell ? ('"' + chromePath + '"') : chromePath,
    args,
    {
      detached: true,
      stdio: 'ignore',
      shell: useShell
    }
  );

  proc.unref();

  return { process: proc, tempDir: tempDir };
}

// ---------------------------------------------------------------------------
// Rebuild helper (uses execFileSync with fixed args - no user input)
// ---------------------------------------------------------------------------
function rebuildWebview() {
  console.log('Building webview bundle...');
  try {
    // Run build-webview script directly via node (avoids npm.cmd issues in Git Bash on Windows)
    childProcess.execFileSync(process.execPath, [path.join(PROJECT_ROOT, 'scripts', 'build-webview.js')], {
      cwd: PROJECT_ROOT,
      stdio: 'inherit'
    });
    console.log('  Build complete.');
    console.log('');
  } catch (err) {
    console.error('  Build failed:', err.message);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('======================================================================');
  console.log('  Beads Kanban - Standalone Visual Test Server');
  console.log('======================================================================');
  console.log('');

  // -----------------------------------------------------------------------
  // 1. Optionally rebuild webview
  // -----------------------------------------------------------------------
  if (REBUILD) {
    rebuildWebview();
  }

  // Verify required files exist
  var requiredFiles = [
    'out/webview/board.js',
    'media/styles.css',
    'media/purify.min.js',
    'media/marked.min.js'
  ];

  var missing = [];
  for (var i = 0; i < requiredFiles.length; i++) {
    var fullPath = path.join(PROJECT_ROOT, requiredFiles[i]);
    if (!fs.existsSync(fullPath)) {
      missing.push(requiredFiles[i]);
    }
  }

  if (missing.length > 0) {
    console.error('ERROR: Required files are missing:');
    for (var j = 0; j < missing.length; j++) {
      console.error('  - ' + missing[j]);
    }
    console.error('');
    console.error('Run "npm run build-webview" first, or use --rebuild flag.');
    process.exit(1);
  }

  // -----------------------------------------------------------------------
  // 2. Start HTTP server
  // -----------------------------------------------------------------------
  var server = createServer();
  var serverUrl = 'http://localhost:' + HTTP_PORT;

  await new Promise(function(resolve, reject) {
    server.on('error', function(err) {
      if (err.code === 'EADDRINUSE') {
        console.error('ERROR: Port ' + HTTP_PORT + ' is already in use.');
        console.error('  Use --port=NNNN to specify a different port.');
        reject(err);
      } else {
        reject(err);
      }
    });
    server.listen(HTTP_PORT, function() {
      resolve();
    });
  });

  console.log('  HTTP server listening on: ' + serverUrl);
  console.log('  Theme: ' + THEME);
  console.log('');

  // -----------------------------------------------------------------------
  // 3. Launch Chrome
  // -----------------------------------------------------------------------
  var chromeInfo = null;
  if (!NO_CHROME) {
    console.log('Launching Chrome...');
    chromeInfo = launchChrome(serverUrl, DEBUG_PORT);
    console.log('');
  }

  // -----------------------------------------------------------------------
  // 4. Print connection info
  // -----------------------------------------------------------------------
  console.log('======================================================================');
  console.log('  Visual Test Server Ready');
  console.log('');
  console.log('  Board URL:     ' + serverUrl);
  console.log('  CDP endpoint:  http://localhost:' + DEBUG_PORT);
  console.log('');
  console.log('  Connect Chrome DevTools MCP:');
  console.log('    npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Or add to Claude Code:');
  console.log('    claude mcp add chrome-devtools -- npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Theme options: --theme=dark (default) or --theme=light');
  console.log('');
  console.log('  Message log available in browser console as _mockMessageLog');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('======================================================================');

  // -----------------------------------------------------------------------
  // 5. Handle cleanup
  // -----------------------------------------------------------------------
  var exiting = false;

  function cleanup(signal) {
    if (exiting) { return; }
    exiting = true;
    console.log('');
    console.log('  Received ' + signal + '. Shutting down...');

    server.close();

    // Kill Chrome if we launched it
    if (chromeInfo && chromeInfo.process) {
      try {
        if (process.platform === 'win32') {
          childProcess.spawn('taskkill', ['/pid', String(chromeInfo.process.pid), '/T', '/F'], {
            shell: true,
            stdio: 'ignore'
          });
        } else {
          chromeInfo.process.kill('SIGTERM');
        }
      } catch (_e) {
        // ignore
      }
    }

    // Clean up Chrome temp directory
    if (chromeInfo && chromeInfo.tempDir) {
      try {
        fs.rmSync(chromeInfo.tempDir, { recursive: true, force: true });
        console.log('  Cleaned up Chrome temp dir: ' + chromeInfo.tempDir);
      } catch (_e) {
        // ignore - Chrome may still have files locked
      }
    }

    setTimeout(function() { process.exit(0); }, 500);
  }

  process.on('SIGINT', function() { cleanup('SIGINT'); });
  process.on('SIGTERM', function() { cleanup('SIGTERM'); });
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});

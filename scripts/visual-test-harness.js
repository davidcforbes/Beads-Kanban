#!/usr/bin/env node

/**
 * Visual Test Harness for Beads Kanban
 *
 * Launches VS Code with the Beads Kanban extension loaded and remote debugging
 * enabled on port 9222, so Chrome DevTools MCP (or any CDP client) can connect
 * to the webview for automated visual testing.
 *
 * Usage:
 *   node scripts/visual-test-harness.js [workspace-path] [--port=9222] [--seed-db]
 *
 * Options:
 *   workspace-path   Path to a folder with .beads data (default: temp dir with seeded DB)
 *   --port=NNNN      Chrome DevTools Protocol port (default: 9222)
 *   --seed-db        Force-create a seeded .beads database in the workspace
 *   --no-seed        Skip database seeding even for temp workspaces
 *   --timeout=MS     Exit after MS milliseconds (0 = no timeout, default: 0)
 *
 * Prerequisites:
 *   npm run compile   (must be run first to build the extension)
 *
 * How it works:
 *   1. Downloads/reuses a VS Code instance via @vscode/test-electron
 *   2. Creates a temp workspace with seeded .beads data (if needed)
 *   3. Launches VS Code with --remote-debugging-port for CDP access
 *   4. Loads a tiny "test runner" that executes beadsKanban.openBoard
 *   5. Polls http://localhost:<port>/json until the webview target appears
 *   6. Prints connection info and stays alive for interactive testing
 *
 * Note: This script uses child_process.spawn (not exec) to launch VS Code.
 * All arguments are passed as array elements, not interpolated into a shell
 * string, so there is no command-injection risk.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const childProcess = require('child_process');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);

function getArg(name, defaultVal) {
  const prefix = `--${name}=`;
  const found = cliArgs.find(a => a.startsWith(prefix));
  if (found) { return found.slice(prefix.length); }
  return defaultVal;
}
function hasFlag(name) { return cliArgs.includes(`--${name}`); }
function positional() { return cliArgs.find(a => !a.startsWith('--')); }

const DEBUG_PORT = parseInt(getArg('port', '9222'), 10);
const TIMEOUT_MS = parseInt(getArg('timeout', '0'), 10);
const SEED_DB = hasFlag('seed-db');
const NO_SEED = hasFlag('no-seed');
const WORKSPACE_ARG = positional();

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTTP GET that returns a promise of the response body (string). */
function httpGet(url, timeoutMs) {
  if (timeoutMs === undefined) { timeoutMs = 3000; }
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Sleep for ms milliseconds. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Create a minimal .beads SQLite database using better-sqlite3.
 * Falls back gracefully if better-sqlite3 is not available.
 */
function seedDatabase(workspacePath) {
  const beadsDir = path.join(workspacePath, '.beads');
  if (!fs.existsSync(beadsDir)) {
    fs.mkdirSync(beadsDir, { recursive: true });
  }

  const dbPath = path.join(beadsDir, 'issues.db');
  if (fs.existsSync(dbPath)) {
    console.log('  Database already exists: ' + dbPath);
    return dbPath;
  }

  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);

    db.exec([
      'CREATE TABLE issues (',
      '  id TEXT PRIMARY KEY,',
      '  content_hash TEXT,',
      '  title TEXT NOT NULL CHECK(length(title) <= 500),',
      '  description TEXT NOT NULL DEFAULT \'\',',
      '  design TEXT NOT NULL DEFAULT \'\',',
      '  acceptance_criteria TEXT NOT NULL DEFAULT \'\',',
      '  notes TEXT NOT NULL DEFAULT \'\',',
      '  status TEXT NOT NULL DEFAULT \'open\',',
      '  priority INTEGER NOT NULL DEFAULT 2 CHECK(priority >= 0 AND priority <= 4),',
      '  issue_type TEXT NOT NULL DEFAULT \'task\',',
      '  assignee TEXT,',
      '  estimated_minutes INTEGER,',
      '  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      '  created_by TEXT DEFAULT \'\',',
      '  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      '  closed_at DATETIME,',
      '  closed_by_session TEXT DEFAULT \'\',',
      '  external_ref TEXT,',
      '  compaction_level INTEGER DEFAULT 0,',
      '  compacted_at DATETIME,',
      '  compacted_at_commit TEXT,',
      '  original_size INTEGER,',
      '  deleted_at DATETIME,',
      '  deleted_by TEXT DEFAULT \'\',',
      '  delete_reason TEXT DEFAULT \'\',',
      '  original_type TEXT DEFAULT \'\',',
      '  sender TEXT DEFAULT \'\',',
      '  ephemeral INTEGER DEFAULT 0,',
      '  pinned INTEGER DEFAULT 0,',
      '  is_template INTEGER DEFAULT 0,',
      '  mol_type TEXT DEFAULT \'\',',
      '  event_kind TEXT DEFAULT \'\',',
      '  actor TEXT DEFAULT \'\',',
      '  target TEXT DEFAULT \'\',',
      '  payload TEXT DEFAULT \'\',',
      '  source_repo TEXT DEFAULT \'.\',',
      '  close_reason TEXT DEFAULT \'\',',
      '  await_type TEXT,',
      '  await_id TEXT,',
      '  timeout_ns INTEGER,',
      '  waiters TEXT,',
      '  hook_bead TEXT DEFAULT \'\',',
      '  role_bead TEXT DEFAULT \'\',',
      '  agent_state TEXT DEFAULT \'\',',
      '  last_activity DATETIME,',
      '  role_type TEXT DEFAULT \'\',',
      '  rig TEXT DEFAULT \'\',',
      '  due_at DATETIME,',
      '  defer_until DATETIME,',
      '  CHECK (',
      '    (status = \'closed\' AND closed_at IS NOT NULL) OR',
      '    (status = \'tombstone\') OR',
      '    (status NOT IN (\'closed\', \'tombstone\') AND closed_at IS NULL)',
      '  )',
      ');',
      '',
      'CREATE INDEX idx_issues_status ON issues(status);',
      'CREATE INDEX idx_issues_priority ON issues(priority);',
      '',
      'CREATE TABLE dependencies (',
      '  issue_id TEXT NOT NULL,',
      '  depends_on_id TEXT NOT NULL,',
      '  type TEXT NOT NULL DEFAULT \'blocks\',',
      '  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,',
      '  created_by TEXT NOT NULL,',
      '  metadata TEXT,',
      '  thread_id TEXT,',
      '  PRIMARY KEY (issue_id, depends_on_id, type),',
      '  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE',
      ');',
      '',
      'CREATE TABLE labels (',
      '  issue_id TEXT NOT NULL,',
      '  label TEXT NOT NULL,',
      '  PRIMARY KEY (issue_id, label),',
      '  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE',
      ');',
      '',
      'CREATE TABLE comments (',
      '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
      '  issue_id TEXT NOT NULL,',
      '  author TEXT NOT NULL,',
      '  text TEXT NOT NULL,',
      '  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,',
      '  FOREIGN KEY (issue_id) REFERENCES issues(id) ON DELETE CASCADE',
      ');',
      '',
      'CREATE VIEW ready_issues AS',
      'SELECT i.id',
      'FROM issues i',
      'WHERE i.status = \'open\'',
      '  AND i.deleted_at IS NULL',
      '  AND NOT EXISTS (',
      '    SELECT 1',
      '    FROM dependencies d',
      '    JOIN issues dep ON d.depends_on_id = dep.id',
      '    WHERE d.issue_id = i.id',
      '      AND d.type = \'blocks\'',
      '      AND dep.status != \'closed\'',
      '      AND dep.deleted_at IS NULL',
      '  );',
      '',
      'CREATE VIEW blocked_issues AS',
      'SELECT i.id,',
      '  COUNT(d.depends_on_id) AS blocked_by_count',
      'FROM issues i',
      'JOIN dependencies d ON i.id = d.issue_id',
      'JOIN issues dep ON d.depends_on_id = dep.id',
      'WHERE d.type = \'blocks\'',
      '  AND dep.status != \'closed\'',
      '  AND dep.deleted_at IS NULL',
      '  AND i.deleted_at IS NULL',
      'GROUP BY i.id;',
    ].join('\n'));

    // Seed sample issues across all columns
    const now = new Date().toISOString();
    const insert = db.prepare(
      'INSERT INTO issues (id, title, description, status, priority, issue_type, assignee, created_at, updated_at, closed_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );

    const sampleIssues = [
      ['vt-000001', 'Setup CI/CD pipeline', 'Configure GitHub Actions for automated testing', 'open', 1, 'task', 'alice', now, now, null],
      ['vt-000002', 'Add dark mode support', 'Implement dark theme using CSS variables', 'open', 2, 'feature', 'bob', now, now, null],
      ['vt-000003', 'Fix login redirect bug', 'Users are not redirected after login on mobile', 'open', 0, 'bug', 'charlie', now, now, null],
      ['vt-000004', 'Refactor database layer', 'Extract database calls into repository pattern', 'in_progress', 2, 'task', 'alice', now, now, null],
      ['vt-000005', 'Implement search API', 'Full-text search endpoint for issues', 'in_progress', 1, 'feature', 'bob', now, now, null],
      ['vt-000006', 'Update dependencies', 'Bump all npm packages to latest', 'in_progress', 3, 'chore', null, now, now, null],
      ['vt-000007', 'Design system audit', 'Review and document all UI components', 'blocked', 2, 'task', 'diana', now, now, null],
      ['vt-000008', 'Performance optimization', 'Reduce bundle size below 500KB', 'blocked', 1, 'task', 'charlie', now, now, null],
      ['vt-000009', 'Write unit tests', 'Achieve 80% code coverage', 'closed', 2, 'task', 'alice', now, now, now],
      ['vt-000010', 'Initial project setup', 'Create repo, configure tooling', 'closed', 1, 'task', 'bob', now, now, now],
      ['vt-000011', 'Fix typo in README', 'Correct spelling in installation section', 'closed', 4, 'bug', null, now, now, now],
      ['vt-000012', 'Add export feature', 'Export board data as CSV', 'open', 2, 'feature', 'diana', now, now, null],
    ];

    const insertMany = db.transaction(function(issues) {
      for (const issue of issues) {
        insert.run.apply(insert, issue);
      }
    });
    insertMany(sampleIssues);

    // Add some labels
    const insertLabel = db.prepare('INSERT INTO labels (issue_id, label) VALUES (?, ?)');
    const labelData = [
      ['vt-000001', 'devops'], ['vt-000002', 'frontend'], ['vt-000002', 'ui'],
      ['vt-000003', 'bug'], ['vt-000003', 'mobile'], ['vt-000004', 'backend'],
      ['vt-000005', 'backend'], ['vt-000005', 'api'], ['vt-000007', 'frontend'],
      ['vt-000008', 'performance'], ['vt-000012', 'feature'],
    ];
    const insertLabels = db.transaction(function(labels) {
      for (const entry of labels) { insertLabel.run(entry[0], entry[1]); }
    });
    insertLabels(labelData);

    // Add a blocking dependency (vt-000007 blocked by vt-000004)
    db.prepare(
      'INSERT INTO dependencies (issue_id, depends_on_id, type, created_by) VALUES (?, ?, ?, ?)'
    ).run('vt-000007', 'vt-000004', 'blocks', 'visual-test-harness');

    // Add a comment
    db.prepare(
      'INSERT INTO comments (issue_id, author, text, created_at) VALUES (?, ?, ?, ?)'
    ).run('vt-000003', 'charlie', 'Reproduced on iOS Safari. Investigating.', now);

    db.close();
    console.log('  Seeded database with ' + sampleIssues.length + ' issues at: ' + dbPath);
    return dbPath;

  } catch (err) {
    console.warn('  Warning: Could not create seeded database (' + err.message + ')');
    console.warn('  The extension will still launch but may show "no database found".');
    return null;
  }
}

/**
 * Write the harness test runner to a temp file.
 * This is the script VS Code loads via --extensionTestsPath.
 * It opens the Kanban board command and then keeps VS Code alive.
 */
function writeHarnessRunner(runnerDir) {
  if (!fs.existsSync(runnerDir)) {
    fs.mkdirSync(runnerDir, { recursive: true });
  }
  const runnerPath = path.join(runnerDir, 'index.js');
  const runnerCode = [
    '// Visual Test Harness Runner',
    '// Loaded by VS Code as the "test" entry point. Opens the Kanban board',
    '// and then blocks forever so VS Code stays open for interactive testing.',
    '',
    'const vscode = require("vscode");',
    '',
    'exports.run = function run() {',
    '  return new Promise(function(_resolve, _reject) {',
    '    // Give the extension a moment to activate, then open the board',
    '    setTimeout(async function() {',
    '      try {',
    '        console.log("[visual-harness] Executing beadsKanban.openBoard...");',
    '        await vscode.commands.executeCommand("beadsKanban.openBoard");',
    '        console.log("[visual-harness] Kanban board opened successfully.");',
    '      } catch (err) {',
    '        console.error("[visual-harness] Failed to open board:", err);',
    '        // Do not reject -- we still want VS Code to stay open',
    '      }',
    '    }, 3000);',
    '',
    '    // Never resolve: keeps VS Code running until the user closes it or',
    '    // the outer process sends SIGINT/SIGTERM.',
    '  });',
    '};',
  ].join('\n');
  fs.writeFileSync(runnerPath, runnerCode);
  return runnerPath;
}

/**
 * Poll the CDP /json endpoint until a webview target appears.
 * Returns the target info object, or null on timeout.
 */
async function waitForWebview(port, maxWaitMs) {
  if (maxWaitMs === undefined) { maxWaitMs = 60000; }
  const startTime = Date.now();
  const interval = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const raw = await httpGet('http://localhost:' + port + '/json');
      const targets = JSON.parse(raw);

      // Look for a webview target -- these have "webview" in the URL or title
      const webviewTarget = targets.find(function(t) {
        return (t.url && t.url.includes('vscode-webview')) ||
               (t.title && t.title.toLowerCase().includes('kanban')) ||
               (t.title && t.title.toLowerCase().includes('beads'));
      });

      if (webviewTarget) {
        return webviewTarget;
      }

    } catch (_e) {
      // Port not ready yet
    }

    await sleep(interval);
  }

  return null;
}

/**
 * Wait for the debug port to accept connections.
 */
async function waitForDebugPort(port, maxWaitMs) {
  if (maxWaitMs === undefined) { maxWaitMs = 30000; }
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const raw = await httpGet('http://localhost:' + port + '/json/version');
      JSON.parse(raw);
      return true;
    } catch (_e) {
      // not ready
    }
    await sleep(1000);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('======================================================================');
  console.log('  Beads Kanban - Visual Test Harness');
  console.log('======================================================================');
  console.log('');

  // -----------------------------------------------------------------------
  // 1. Determine workspace
  // -----------------------------------------------------------------------
  var workspacePath;
  var tempDir = null;

  if (WORKSPACE_ARG) {
    workspacePath = path.resolve(WORKSPACE_ARG);
    if (!fs.existsSync(workspacePath)) {
      console.error('ERROR: Workspace path does not exist: ' + workspacePath);
      process.exit(1);
    }
    console.log('Workspace: ' + workspacePath);
    if (SEED_DB) {
      seedDatabase(workspacePath);
    }
  } else {
    // Create a temp workspace with seeded data
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-kanban-visual-'));
    workspacePath = tempDir;
    console.log('Workspace: ' + workspacePath + ' (temporary)');
    if (!NO_SEED) {
      seedDatabase(workspacePath);
    }
  }

  // -----------------------------------------------------------------------
  // 2. Write the harness test runner
  // -----------------------------------------------------------------------
  var runnerDir = path.join(tempDir || os.tmpdir(), 'visual-harness-runner');
  writeHarnessRunner(runnerDir);
  console.log('Runner:    ' + runnerDir);
  console.log('Port:      ' + DEBUG_PORT);
  console.log('');

  // -----------------------------------------------------------------------
  // 3. Download/locate VS Code and launch
  // -----------------------------------------------------------------------
  var testElectron = require('@vscode/test-electron');
  var downloadAndUnzipVSCode = testElectron.downloadAndUnzipVSCode;

  console.log('Downloading/locating VS Code...');
  var vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  console.log('VS Code:   ' + vscodeExecutablePath);
  console.log('');

  // Use the executable directly (Code.exe on Windows, code on others).
  // resolveCliArgsFromVSCodeExecutablePath returns the CLI wrapper (code.cmd)
  // which exits immediately -- we need the actual Electron binary so the
  // process stays alive and we can monitor its lifecycle.
  var executable = vscodeExecutablePath;

  // Build isolated profile directories (same approach as @vscode/test-electron)
  var vscodeTestDir = path.join(PROJECT_ROOT, '.vscode-test');
  var userDataDir = path.join(vscodeTestDir, 'user-data');
  var extensionsDir = path.join(vscodeTestDir, 'extensions');

  var launchArgs = [
    workspacePath,
    '--extensionDevelopmentPath=' + PROJECT_ROOT,
    '--extensionTestsPath=' + runnerDir,
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + userDataDir,
    '--extensions-dir=' + extensionsDir,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-extensions',  // Disable all OTHER extensions for clean testing
  ];

  console.log('Launching VS Code with remote debugging...');
  console.log('  Executable: ' + executable);
  console.log('  Key args: --remote-debugging-port=' + DEBUG_PORT);
  console.log('');

  // On Windows, spawn with shell:true and quote the executable path.
  // On other platforms, spawn directly without shell.
  var useShell = process.platform === 'win32';
  var vsCodeProcess = childProcess.spawn(
    useShell ? ('"' + executable + '"') : executable,
    launchArgs,
    {
      env: Object.assign({}, process.env),
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // Forward VS Code output (selective)
  vsCodeProcess.stdout.on('data', function(data) {
    var lines = data.toString().split('\n').filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      console.log('  [vscode] ' + lines[i]);
    }
  });

  vsCodeProcess.stderr.on('data', function(data) {
    var lines = data.toString().split('\n').filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].includes('DevTools listening') ||
          lines[i].includes('Extension host') ||
          lines[i].includes('visual-harness')) {
        console.log('  [vscode] ' + lines[i]);
      }
    }
  });

  // -----------------------------------------------------------------------
  // 4. Wait for debug port
  // -----------------------------------------------------------------------
  console.log('Waiting for debug port ' + DEBUG_PORT + '...');
  var portReady = await waitForDebugPort(DEBUG_PORT);
  if (!portReady) {
    console.error('ERROR: Debug port did not become available within 30 seconds.');
    console.error('       VS Code may have failed to launch. Check the output above.');
    vsCodeProcess.kill();
    process.exit(1);
  }
  console.log('  Debug port is ready.');
  console.log('');

  // -----------------------------------------------------------------------
  // 5. Wait for webview target
  // -----------------------------------------------------------------------
  console.log('Waiting for Kanban board webview target (up to 60s)...');
  console.log('  (The extension needs ~5s to activate and open the board)');
  var webviewTarget = await waitForWebview(DEBUG_PORT, 60000);

  // List all available targets for diagnostics
  var allTargets = [];
  var workbenchTarget = null;
  try {
    var raw = await httpGet('http://localhost:' + DEBUG_PORT + '/json');
    allTargets = JSON.parse(raw);
    console.log('');
    console.log('  All CDP targets (' + allTargets.length + '):');
    for (var i = 0; i < allTargets.length; i++) {
      var t = allTargets[i];
      var marker = '';
      if (t === webviewTarget) {
        marker = ' <-- WEBVIEW';
      } else if (t.type === 'page' && t.url && t.url.includes('workbench.html')) {
        workbenchTarget = t;
        marker = ' <-- WORKBENCH';
      }
      console.log('    [' + (t.type || '?') + '] ' + (t.title || '(untitled)') + ' - ' + (t.url || '').substring(0, 80) + marker);
    }
  } catch (_e) {
    // ignore
  }

  // If no explicit webview target found, the workbench target is also useful --
  // Chrome DevTools MCP can interact with VS Code's entire UI through it,
  // including any open webview panels rendered inside the workbench.
  var primaryTarget = webviewTarget || workbenchTarget;

  // -----------------------------------------------------------------------
  // 6. Print connection info
  // -----------------------------------------------------------------------
  console.log('');
  console.log('======================================================================');
  if (webviewTarget) {
    console.log('  Visual Test Harness Ready');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('  Webview Target:           ' + (webviewTarget.title || webviewTarget.url));
    console.log('  Webview WS URL:           ' + (webviewTarget.webSocketDebuggerUrl || 'N/A'));
  } else if (workbenchTarget) {
    console.log('  Visual Test Harness Ready');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('  Workbench Target:         ' + (workbenchTarget.title || '(VS Code Workbench)'));
    console.log('  Workbench WS URL:         ' + (workbenchTarget.webSocketDebuggerUrl || 'N/A'));
    console.log('');
    console.log('  Note: The Kanban board webview is rendered inside the workbench.');
    console.log('  Chrome DevTools MCP can interact with it through the workbench target.');
    console.log('  If the board opened, look for its iframe in the DOM.');
  } else {
    console.log('  Visual Test Harness Ready (no targets detected yet)');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('');
    console.log('  The webview was not automatically detected. This can happen if:');
    console.log('    - The bd CLI is not on PATH (extension needs it for data)');
    console.log('    - The board has not been opened yet');
    console.log('');
    console.log('  Try opening manually: Ctrl+Shift+P -> "Beads: Open Kanban Board"');
    console.log('  Then check targets:   curl http://localhost:' + DEBUG_PORT + '/json');
  }
  console.log('');
  console.log('  Connect Chrome DevTools MCP:');
  console.log('    npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Or add to Claude Code:');
  console.log('    claude mcp add chrome-devtools -- npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Browse all targets:');
  console.log('    curl http://localhost:' + DEBUG_PORT + '/json');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('======================================================================');

  // -----------------------------------------------------------------------
  // 7. Handle cleanup
  // -----------------------------------------------------------------------
  var exiting = false;

  function cleanup(signal) {
    if (exiting) { return; }
    exiting = true;
    console.log('');
    console.log('  Received ' + signal + '. Shutting down...');

    // Kill VS Code process
    try {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to ensure the entire process tree is killed
        childProcess.spawn('taskkill', ['/pid', String(vsCodeProcess.pid), '/T', '/F'], {
          shell: true,
          stdio: 'ignore'
        });
      } else {
        vsCodeProcess.kill('SIGTERM');
      }
    } catch (_e) {
      // ignore
    }

    // Clean up temp directory
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('  Cleaned up temp workspace: ' + tempDir);
      } catch (_e) {
        // ignore
      }
    }

    // Clean up runner directory (if workspace was user-provided)
    if (!tempDir) {
      try {
        fs.rmSync(runnerDir, { recursive: true, force: true });
      } catch (_e) {
        // ignore
      }
    }

    // Give taskkill a moment, then exit
    setTimeout(function() { process.exit(0); }, 500);
  }

  process.on('SIGINT', function() { cleanup('SIGINT'); });
  process.on('SIGTERM', function() { cleanup('SIGTERM'); });

  vsCodeProcess.on('exit', function(code, signal) {
    if (!exiting) {
      console.log('');
      console.log('  VS Code exited (code=' + code + ', signal=' + signal + ').');
      cleanup('VS Code exit');
    }
  });

  // Optional timeout
  if (TIMEOUT_MS > 0) {
    setTimeout(function() {
      console.log('');
      console.log('  Timeout reached (' + TIMEOUT_MS + 'ms). Shutting down.');
      cleanup('timeout');
    }, TIMEOUT_MS);
  }
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});

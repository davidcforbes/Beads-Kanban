# VS Code for the Web Compatibility Plan

## Executive Summary

This document outlines the refactoring plan to make the Beads Kanban extension compatible with VS Code for the Web (vscode.dev). The extension currently requires the `bd` CLI daemon and uses Node.js child processes, which are incompatible with the browser environment.

## Current Architecture Blockers

### Critical Dependencies on Node.js Runtime

1. **bd CLI Daemon** (`daemonBeadsAdapter.ts`)
   - Uses `child_process.spawn()` to execute `bd` commands
   - Cannot spawn processes in browser WebWorker environment
   - All database operations depend on this

2. **Native Modules**
   - `better-sqlite3` listed as dev dependency
   - Cannot run native Node.js modules in browser

3. **File System Access**
   - Direct file system access patterns
   - Need to migrate to `vscode.workspace.fs` API

4. **Node.js APIs**
   - Uses `spawn`, `execSync` from `child_process`
   - Uses Node.js `path`, `fs` modules

## Proposed Solution: Dual-Architecture Extension

Create a **dual-entry-point extension** that:
- Uses daemon adapter on **desktop** (existing functionality)
- Uses browser-compatible adapter on **web** (new implementation)

This approach maximizes compatibility while preserving desktop performance.

## Architecture Strategy

### Option A: WebAssembly SQLite (RECOMMENDED)

**Bring back sql.js adapter with web compatibility**

Pros:
- Extension previously had this (removed in v2.0.0)
- sql.js is proven WebAssembly SQLite implementation
- Can use `vscode.workspace.fs` for virtual file system access
- Full offline functionality
- No external dependencies or services

Cons:
- Read-only mode in browser (no mutation support without backend)
- sql.js adds ~1MB to bundle size
- Need to handle database file loading from virtual FS

### Option B: Backend Service API

**Create a web service that exposes beads data**

Pros:
- Full read/write support
- Could enable collaboration features
- Centralized data management

Cons:
- Requires hosting infrastructure
- Authentication/authorization complexity
- Network dependency
- Privacy concerns (data leaves local machine)
- Significant implementation effort

### Option C: Read-Only Web Mode

**Display static message in web environment**

Pros:
- Minimal implementation effort
- Clear expectations

Cons:
- Poor user experience
- Extension effectively unusable on web

**RECOMMENDATION: Implement Option A (WebAssembly SQLite)**

This provides the best balance of functionality, user experience, and implementation effort.

## Implementation Plan

### Phase 1: Project Setup and Bundling (Week 1)

#### 1.1 Configure Webpack for Web Extension

Create `webpack.web.config.js`:
```javascript
const path = require('path');
const webpack = require('webpack');

module.exports = {
  target: 'webworker',
  entry: './src/extension.web.ts',
  output: {
    path: path.resolve(__dirname, 'out/web'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2'
  },
  resolve: {
    extensions: ['.ts', '.js'],
    fallback: {
      path: require.resolve('path-browserify'),
      buffer: require.resolve('buffer/'),
      stream: require.resolve('stream-browserify'),
      util: require.resolve('util/'),
      // No fallback for fs, child_process - will error if used
      fs: false,
      child_process: false
    }
  },
  externals: {
    vscode: 'commonjs vscode'
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process/browser',
      Buffer: ['buffer', 'Buffer']
    })
  ]
};
```

#### 1.2 Update package.json

Add web extension support:
```json
{
  "main": "./out/extension.js",
  "browser": "./out/web/extension.js",
  "scripts": {
    "compile": "npm run build-extension && npm run build-webview && npm run copy-deps",
    "compile-web": "webpack --config webpack.web.config.js",
    "watch-web": "webpack --watch --config webpack.web.config.js",
    "package-web": "webpack --mode production --config webpack.web.config.js"
  },
  "dependencies": {
    "sql.js": "^1.11.0",
    "path-browserify": "^1.0.1",
    "buffer": "^6.0.3",
    "stream-browserify": "^3.0.0",
    "util": "^0.12.5"
  }
}
```

### Phase 2: Create Web-Compatible Adapter (Week 2)

#### 2.1 Create WebBeadsAdapter

Create `src/webBeadsAdapter.ts`:
```typescript
import * as vscode from 'vscode';
import initSqlJs, { Database } from 'sql.js';
import { BoardData, FullCard, Comment } from './types';

/**
 * Browser-compatible BeadsAdapter using sql.js (WebAssembly)
 * Uses vscode.workspace.fs for virtual file system access
 */
export class WebBeadsAdapter {
  private workspaceRoot: vscode.Uri;
  private db: Database | null = null;
  private output: vscode.OutputChannel;

  constructor(workspaceRoot: vscode.Uri, output: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.output = output;
  }

  /**
   * Initialize sql.js and load database from virtual file system
   */
  async initialize(): Promise<void> {
    try {
      // Initialize sql.js WebAssembly module
      const SQL = await initSqlJs({
        locateFile: file => `https://sql.js.org/dist/${file}`
      });

      // Find .beads database file using vscode.workspace.fs
      const dbPath = await this.findBeadsDatabase();

      // Read database file as Uint8Array
      const dbContent = await vscode.workspace.fs.readFile(dbPath);

      // Load database into sql.js
      this.db = new SQL.Database(dbContent);

      this.output.appendLine('✓ Loaded .beads database in browser mode');
    } catch (error) {
      this.output.appendLine(`✗ Failed to load database: ${error}`);
      throw error;
    }
  }

  /**
   * Find .beads/*.db file in workspace using virtual FS
   */
  private async findBeadsDatabase(): Promise<vscode.Uri> {
    const beadsDir = vscode.Uri.joinPath(this.workspaceRoot, '.beads');
    const entries = await vscode.workspace.fs.readDirectory(beadsDir);

    for (const [name, type] of entries) {
      if (type === vscode.FileType.File &&
          (name.endsWith('.db') || name.endsWith('.sqlite') || name.endsWith('.sqlite3'))) {
        return vscode.Uri.joinPath(beadsDir, name);
      }
    }

    throw new Error('No .beads database file found');
  }

  /**
   * Load full board data (read-only)
   */
  async loadBoard(maxIssues: number = 1000): Promise<BoardData> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Query issues from database
    const issues = this.queryIssues(maxIssues);

    return {
      cards: issues,
      columns: this.categorizeIssues(issues)
    };
  }

  private queryIssues(limit: number): FullCard[] {
    const stmt = this.db!.prepare(`
      SELECT
        id, title, description, status, priority,
        issue_type, assignee, created_at, updated_at
      FROM issues
      WHERE deleted_at IS NULL
      LIMIT ?
    `);

    const results: FullCard[] = [];
    stmt.bind([limit]);

    while (stmt.step()) {
      const row = stmt.getAsObject();
      results.push(this.mapRowToCard(row));
    }

    stmt.free();
    return results;
  }

  // ... additional methods for querying dependencies, comments, labels
}
```

#### 2.2 Create Adapter Factory

Create `src/adapterFactory.ts`:
```typescript
import * as vscode from 'vscode';
import { DaemonBeadsAdapter } from './daemonBeadsAdapter';
import { WebBeadsAdapter } from './webBeadsAdapter';

export type BeadsAdapter = DaemonBeadsAdapter | WebBeadsAdapter;

export async function createAdapter(
  workspaceRoot: string | vscode.Uri,
  output: vscode.OutputChannel
): Promise<BeadsAdapter> {
  // Detect if running in web or desktop environment
  const isWeb = typeof workspaceRoot !== 'string';

  if (isWeb) {
    output.appendLine('Creating web adapter (read-only mode)');
    const adapter = new WebBeadsAdapter(workspaceRoot as vscode.Uri, output);
    await adapter.initialize();
    return adapter;
  } else {
    output.appendLine('Creating daemon adapter (full functionality)');
    return new DaemonBeadsAdapter(workspaceRoot as string, output);
  }
}
```

### Phase 3: Create Web Entry Point (Week 2)

#### 3.1 Create extension.web.ts

```typescript
import * as vscode from 'vscode';
import { createAdapter } from './adapterFactory';

export async function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel('Beads Kanban');
  output.appendLine('Activating Beads Kanban (Web Mode)');

  // Show read-only warning
  vscode.window.showInformationMessage(
    'Beads Kanban is running in read-only mode on the web. ' +
    'Install the desktop extension for full editing capabilities.'
  );

  // Register commands with web-compatible implementation
  const openBoardCommand = vscode.commands.registerCommand(
    'beadsKanban.openBoard',
    async () => {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open');
        return;
      }

      try {
        // Create web adapter
        const adapter = await createAdapter(workspaceFolder.uri, output);

        // Create and show webview panel
        const panel = vscode.window.createWebviewPanel(
          'beadsKanban',
          'Beads Kanban Board',
          vscode.ViewColumn.One,
          {
            enableScripts: true,
            retainContextWhenHidden: true
          }
        );

        // Load board data
        const boardData = await adapter.loadBoard();

        // Send to webview
        panel.webview.postMessage({
          type: 'board.data',
          payload: boardData
        });

      } catch (error) {
        vscode.window.showErrorMessage(`Failed to open board: ${error}`);
      }
    }
  );

  context.subscriptions.push(openBoardCommand);
}

export function deactivate() {}
```

### Phase 4: Handle Web Constraints (Week 3)

#### 4.1 Add Read-Only Mode to Webview

Update `src/webview/board.js` to detect and handle read-only mode:

```javascript
// Detect read-only mode from initial message
let isReadOnlyMode = false;

function handleMessage(event) {
  const message = event.data;

  if (message.type === 'board.data') {
    isReadOnlyMode = message.readOnly || false;

    if (isReadOnlyMode) {
      showReadOnlyBanner();
      disableMutationUI();
    }
  }
}

function showReadOnlyBanner() {
  const banner = document.createElement('div');
  banner.className = 'read-only-banner';
  banner.textContent = '📖 Read-only mode - Open in VS Code Desktop to edit';
  document.body.insertBefore(banner, document.body.firstChild);
}

function disableMutationUI() {
  // Disable drag-and-drop
  // Hide create/edit/delete buttons
  // Make all inputs read-only
}
```

#### 4.2 Update package.json Capabilities

Add web capabilities configuration:

```json
{
  "capabilities": {
    "virtualWorkspaces": {
      "supported": "limited",
      "description": "Read-only board viewing is supported in virtual workspaces."
    },
    "untrustedWorkspaces": {
      "supported": "limited",
      "description": "Extension provides read-only functionality in untrusted workspaces."
    }
  }
}
```

### Phase 5: Testing (Week 3-4)

#### 5.1 Local Testing with @vscode/test-web

```bash
# Install test-web
npm install --save-dev @vscode/test-web

# Add test script
"test-web": "vscode-test-web --browserType=chromium --extensionDevelopmentPath=. ."

# Run tests
npm run test-web
```

#### 5.2 Test on vscode.dev

1. Build production bundle: `npm run package-web`
2. Host extension with HTTPS server
3. Install on vscode.dev via Developer menu
4. Test core functionality:
   - Open GitHub repository with .beads folder
   - Load Kanban board
   - Verify read-only mode
   - Check performance with large databases

#### 5.3 Create Web-Specific Tests

Create `src/test/web/suite/web.test.ts`:
```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Web Extension Tests', () => {
  test('WebBeadsAdapter initializes', async () => {
    const workspaceUri = vscode.workspace.workspaceFolders![0].uri;
    const output = vscode.window.createOutputChannel('Test');

    const { WebBeadsAdapter } = await import('../../../webBeadsAdapter');
    const adapter = new WebBeadsAdapter(workspaceUri, output);

    await adapter.initialize();
    assert.ok(adapter);
  });

  test('Board loads in read-only mode', async () => {
    // Test board loading logic
  });
});
```

### Phase 6: Documentation (Week 4)

#### 6.1 Update README.md

Add web compatibility section:
```markdown
## VS Code for the Web Support

This extension works on [vscode.dev](https://vscode.dev) with **read-only** functionality:

✅ View Kanban board
✅ Browse issues, dependencies, comments
✅ Search and filter
❌ Create/edit/delete issues (desktop only)
❌ Drag-and-drop (desktop only)

For full functionality, install in VS Code Desktop.
```

#### 6.2 Update CLAUDE.md

Add web extension development section with:
- How the dual-architecture works
- When each adapter is used
- Testing procedures for web
- Known limitations

#### 6.3 Create MIGRATION_TO_WEB.md

Document migration process and architectural decisions.

## File Structure After Implementation

```
beads-kanban/
├─ src/
│  ├─ extension.ts           # Desktop entry point (existing)
│  ├─ extension.web.ts       # Web entry point (new)
│  ├─ daemonBeadsAdapter.ts  # Desktop adapter (existing)
│  ├─ webBeadsAdapter.ts     # Web adapter (new)
│  ├─ adapterFactory.ts      # Adapter factory (new)
│  ├─ types.ts               # Shared types (existing)
│  └─ webview/
│     └─ board.js            # Updated with read-only mode
├─ out/
│  ├─ extension.js           # Desktop bundle
│  └─ web/
│     └─ extension.js        # Web bundle
├─ webpack.web.config.js     # Web bundler config (new)
└─ package.json              # Updated with browser field
```

## Dependencies

### Add
- `sql.js` - WebAssembly SQLite (~1MB)
- `path-browserify` - Browser path utilities
- `buffer` - Node.js Buffer polyfill
- `stream-browserify` - Stream polyfill
- `util` - Util polyfill
- `@vscode/test-web` - Web extension testing

### Remove
None (daemon adapter still needed for desktop)

## Bundle Size Impact

- Desktop bundle: ~631 KB (unchanged)
- Web bundle: ~1.8 MB (sql.js + extension code)
- Total VSIX size: ~2.5 MB (acceptable for web extension)

## Known Limitations

### Web Mode Constraints

1. **Read-only**: No create/edit/delete operations
2. **No daemon sync**: Cannot auto-refresh on external changes
3. **Large databases**: May be slower to load (all in-memory)
4. **Virtual FS only**: Cannot access local file system

### Future Enhancements (Post-MVP)

1. **Backend service**: Enable mutations via HTTP API
2. **IndexedDB caching**: Persist loaded database in browser
3. **Incremental loading**: Lazy-load large databases
4. **Collaboration**: Real-time multi-user editing

## Success Criteria

✅ Extension installs on vscode.dev without errors
✅ Kanban board loads from .beads database in GitHub repos
✅ Read-only mode clearly communicated to users
✅ Performance acceptable for databases up to 1000 issues
✅ Desktop functionality unchanged (daemon adapter still works)
✅ Documentation updated with web support details

## Timeline Summary

- **Week 1**: Project setup, webpack config, package.json updates
- **Week 2**: Web adapter implementation, adapter factory
- **Week 3**: Web constraints handling, UI updates
- **Week 4**: Testing, documentation, release preparation

**Total effort**: ~3-4 weeks for full implementation and testing

## Next Steps

1. Review and approve this plan
2. Create implementation branch: `feature/web-extension-support`
3. Begin Phase 1 (project setup)
4. Iterate through phases with testing at each step
5. Beta test on vscode.dev with real repositories
6. Release as v2.1.0 with web support

## Questions for Decision

1. Should we support mutation operations via backend service in v2.1, or defer to v2.2?
2. What's acceptable bundle size limit for web? (Currently ~1.8 MB)
3. Should we maintain feature parity between desktop/web, or is read-only acceptable?
4. How should we handle sql.js initialization failures on vscode.dev?

---

**Document Status**: Draft
**Last Updated**: 2026-01-19
**Author**: Claude (with human review)

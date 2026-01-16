# Migration Guide: v1.x to v2.0.0

## Overview

Version 2.0.0 is a **major breaking release** that simplifies the extension architecture by removing the in-memory SQLite adapter and making the extension **daemon-only**. This change significantly reduces bundle size (~1.7MB smaller) and simplifies maintenance.

## Breaking Changes

### 1. Daemon-Only Architecture

**v1.x Behavior:**
- Extension supported two adapters: sql.js (in-memory) and daemon adapter
- `beadsKanban.useDaemonAdapter` setting controlled which adapter to use
- sql.js adapter was the default

**v2.0.0 Behavior:**
- Extension **only** supports the daemon adapter
- `beadsKanban.useDaemonAdapter` setting removed (always true)
- Requires `bd` CLI to be installed and on PATH
- Daemon auto-starts when extension loads

### 2. Configuration Changes

**Removed Settings:**
- `beadsKanban.useDaemonAdapter` - No longer needed (always daemon mode)

**Deprecated Settings:**
- `beadsKanban.maxIssues` - Use `initialLoadLimit` and `pageSize` instead

### 3. Test Suite Changes

- Removed sql.js adapter tests
- All extension tests now require `bd` daemon to be running
- Test files removed:
  - `adapter.test.ts`
  - `adapter-security.test.ts`
  - `crud.test.ts`
  - `database-edge-cases.test.ts`
  - `error-handling.test.ts`
  - `incremental-loading.test.ts`
  - `performance.test.ts`
  - `relationships.test.ts`
  - `webview-integration.test.ts`

## Migration Steps

### For Users

1. **Install Beads CLI** (if not already installed):
   ```bash
   # Install from https://github.com/steveyegge/beads
   # Ensure 'bd' is on your PATH
   ```

2. **Remove Old Configuration** (optional):
   Open VS Code settings and remove:
   - `beadsKanban.useDaemonAdapter` (no longer exists)
   - `beadsKanban.maxIssues` (deprecated, use new settings below)

3. **Update Configuration** (optional):
   If you had custom `maxIssues` setting, replace with:
   ```json
   {
     "beadsKanban.initialLoadLimit": 100,
     "beadsKanban.pageSize": 50,
     "beadsKanban.preloadClosedColumn": false
   }
   ```

4. **Update Extension:**
   - Install v2.0.0 from VSIX or marketplace
   - Extension will auto-start daemon on first use
   - Check daemon status in the status bar

### For Developers

1. **Update Development Environment:**
   ```bash
   # Install dependencies
   npm install

   # Rebuild extension
   npm run compile
   ```

2. **Run Tests:**
   ```bash
   # Ensure bd daemon is running first
   bd daemon start

   # Run tests
   npm test
   ```

3. **Code Changes:**
   - `BeadsAdapter` class removed - use `DaemonBeadsAdapter` only
   - `src/beadsAdapter.ts` deleted
   - All adapter references now point to `DaemonBeadsAdapter`
   - Extension always instantiates `DaemonBeadsAdapter` at startup

## Why This Change?

### Benefits

1. **Smaller Bundle Size:** Removed ~1.7MB of sql.js dependencies
2. **Simpler Maintenance:** One adapter to maintain instead of two
3. **Better Performance:** Daemon adapter has better caching and incremental loading
4. **Consistency:** All users on same code path, fewer edge cases
5. **Future-Proof:** Daemon is the recommended path for Beads integration

### Trade-offs

- Requires `bd` CLI to be installed
- Requires daemon to be running (auto-starts)
- Slightly more setup for new users

## Troubleshooting

### Extension Won't Load

**Problem:** Extension shows "Daemon not running" error

**Solution:**
1. Ensure `bd` is installed and on PATH:
   ```bash
   bd --version
   ```
2. Manually start daemon:
   ```bash
   bd daemon start
   ```
3. Check daemon status:
   ```bash
   bd daemon status
   ```
4. Use extension command: "Beads: Manage Daemon"

### Performance Issues

**Problem:** Board loads slowly with large databases

**Solution:**
Adjust incremental loading settings:
```json
{
  "beadsKanban.initialLoadLimit": 50,     // Reduce initial load
  "beadsKanban.pageSize": 25,             // Smaller pages
  "beadsKanban.preloadClosedColumn": false // Don't load closed issues
}
```

### Missing Configuration Setting

**Problem:** `beadsKanban.useDaemonAdapter` setting missing

**Solution:**
This setting was removed in v2.0.0. The extension is now always in daemon mode. Remove the setting from your VS Code configuration.

## Downgrading to v1.x

If you need to downgrade:

1. Uninstall v2.0.0
2. Install v1.x from VSIX or marketplace
3. Add back configuration:
   ```json
   {
     "beadsKanban.useDaemonAdapter": true  // Or false for sql.js mode
   }
   ```

## Support

- **Issues:** https://github.com/davidcforbes/beads-kanban/issues
- **Discussions:** https://github.com/davidcforbes/beads-kanban/discussions
- **Beads Documentation:** https://github.com/steveyegge/beads

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed changes in v2.0.0.

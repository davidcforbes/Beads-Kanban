# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code extension that provides a Kanban board interface for issues stored in a `.beads` SQLite database. The extension uses the `bd` CLI daemon for all database operations, providing efficient incremental loading and real-time updates. The board uses column-based loading to keep large databases (10,000+ issues) responsive.

## Development Commands

### Build and Watch

- `npm run compile` - Compile TypeScript and copy assets (DOMPurify)
- `npm run watch` - Watch mode for development
- `npm run lint` - Run ESLint on TypeScript files

### Packaging the Extension

**IMPORTANT: Use PowerShell for packaging on Windows**

Git Bash has issues running `vsce package` (silent failures with no output). Always use PowerShell:

```powershell
# In PowerShell (not Git Bash)
vsce package
```

This will:
1. Run `vscode:prepublish` script (which runs `npm run compile`)
2. Compile TypeScript, copy dependencies, and build webview bundle
3. Create `beads-kanban-{version}.vsix` file

**Common Issues:**
- If packaging fails silently in Git Bash, switch to PowerShell
- Ensure you've run `npm run compile` successfully before packaging
- Check that all TypeScript files compile without errors (`tsc -p .`)

### Code Quality

The project uses ESLint with strict TypeScript rules:

- `.eslintrc.json` contains project-specific configuration
- Test files (`.test.ts` and files in `test/`) have relaxed rules (allow `any` types)
- All source code must pass `npm run lint` with no errors
- Use `unknown` type instead of `any` in production code, with proper type assertions

**Type Safety Patterns:**

When replacing `any` types with `unknown` for ESLint compliance:

1. **CLI Result Handling**: Cast results from `execBd()` to expected types:
   ```typescript
   const result = await this.execBd(['info', '--json']);
   const info = result as { daemon_connected?: boolean } | null;
   ```

2. **Object Mapping**: Use type assertions when mapping unknown objects:
   ```typescript
   const issue = rawIssue as Record<string, unknown>;
   const fullCard: FullCard = {
     id: issue.id as string,
     title: (issue.title as string) || '',
     priority: typeof issue.priority === 'number' ? issue.priority : 2,
     // ... other fields
   };
   ```

3. **Array Operations**: Cast arrays before mapping:
   ```typescript
   private async execBd(args: string[]): Promise<unknown> {
     // ... implementation returns unknown
   }

   const issues = (await this.execBd(['list', '--json'])) as Array<Record<string, unknown>>;
   return issues.map(issue => this.mapToFullCard(issue));
   ```

4. **Dependency Extraction**: Type guard patterns for nested structures:
   ```typescript
   private extractParentDependency(issue: Record<string, unknown>): DependencyInfo | undefined {
     if (!issue.dependents || !Array.isArray(issue.dependents)) {
       return undefined;
     }
     for (const d of issue.dependents) {
       const dep = d as Record<string, unknown>;
       if (dep.dependency_type === 'parent-child') {
         return {
           id: dep.id as string,
           title: dep.title as string,
           // ... other fields
         };
       }
     }
     return undefined;
   }
   ```

**Common ESLint Fixes:**

- `no-explicit-any`: Replace `any` with `unknown` + type assertions
- `no-unused-vars`: Remove unused imports, or prefix with `_` if intentionally unused
- `no-case-declarations`: Wrap switch case blocks with braces when declaring variables
- `curly`: Add braces to all control statements (auto-fixable with `eslint --fix`)
- `semi`: Add semicolons (auto-fixable with `eslint --fix`)
- `no-control-regex`: Add `// eslint-disable-next-line no-control-regex` for intentional control character patterns

### Testing

- `npm test` - Run all tests (requires compile first via pretest)
- `npm run test:watch` - Run tests in watch mode
- `npm run test:coverage` - Run tests with c8 coverage
- Press F5 with "Extension Tests" launch config to debug tests

Running specific tests: The test runner uses Mocha. To run a specific test file or filter by test name, modify `src/test/suite/index.ts` temporarily to use Mocha's `grep` option or change the glob pattern. Test files are in `src/test/suite/*.test.ts`.

### Running the Extension

- Press F5 in VS Code to launch Extension Development Host
- Use "Beads: Open Kanban Board" command to open the board

## Architecture

### Core Components

Extension Host (TypeScript/Node.js)

- `src/extension.ts` - Entry point; registers commands, creates webview panel, routes messages, enforces read-only mode, and wires file watching
- `src/daemonBeadsAdapter.ts` - Daemon adapter; uses `bd` CLI to read and mutate issues with efficient caching
- `src/daemonManager.ts` - Runs `bd` daemon status/actions and populates the status bar
- `src/types.ts` - Type definitions and Zod schemas
- `src/webview.ts` - Generates webview HTML with CSP and asset URIs

Webview (JavaScript/HTML/CSS)

- `src/webview/board.js` - UI logic source; bundled with Pragmatic Drag and Drop using esbuild
- `out/webview/board.js` - Bundled webview JavaScript with drag-and-drop functionality
- `media/styles.css` - Theme-aware styling
- `media/marked.min.js` - Markdown rendering
- `media/purify.min.js` - DOMPurify for sanitization

### Message Protocol

The extension uses a request/response pattern for webview-extension communication:

WebMsg types (Webview -> Extension)

- `board.load` / `board.refresh` - Request board data
- `board.loadColumn` - Fetch a slice of a column (offset/limit)
- `board.loadMore` - Load the next page for a column
- `issue.create` - Create new issue
- `issue.move` - Drag-and-drop status change
- `issue.update` - Update issue fields
- `issue.addComment` - Add comment
- `issue.addLabel` / `issue.removeLabel` - Manage labels
- `issue.addDependency` / `issue.removeDependency` - Manage relationships
- `issue.addToChat` - Send to VS Code chat
- `issue.copyToClipboard` - Copy issue context

ExtMsg types (Extension -> Webview)

- `board.data` - Board data payload (may include columnData for incremental loading)
- `board.columnData` - Column slice payload for incremental loading
- `mutation.ok` - Success response
- `mutation.error` - Error response with message
- `webview.cleanup` - Cleanup before panel disposal

### Database Schema

The extension reads from a SQLite database at `.beads/*.db` (or .sqlite/.sqlite3). The DB is expected to include:

Core tables

- `issues` - id, title, description, status, priority, issue_type, assignee, estimated_minutes, created_at, updated_at, closed_at, external_ref, acceptance_criteria, design, notes, due_at, defer_until, pinned, is_template, ephemeral, event/agent metadata, deleted_at
- `dependencies` - issue_id, depends_on_id, type (parent-child | blocks)
- `labels` - issue_id, label
- `comments` - id, issue_id, author, text, created_at

Views

- `ready_issues` - open issues with no blockers
- `blocked_issues` - issues with dependencies (includes blocked_by_count)

### Column Logic

The board displays 4 columns:

1. Ready - status = open and present in ready_issues
2. In Progress - status = in_progress
3. Blocked - status = blocked, or blocked_by_count > 0, or open but not ready
4. Closed - status = closed

Moving cards between columns updates the underlying issue status. The Ready column maps back to open.

### Data Adapter

The extension uses the DaemonBeadsAdapter exclusively for all database operations:

- Uses column-based `bd` queries for incremental loading and `bd show --json` for details
- Uses `bd` CLI for mutations (create/update/move/comments/labels/deps)
- Short-lived cache to reduce CLI overhead
- Exposes `getColumnData` / `getColumnCount` for incremental loading paths
- Auto-starts daemon on extension load if not running

### Input Validation

All mutation messages from the webview are validated with Zod (`src/types.ts`):

- `IssueCreateSchema` / `IssueUpdateSchema`
- `CommentAddSchema` / `LabelSchema` / `DependencySchema`
- `IssueIdSchema` enforces length bounds; issue IDs are treated as opaque strings, not necessarily UUIDs

### Incremental Loading Architecture

The extension uses column-based incremental loading to support large databases (10,000+ issues) without performance degradation.

**Problem:** Loading all issues at once causes:

- Slow initial load (200+ sequential CLI calls for daemon adapter)
- High memory usage (all issues in memory)
- Slow rendering (thousands of DOM nodes)

**Solution:** Column-based lazy loading:

1. **Initial Load**: Load only visible columns (Ready, In Progress, Blocked) with limited items per column
2. **Lazy Load**: Load Closed column and additional pages only when needed
3. **Pagination**: Load in configurable chunks (default: 100 initial, 50 per page)

**Configuration Settings:**

- `beadsKanban.initialLoadLimit` (default: 100, range: 10-1000) - Issues per column on initial load
- `beadsKanban.pageSize` (default: 50, range: 10-500) - Issues to load when clicking Load More
- `beadsKanban.preloadClosedColumn` (default: false) - Whether to load closed issues initially
- `beadsKanban.autoLoadOnScroll` (default: false) - Auto-load more issues on scroll (future feature)
- `beadsKanban.maxIssues` (DEPRECATED) - Use initialLoadLimit and pageSize instead

**Message Protocol for Incremental Loading:**

New request types:

- `board.loadColumn(column, offset, limit)` - Load specific column chunk
- `board.loadMore(column)` - Load next page for a column

Enhanced response:

- `board.data` now includes `columnData` field with per-column metadata (cards, offset, totalCount, hasMore)
- `board.columnData` response for incremental loads

**Frontend State:**

- Column-based state management (`columnState` per column)
- Tracks loaded ranges, total counts, and hasMore flags
- Load More buttons appear when hasMore is true
- Column headers show "loaded / total" counts

**Backend Support:**
The adapter implements:

- `getColumnData(column, offset, limit)` - Paginated column queries
- `getColumnCount(column)` - Fast count queries

**Backward Compatibility:**

- Old `board.load` still works (loads full board up to maxIssues limit)
- Legacy `maxIssues` setting still respected
- Flat `cards` array included in responses for compatibility

**Migration Guide:**
If you have a custom `maxIssues` setting:

1. Set `initialLoadLimit` to your preferred initial load size (default: 100)
2. Set `pageSize` to your preferred page size (default: 50)
3. Remove or ignore `maxIssues` (will be removed in future version)

Example: If you had `maxIssues: 500`, use:

```json
{
  "beadsKanban.initialLoadLimit": 200,
  "beadsKanban.pageSize": 100,
  "beadsKanban.preloadClosedColumn": true
}
```

### Planned UI Consolidation

The Create New Issue and Edit Issue forms will be consolidated into a single shared form unit to ensure identical fields, validation, and features across both workflows.

## Common Bug Patterns

### Dialog Visibility Issues

**Problem**: HTML `<dialog>` element visible when it shouldn't be, even though JavaScript shows `dialog.open === false`.

**Root Cause**: CSS with `display: flex` (or other display values) applied unconditionally overrides the native `<dialog>` hidden behavior.

**Fix**: Use attribute selector to only apply display styles when dialog is actually open:

```css
/* WRONG - always visible */
#detailDialog {
  display: flex;
}

/* CORRECT - only visible when open */
#detailDialog[open] {
  display: flex;
}
```

**Why it happens**: The native `<dialog>` element uses the `[open]` attribute to control visibility. CSS rules that set `display` without checking for `[open]` will override this behavior.

### TypeScript vs ESLint Type Conflicts

**Problem**: Code satisfies ESLint but fails TypeScript compilation after changing `any` to `unknown`.

**Root Cause**: `unknown` requires explicit type assertions before property access, while `any` allows implicit access.

**Solution**: Use type assertions at usage points:

```typescript
// Before (works but fails ESLint)
const result: any = await execBd(['show', id]);
return result.id;

// After (satisfies both ESLint and TypeScript)
const result = await execBd(['show', id]);
const issue = result as { id?: string } | null;
return issue?.id;
```

## Publishing to VS Code Marketplace

### Prerequisites

1. **Azure DevOps Account**: Create at https://dev.azure.com
2. **Personal Access Token (PAT)**: Create in Azure DevOps with:
   - Organization: All accessible organizations
   - Scopes: Marketplace (Manage)
   - Expiration: Set appropriate expiry date
3. **Publisher Account**: Create with `vsce create-publisher <publisher-name>`

### Publishing Workflow

**First-time setup:**

```bash
# Install vsce globally (or use npx)
npm install -g @vscode/vsce

# Create publisher account (if not done)
vsce create-publisher davidcforbes

# Login with your PAT
vsce login davidcforbes
```

**Publishing updates:**

```bash
# 1. Update version in package.json (semantic versioning)
npm version patch  # or minor, major

# 2. Update version in src/webview.ts to match (for cache-busting)

# 3. Ensure all tests pass
npm test

# 4. Ensure ESLint passes
npm run lint

# 5. Package the extension (use PowerShell on Windows)
vsce package

# 6. Publish to marketplace
vsce publish

# 7. Commit version bump and push
git add package.json src/webview.ts
git commit -m "Bump version to $(node -p "require('./package.json').version")"
git push
git push --tags
```

**Package.json Requirements:**

- `version`: Semantic versioning (X.Y.Z)
- `publisher`: Must match your publisher account
- `displayName`: User-friendly name
- `description`: Clear description (< 200 chars recommended)
- `icon`: Path to 128x128 PNG icon
- `repository`: GitHub repo URL
- `license`: License type (MIT, Apache, etc.)
- `engines.vscode`: Minimum VS Code version
- `categories`: Marketplace categories
- `keywords`: Search keywords

**README.md Requirements:**

- Clear description of what the extension does
- Screenshots or GIFs showing functionality
- Installation instructions
- Usage guide
- Configuration options
- Requirements/prerequisites
- License information

### Marketplace Guidelines

- Extension must provide value and work as described
- No executable code in README (security requirement)
- Icon must be clear and recognizable at small sizes
- Screenshots should be high-quality and relevant
- Description should be clear and concise
- All links in README should work
- License must be specified

### Version Management

**CRITICAL**: When bumping version, update in TWO places:

1. `package.json` - Extension version
2. `src/webview.ts` - Cache-busting version string

These must match for proper webview cache invalidation.

### Version Bump and Package Workflow

When creating a new version for marketplace publishing, follow these steps:

**1. Update version numbers (2 files):**

```bash
# Edit package.json - change version field
"version": "2.0.X"

# Edit src/webview.ts - change version constant (line 6)
const version = "2.0.X";
```

**2. Update CHANGELOG.md:**

Add a new version entry at the top with:
- Version number and date
- Categories: 🚀 Performance, ✨ Added, 🐛 Bug Fixes, 🔧 Build System, 📚 Documentation, etc.
- Bullet points describing changes
- Follow Keep a Changelog format

Example:
```markdown
## [2.0.X] - 2026-01-XX

### 🚀 Performance

- **Feature name**: Description of changes
  - Technical details
  - Impact metrics

### 🐛 Bug Fixes

- **Issue description**: How it was fixed
```

**3. Build and package:**

```bash
# Clean previous build artifacts (optional)
rm beads-kanban-*.vsix

# Build and package (runs all bundling automatically)
npx @vscode/vsce package
```

Expected output:
```
✓ Extension host bundle built successfully
✓ Webview bundle built successfully
INFO  Files included in the VSIX:
DONE  Packaged: beads-kanban-2.0.X.vsix (23 files, ~913 KB)
```

**4. Verify package contents:**

```bash
# List files in package
npx @vscode/vsce ls beads-kanban-2.0.X.vsix

# Check file size
ls -lh beads-kanban-2.0.X.vsix
```

Should include only 23 files:
- `out/extension.js` (bundled extension host)
- `out/webview/board.js` (bundled webview)
- `media/` (CSS, JS libraries)
- `images/` (icon, screenshots)
- Documentation (README, CHANGELOG, LICENSE, PUBLISHING, MIGRATION)
- `.github/` (templates, workflows)

**5. Test locally (optional but recommended):**

```bash
# Install in VS Code
code --install-extension beads-kanban-2.0.X.vsix

# Test all functionality:
# - Open Kanban board in project with .beads/
# - Verify drag-and-drop works
# - Test edit forms
# - Check all commands
```

**6. Publish to marketplace:**

```bash
# Publish (requires login with PAT)
npx @vscode/vsce publish

# Or publish specific version
npx @vscode/vsce publish 2.0.X
```

**7. Commit and tag:**

```bash
# Stage version changes
git add package.json src/webview.ts CHANGELOG.md

# Commit
git commit -m "Bump version to 2.0.X"

# Create git tag
git tag v2.0.X

# Push to remote
git push origin main
git push origin v2.0.X
```

**Quick Reference - Files to Update:**

| File | What to Change | Example |
|------|---------------|---------|
| `package.json` | `"version": "X.Y.Z"` | `"version": "2.0.6"` |
| `src/webview.ts` | `const version = "X.Y.Z"` (line 6) | `const version = "2.0.6"` |
| `CHANGELOG.md` | Add new version entry at top | See format above |

**Common Issues:**

- **Wrong file count**: If you see 742+ files instead of 23, check `.vscodeignore` is properly configured
- **Large package size**: If size > 1 MB, ensure bundling is working (check for `out/extension.js`)
- **Build fails**: Run `npm run compile` first to test bundling independently
- **Version mismatch warning**: Ensure package.json and webview.ts versions match exactly

### Publishing Output Reference

**Expected output when packaging and publishing:**

The `vsce package` and `vsce publish` commands will:
1. Execute `vscode:prepublish` script (compile, copy-deps, build-webview)
2. Bundle the extension files into a VSIX package
3. Upload to the VS Code Marketplace (for publish command)

**Bundling optimization:** The extension uses esbuild to bundle both:
- Extension host code (`out/extension.js`) - Single bundled file from all TypeScript sources
- Webview code (`out/webview/board.js`) - Bundled with Pragmatic Drag and Drop library

This reduces the VSIX from 900+ files to under 50 files, improving:
- Installation speed
- Extension activation time
- Overall performance

**Before bundling optimization** (version 2.0.5 and earlier):
```
WARNING  This extension consists of 900 files, out of which 592 are JavaScript files.
DONE  Packaged: beads-kanban-2.0.5.vsix (900 files, 2.26 MB)
```

**After bundling optimization** (version 2.0.6+):
```
✓ Extension host bundle built successfully
✓ Webview bundle built successfully
DONE  Packaged: beads-kanban-2.0.6.vsix (23 files, 912 KB)
```

This represents a 97% reduction in file count and 60% reduction in package size.

See "Extension Bundling" section below for implementation details.

## Extension Bundling

The extension uses esbuild to bundle both the extension host code and webview code into single files, reducing the total file count from 900+ to under 50.

### Why Bundle?

**Problem:** Without bundling, the extension includes:
- 900+ files (592 JavaScript files from node_modules)
- 2.26 MB VSIX package size
- Slow installation and activation

**Solution:** Bundle extension host and webview code separately:
- Extension host: All TypeScript sources bundled into `out/extension.js`
- Webview: UI code + Pragmatic Drag and Drop bundled into `out/webview/board.js`
- Result: ~40 files, ~1.2 MB VSIX, faster activation

### Build Scripts

**Extension host bundler:** `scripts/build-extension.js`
- Bundles all TypeScript sources (`src/**/*.ts` except webview and tests)
- Entry point: `src/extension.ts`
- Output: `out/extension.js` (single file)
- Platform: Node.js
- External dependencies: `vscode` module (provided by VS Code)

**Webview bundler:** `scripts/build-webview.js` (already exists)
- Bundles webview UI code + Pragmatic Drag and Drop
- Entry point: `src/webview/board.js`
- Output: `out/webview/board.js`
- Platform: Browser
- Format: IIFE (immediately invoked function expression)

### Build Configuration

**package.json scripts:**
```json
{
  "vscode:prepublish": "npm run compile",
  "compile": "npm run build-extension && npm run build-webview && npm run copy-deps",
  "build-extension": "node scripts/build-extension.js",
  "build-webview": "node scripts/build-webview.js",
  "watch": "npm run build-extension -- --watch"
}
```

**Development workflow:**
- `npm run compile` - Build everything (extension + webview)
- `npm run watch` - Watch mode for development (auto-rebuild on file changes)
- `npm run build-extension` - Build extension host only
- `npm run build-webview` - Build webview only

### .vscodeignore Updates

The `.vscodeignore` file is updated to exclude source files and keep only the bundled outputs:
```
src/**              # Exclude source files
out/test/**         # Exclude test outputs
**/*.map            # Exclude source maps (keep for debugging if needed)
node_modules/**     # Most of node_modules excluded
!node_modules/zod/  # Keep zod runtime (if needed)
scripts/**          # Exclude build scripts
```

**Important:** After bundling, the VSIX should include:
- `out/extension.js` - Bundled extension host
- `out/webview/board.js` - Bundled webview
- `media/**` - Static assets (CSS, images, marked.js, purify.js)
- `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`

### External Dependencies

Some dependencies must remain external (not bundled):
- `vscode` - VS Code extension API (provided by host)
- Test frameworks - Only used in development, not in production

Runtime dependencies that ARE bundled:
- `zod` - Used for validation at runtime
- `@atlaskit/pragmatic-drag-and-drop` - Webview drag-and-drop (webview bundle)

### Debugging Bundled Code

Source maps are generated for debugging:
- `out/extension.js.map` - Extension host source map
- `out/webview/board.js.map` - Webview source map

To debug, keep source maps in the VSIX by removing `**/*.map` from `.vscodeignore`.

## Important Notes

- The extension requires `bd` CLI on PATH and auto-starts the daemon on load.
- `npm run compile` copies DOMPurify to the media folder via the `copy-deps` script.
- Webview scripts are loaded via CSP nonce; HTML uses inline styles extensively.
- `retainContextWhenHidden: true` keeps webview state when hidden.
- Markdown preview uses marked.js with GFM and DOMPurify sanitization.
- **Webview cache-busting:** The version in `src/webview.ts` must match `package.json` version for proper cache invalidation.
- **Windows packaging:** Always use PowerShell, not Git Bash, for `vsce package` command.

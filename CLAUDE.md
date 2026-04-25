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

Running specific tests: The test runner uses Mocha with `tdd` UI mode (use `suite()` / `test()`, not `describe()` / `it()`). To run a specific test file or filter by test name, modify `src/test/suite/index.ts` temporarily to use Mocha's `grep` option or change the glob pattern. Test files are in `src/test/suite/*.test.ts`.

**Test quality checklist (apply when writing or reviewing tests):**
- Assertions must test the specific constraint, not pass tautologically
- Test input field names must match the Zod schema field names (`id` not `issueId`)
- When testing "rejects X", confirm the rejection is for the right reason
- Integration tests that depend on `bd` CLI must use `skipIfNoBd` guard for CI

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

All mutation messages from the webview MUST be validated with Zod (`src/types.ts`) before use:

- `IssueCreateSchema` / `IssueUpdateSchema`
- `CommentAddSchema` / `LabelSchema` / `DependencySchema`
- `IssueIdSchema` / `ISSUE_ID_PATTERN` - shared regex for issue ID validation (supports custom prefixes and hierarchical dot-separated IDs like `stuff-30m.1.4.9`)
- `BoardLoadColumnSchema` - bounds for incremental loading
- **New handlers** must add their own Zod schema — see Security Rules section

Issue IDs are opaque strings, not necessarily UUIDs. The `bd init` command allows custom project prefixes (e.g., `stuff-`, `proj-`), so validation must not hardcode `beads-`.

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

## Security Rules

These rules are mandatory for all code changes. Violations have caused real bugs in this codebase.

### Webview HTML Safety

**Rule: Every assignment to element.innerHTML MUST go through DOMPurify.sanitize(html, purifyConfig).**

No exceptions. Even if the values are pre-escaped with escapeHtml(), wrap the final assignment in DOMPurify. This is defense-in-depth: a future refactor that adds HTML tags to escapeHtml-only code would immediately create stored XSS.

**Audit pattern:** Search for `.innerHTML =` and verify every match uses DOMPurify.sanitize().

### CLI Argument Ordering

**Rule: All flags (--flag value) MUST come BEFORE the -- separator in execBd calls.**

The `--` tells the CLI "no more flags follow." Placing --author, --type, etc. after `--` means the CLI treats them as positional arguments, bypassing the injection guard entirely.

```typescript
// WRONG - --author after -- is treated as positional text, not a flag
await this.execBd(['comments', 'add', id, '--', text, '--author', author]);

// CORRECT - flags before --, user content after
await this.execBd(['comments', 'add', id, '--author', author, '--', text]);
```

### Input Validation

**Rule: Every webview message handler MUST validate its payload with a Zod schema before use.**

No handler should extract fields from msg.payload without .safeParse(). This includes new message types like table.loadPage. Copy the validation pattern from adjacent handlers.

**Rule: All issue ID fields in Zod schemas MUST use IssueIdSchema, not z.string().max(N).**

This includes parent_id, blocked_by_ids, children_ids, and any field that accepts an issue ID. The Zod schema is the first line of defense; the adapter's validateIssueId() is defense-in-depth, not the primary guard.

### Subprocess Safety

**Rule: All spawn wrappers MUST have a timeout and output buffer limit.**

The DaemonBeadsAdapter.execBd method has both (30s timeout, 50MB buffer). Any new spawn wrapper must replicate these safeguards. Without them, a hung CLI process leaks memory and stalls the extension host event loop.

### Error Message Sanitization

**Rule: Never embed raw CLI stderr in thrown Error messages.**

Run stderr through sanitizeError() or truncate before embedding. Raw stderr can contain internal paths, database locations, and debug output that leaks to the webview via mutation.error.

### Test Correctness

**Rule: Test assertions must test the specific constraint claimed by the test name.**

- Never use tautological assertions like `assert.ok(x || !x)` — these always pass.
- Verify test input objects use the correct field names matching the Zod schema (e.g., `id` not `issueId`, `otherId` not `dependsOnId`).
- When testing "rejects X", ensure the rejection is for the right reason (not a missing required field).

### Event Listener Hygiene in Webview

**Rule: When reusing DOM elements across multiple openDetail() calls, clean up event listeners before adding new ones.**

Use removeEventListener before addEventListener, or use AbortController signals. The form fields are static HTML reused for every card — each openDetail() must not accumulate listeners.

### Shared State Across Modules

**Rule: A safety-critical variable (like detailDirty) must have a single source of truth.**

If both board.js and editForm.js need to check dirty state, share one reference (e.g., export a getter/setter). Two independent copies cause the unsaved-change guard to be bypassed depending on which code path opened the dialog.

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

### Publisher details (this project)

- **Publisher ID:** `davidcforbes` (case-insensitive; marketplace renders as `DavidCForbes`)
- **Owning Microsoft account:** `chris@forbesassetmanagement.com` — the PAT and the marketplace web upload must both be performed signed in as this account, NOT the `davidcforbes@aol.com` account that bd uses for its actor identity.
- **Publisher management page:** <https://marketplace.visualstudio.com/manage/publishers/davidcforbes>
- **Public listing:** <https://marketplace.visualstudio.com/items?itemName=DavidCForbes.beads-kanban>

### Recommended workflow: package locally, upload via web UI

`vsce publish` has been observed to fail intermittently with `read ECONNRESET` during PAT verification on this Windows + PowerShell setup. **The reliable path is to package locally with `vsce package` and upload the resulting `.vsix` through the marketplace web UI.** Steps:

1. **Bump versions in two places** (cache-busting requires both — there is no automation):

   | File | Change |
   |---|---|
   | `package.json` | `"version": "X.Y.Z"` |
   | `src/webview.ts` | `const version = "X.Y.Z";` (line 6) |

2. **Add a CHANGELOG entry** at the top of `CHANGELOG.md` (Keep-a-Changelog format).

3. **Verify the build is clean** before packaging:
   ```powershell
   npx tsc -p . --noEmit       # typecheck
   npm run lint                 # ESLint
   npm test                     # full mocha suite
   ```

4. **Package the VSIX in PowerShell** (NOT Git Bash — silent failures):
   ```powershell
   Remove-Item -Force beads-kanban-*.vsix -ErrorAction SilentlyContinue
   npx --yes @vscode/vsce package
   ```
   Expected output: `DONE  Packaged: C:\dev\beads-kanban\beads-kanban-X.Y.Z.vsix (~37 files, ~1.1 MB)`.

5. **(Optional) Test-install locally before uploading:**
   ```powershell
   code --install-extension beads-kanban-X.Y.Z.vsix
   ```

6. **Upload via the marketplace web UI** — this is the step that actually publishes:
   - Open <https://marketplace.visualstudio.com/manage/publishers/davidcforbes> in a browser signed into Microsoft as `chris@forbesassetmanagement.com` (use an InPrivate window if your default browser is signed into a different account).
   - Find the `beads-kanban` row → click the `…` menu → **Update**.
   - Drag-and-drop or browse to `C:\dev\beads-kanban\beads-kanban-X.Y.Z.vsix`.
   - Wait for the row to flip from "Verifying" to "Published" (a few seconds to a couple of minutes). CDN propagation to all VS Code clients takes ~5–15 minutes after that.

7. **Commit and tag** after the marketplace shows "Published":
   ```powershell
   git add package.json src/webview.ts CHANGELOG.md
   git commit -m "Bump version to X.Y.Z"
   git tag vX.Y.Z
   git push
   git push --tags
   ```

8. **Verify the publish landed:**
   ```powershell
   code --install-extension davidcforbes.beads-kanban --force
   code --list-extensions --show-versions | Select-String beads-kanban
   ```
   Should report `davidcforbes.beads-kanban@X.Y.Z`.

### Fallback: CLI publish (if web UI is unavailable)

`vsce publish` works when it works, but be prepared for it to fail. Prerequisites:

1. **PAT generated from the right Microsoft account.** Sign into <https://dev.azure.com/_usersSettings/tokens> as `chris@forbesassetmanagement.com` (NOT a different MS account — generating from the wrong account is what causes `ERROR The Personal Access Token verification has failed`).
2. **PAT scopes:** Custom defined → **Marketplace → Manage**, Organization: **All accessible organizations**.
3. **Sanity-check the PAT in Notepad before pasting:** standard Azure DevOps PATs are **52 characters**, alphanumeric only. If your prompt shows ~84 asterisks, you almost certainly pasted a JWT/GitHub token by mistake — regenerate.
4. Run from PowerShell:
   ```powershell
   npx @vscode/vsce login davidcforbes        # paste 52-char PAT at prompt
   npx @vscode/vsce publish                    # uses package.json version
   ```

If `vsce publish` returns `read ECONNRESET` even with a valid PAT, fall back to step 6 of the recommended workflow (web upload) — don't burn time troubleshooting transport failures. Symptoms that indicate it's a network/proxy issue rather than a PAT issue:

```powershell
# Should return 200/203/401, not hang or error:
curl -sS -o NUL -w "HTTP %{http_code}`n" https://marketplace.visualstudio.com/_apis/public/gallery
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

### CHANGELOG format

When adding a new version entry to `CHANGELOG.md`, follow Keep-a-Changelog conventions:
- Version number and date at the top of the file
- Category headings: 🚀 Performance, ✨ Added, 🐛 Bug Fixes, 🔧 Build System, 📚 Documentation, 🧹 Cleanup, 📦 Marketplace metadata, etc.
- Bullet points describing changes

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

**Verify package contents** after `vsce package`:

```powershell
npx @vscode/vsce ls beads-kanban-X.Y.Z.vsix
ls beads-kanban-X.Y.Z.vsix
```

Should include ~37 files (~1.1 MB):
- `out/extension.js` (bundled extension host)
- `out/webview/board.js` (bundled webview)
- `media/` (CSS, JS libraries)
- `images/` (icon, screenshots)
- Documentation (README, CHANGELOG, LICENSE, PUBLISHING, MIGRATION, SECURITY, ROADMAP_BEADS_BRIDGE)
- `.github/` (templates, workflows)

**Quick Reference - Files to Update:**

| File | What to Change | Example |
|------|---------------|---------|
| `package.json` | `"version": "X.Y.Z"` | `"version": "2.1.2"` |
| `src/webview.ts` | `const version = "X.Y.Z"` (line 6) | `const version = "2.1.2"` |
| `CHANGELOG.md` | Add new version entry at top | See format above |

**Common Issues:**

- **Wrong file count / huge package**: If you see hundreds of files or >2 MB, the bundler regressed — confirm `out/extension.js` and `out/webview/board.js` exist and `.vscodeignore` excludes `src/**`, `node_modules/**`, and `out/test/**`. Healthy package is ~37 files / ~1.1 MB.
- **Build fails**: Run `npm run compile` first to test bundling independently of `vsce`.
- **Version mismatch warning**: `package.json` and `src/webview.ts` versions must match exactly — the cache-bust query string is keyed on the constant in `webview.ts`.
- **`vsce publish` returns `read ECONNRESET`**: Don't troubleshoot — fall back to web upload at <https://marketplace.visualstudio.com/manage/publishers/davidcforbes>.
- **`vsce publish` returns `Personal Access Token verification has failed`**: PAT was generated from the wrong Microsoft account. The publisher is owned by `chris@forbesassetmanagement.com`; sign into <https://dev.azure.com/_usersSettings/tokens> as that account and regenerate.
- **PAT prompt shows ~84 asterisks instead of ~52**: You pasted the wrong kind of token (likely a JWT or GitHub token). Standard ADO PATs are 52 alphanumeric characters with no whitespace.

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

**After bundling optimization** (version 2.0.6+, current packaging produces ~37 files / ~1.1 MB):
```
✓ Extension host bundle built successfully
✓ Webview bundle built successfully
DONE  Packaged: beads-kanban-X.Y.Z.vsix (37 files, ~1.1 MB)
```

This represents a ~96% reduction in file count and ~50% reduction in package size compared to pre-bundling.

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

- The extension requires `bd` CLI on PATH (or configured via `beadsKanban.bdPath` setting) and auto-starts the daemon on load.
- **Configurable CLI paths:** `beadsKanban.bdPath` and `beadsKanban.doltPath` settings allow users to specify absolute paths to the `bd` and `dolt` executables, supporting portable setups where these tools are not on the system PATH.
- `npm run compile` copies DOMPurify to the media folder via the `copy-deps` script.
- Webview scripts are loaded via CSP nonce; HTML uses inline styles extensively.
- `retainContextWhenHidden: true` keeps webview state when hidden.
- Markdown preview uses marked.js with GFM and DOMPurify sanitization.
- **Webview cache-busting:** The version in `src/webview.ts` must match `package.json` version for proper cache invalidation.
- **Windows packaging:** Always use PowerShell, not Git Bash, for `vsce package` command.
- **Current version:** 2.1.2 (published to VS Code Marketplace 2026-03-28)
- **Visual testing:** Run `npm run test:visual-server` to launch the standalone visual test server with mock data in Chrome. Use Chrome DevTools MCP to automate visual validation. Note: Chrome DevTools MCP does NOT work with VS Code's Electron webviews (Puppeteer's `Target.getDevToolsTarget` is unsupported in Electron). The standalone server renders the same webview code in regular Chrome where MCP works.
- **Test data seeding:** Run `bash scripts/seed-test-data.sh` to populate a .beads database with 53 representative issues for testing. Clean with `bash scripts/clean-test-data.sh`.

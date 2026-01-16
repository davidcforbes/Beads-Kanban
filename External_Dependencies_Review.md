# Comprehensive External Dependencies Security & Support Review

**Project:** beads-kanban VS Code Extension
**Review Date:** 2026-01-16
**Last Updated:** 2026-01-16 (v2.0.0 release)
**Reviewer:** Claude Code Analysis

## Actions Completed (v2.0.0)

### ✅ Major Architectural Simplification

**Removed all SQLite dependencies** - Daemon-only architecture:
- ❌ `sql.js` (v1.13.0) - **REMOVED** (~1.7MB)
- ❌ `@types/sql.js` (v1.4.9) - **REMOVED**
- ❌ `src/beadsAdapter.ts` - **DELETED** (~2000 lines)
- ❌ 9 BeadsAdapter test files - **DELETED**
- Extension now **requires `bd` daemon** for all operations
- Bundle size reduced by ~1.7MB
- Simplified maintenance (one adapter instead of two)

**Removed unused dependencies:**
- ❌ `uuid` (v10.0.0) - **REMOVED** (completely unused)
- ❌ `@types/uuid` (v10.0.0) - **REMOVED**

**Configuration changes:**
- ❌ `beadsKanban.useDaemonAdapter` setting - **REMOVED** (always daemon mode)
- ⚠️ `beadsKanban.maxIssues` - **DEPRECATED** (use `initialLoadLimit` and `pageSize`)

See [MIGRATION.md](MIGRATION.md) for upgrade guide.

## Executive Summary

**Current State (v2.0.0):**
- **2 runtime dependencies** (down from 5): `dompurify`, `zod`
- **3 webview dependencies**: `Sortable.js`, `marked.js`, `purify.min.js`
- **Daemon-only architecture**: Requires `bd` CLI
- **Bundle size**: ~1.7MB smaller than v1.x

**Remaining Optimizations:**
- **Replace Sortable.js (44KB) with Pragmatic Drag and Drop (4.7KB)** - 90% bundle reduction, enterprise support from Atlassian, actively maintained (planned for v2.1)

---

## Runtime Dependencies (2 packages)

### 1. ❌ `uuid` (v10.0.0) - **REMOVED IN v2.0.0**

**Status:** REMOVED (was unused)
**Location:** src/beadsAdapter.ts:6
**Impact:** Security risk with zero benefit

**Finding:**
```typescript
import { v4 as uuidv4 } from "uuid";  // Imported but NEVER USED
```

**Recommendation:** ✅ **REMOVE IMMEDIATELY**
- No functionality depends on this
- Reduces bundle size and attack surface
- Action: Remove from package.json and remove import statement

---

### 2. 🟢 `zod` (v4.3.4) - **KEEP**

**Status:** Actively maintained, excellent support
**Usage:** Critical input validation for all webview messages
**Security:** Zero dependencies, no known vulnerabilities
**Size:** ~58KB unminified

**Internalization Feasibility:** ❌ **NOT RECOMMENDED**
- Would require 1000+ lines of complex validation code
- Zod is actively maintained by Colinhacks with strong TypeScript integration
- Security-critical: manual validation code would likely have bugs

**Alternatives Considered:**
- **Valibot** - 98% smaller bundle, but newer (less battle-tested for security validation)
- **ArkType** - Good performance, but less mature
- **Manual validation** - Error-prone and insecure

**Recommendation:** ✅ **KEEP ZOD**
- Security-critical use case (preventing XSS, injection attacks)
- Well-tested, zero dependencies
- Strong TypeScript integration
- Bundle size is acceptable for the value provided

**Sources:**
- [Zod vs Valibot comparison](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/)
- [Valibot introduction](https://www.builder.io/blog/introducing-valibot)
- [Joi vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/joi-vs-zod/)

---

### 3. ❌ `sql.js` (v1.13.0) - **REMOVED IN v2.0.0**

**Status:** REMOVED (architectural simplification)
**Previous Usage:** In-memory SQLite database via WebAssembly
**Size Saved:** ~1.7MB (including WASM)
**Location:** Was used only in sql.js adapter (beadsAdapter.ts - now deleted)

**Removal Rationale:**
- Extension is now daemon-only (uses `bd` CLI for all database operations)
- Eliminates dual-adapter complexity
- Reduces bundle size by ~1.7MB
- Simplifies maintenance and testing
- DaemonBeadsAdapter provides better performance with caching and incremental loading

**Impact:**
- v2.0.0+ users **must** have `bd` CLI installed
- Extension auto-starts daemon on load
- Breaking change documented in MIGRATION.md

**Sources:**
- [Chrome's SQLite WASM guide](https://developer.chrome.com/blog/from-web-sql-to-sqlite-wasm)
- [SQLite WASM with OPFS](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system)
- [Official SQLite WASM docs](https://sqlite.org/wasm/doc/tip/about.md)

---

### 4. 🟢 `dompurify` (v3.3.1) - **KEEP**

**Status:** Actively maintained, security-focused
**Usage:** HTML sanitization for markdown preview
**Size:** 23KB minified
**Security:** Regularly updated for XSS prevention

**Internalization Feasibility:** ❌ **NOT RECOMMENDED**
- Security-critical library
- Complex XSS attack vectors require constant updates
- DOM manipulation edge cases are extensive

**Recommendation:** ✅ **KEEP DOMPURIFY**
- Security-critical for markdown rendering
- Small footprint
- Actively maintained with security updates
- Used alongside marked.js in webview (media/board.js:2366)

---

### 5. ⚠️ `@types/sql.js` (v1.4.9) - **MOVE TO DEVDEPENDENCIES**

**Status:** Type definitions only
**Issue:** Should be in devDependencies, not runtime dependencies
**Impact:** Bloats production bundle unnecessarily

**Recommendation:** 🔄 **MOVE TO DEVDEPENDENCIES**
```json
"devDependencies": {
  "@types/sql.js": "^1.4.9",
  // ... other dev dependencies
}
```

---

## Webview Dependencies (3 libraries in media/)

### 6. 🔄 `Sortable.js` (v1.15.2, 44KB) - **REPLACE WITH PRAGMATIC DRAG AND DROP**

**Status:** Sustainable maintenance (last update ~1 year ago)
**Usage:** Drag-and-drop functionality for kanban cards
**Downloads:** 1.28M weekly
**Security:** No known vulnerabilities
**Current Size:** 44KB minified

**Internalization Feasibility:** ⚠️ **DIFFICULT BUT POSSIBLE**
- Drag-and-drop API is complex
- Touch/mouse event handling
- Cross-browser compatibility issues
- Estimate: 500-800 lines of code to replace basic functionality

**Better Alternative: Pragmatic Drag and Drop** (Atlassian)

**Recommendation:** 🔄 **MIGRATE TO PRAGMATIC DRAG AND DROP**

After analyzing alternatives, **Pragmatic Drag and Drop** by Atlassian is the superior choice:

**Key Benefits:**
- **90% smaller bundle** - 4.7KB vs 44KB (39.3KB savings!)
- **Actively maintained** - Powers Trello, Jira, Confluence at scale
- **Framework-agnostic** - Works perfectly with vanilla JS webview
- **Enterprise-grade** - Battle-tested by millions of users
- **Modern architecture** - Built on HTML5 native drag-and-drop API
- **Tree-shakeable** - Only bundle what you need
- **No external dependencies** for core package
- **Headless design** - Full control over UI/UX

**Comparison with Alternatives:**

| Library | Size (gzipped) | Maintenance | Framework | Status |
|---------|----------------|-------------|-----------|--------|
| **Sortable.js** (current) | 44KB | 🟡 Sustainable | Vanilla JS | Current |
| **Pragmatic D&D** ⭐ | 4.7KB | ✅ Active (Atlassian) | Any | **Recommended** |
| **Dragula** | 2.92KB | ❌ Discontinued | Vanilla JS | Too risky |
| **DFlex** | 20.3KB | ✅ Active | Vanilla JS | Good alternative |
| **@shopify/draggable** | 14.1KB | 🟡 Community | Vanilla JS | Acceptable |

**Migration Effort:**
- **Time:** 4-8 hours (moderate refactor due to headless API)
- **Risk:** Low (well-documented, production-proven)
- **Complexity:** Medium (API differences, but cleaner abstractions)

**Migration Path:**
1. Install: `npm install @atlaskit/pragmatic-drag-and-drop`
2. Replace Sortable.js initialization with Pragmatic D&D adapters
3. Update event handlers to use Pragmatic's API
4. Test drag-and-drop across browsers and touch devices
5. Remove Sortable.min.js from media/ folder

**Example Usage:**
```javascript
import { draggable } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';
import { dropTargetForElements } from '@atlaskit/pragmatic-drag-and-drop/element/adapter';

// No provider needed - works directly with vanilla JS
draggable({
  element: cardElement,
  getInitialData: () => ({ cardId: card.id })
});

dropTargetForElements({
  element: columnElement,
  onDrop: ({ source, location }) => {
    // Handle drop logic
  }
});
```

**Why Not Keep Sortable.js?**
- While Sortable.js is still acceptable (no security issues, widely used)
- Pragmatic D&D offers 90% bundle savings with better support
- Atlassian backing ensures long-term viability
- Modern architecture better suited for 2026+ development

**Sources:**
- [SortableJS npm health](https://snyk.io/advisor/npm-package/sortablejs)
- [SortableJS npm page](https://www.npmjs.com/package/sortablejs)
- [SortableJS vulnerabilities](https://security.snyk.io/package/npm/sortablejs)
- [Pragmatic D&D GitHub](https://github.com/atlassian/pragmatic-drag-and-drop)
- [Pragmatic D&D Documentation](https://atlassian.design/components/pragmatic-drag-and-drop/)
- [Pragmatic D&D Core Package](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/)
- [Best drag-drop libraries 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)
- [Vanilla JS drag-drop comparison](https://en.kelen.cc/share/frontend-drag-and-drop-libraries-2025/)
- [Pragmatic D&D implementation guide](https://blog.logrocket.com/implement-pragmatic-drag-drop-library-guide/)

---

### 7. 🟢 `marked.js` (v15.0.12, 40KB) - **KEEP**

**Status:** Actively maintained
**Usage:** Markdown parsing for issue descriptions
**Security:** Historical ReDoS vulnerabilities (fixed in v4.0.10+, v2.0.0+)
**Current version:** v15.0.12 (well beyond patched versions)

**Internalization Feasibility:** ❌ **NOT RECOMMENDED**
- CommonMark spec compliance is complex
- GitHub Flavored Markdown (GFM) support required
- Security: Regex-based parsing has subtle vulnerabilities

**Recommendation:** ✅ **KEEP MARKED.JS**
- Actively maintained
- Security patches applied quickly
- Small footprint for full GFM support
- Used with DOMPurify for safe HTML rendering

**Sources:**
- [Marked security advisories](https://security.snyk.io/package/npm/marked)
- [Marked XSS vulnerability fixes](https://snyk.io/blog/marked-xss-vulnerability/)
- [Marked CVE details](https://www.cvedetails.com/vulnerability-list/vendor_id-15209/product_id-30972/Marked-Project-Marked.html)

---

### 8. 🟢 `DOMPurify` (bundled copy, 23KB) - **ALREADY COVERED**

See analysis under runtime dependencies (#4). The bundled copy in media/ is copied from node_modules during build (scripts/copy-deps.js:34).

---

## Development Dependencies Analysis

### Test Framework (KEEP ALL)
- ✅ **mocha** (v10.8.2) - Industry standard, well-maintained
- ✅ **chai** (v4.5.0) - Assertion library, pairs with Mocha
- ✅ **sinon** (v17.0.1) - Test mocking, actively maintained
- ✅ **c8** (v9.1.0) - Code coverage tool

### TypeScript (KEEP ALL)
- ✅ **typescript** (v5.6.3) - Core compiler
- ✅ **@types/*** packages - Type definitions (8 packages)

### VS Code Extension Testing (KEEP ALL)
- ✅ **@vscode/test-cli** (v0.0.9)
- ✅ **@vscode/test-electron** (v2.5.2)

### Native Module Building (REVIEW)
- ⚠️ **better-sqlite3** (v12.5.0) - Used only in tests, good performance
- ⚠️ **@electron/rebuild** (v4.0.2) - May not be needed if better-sqlite3 is the only native module
- ⚠️ **node-gyp** (v12.1.0) - Build tool for native modules

**Recommendation:** Keep if tests require better-sqlite3 for performance. These don't affect production bundle.

### Utilities
- ✅ **glob** (v10.5.0) - File pattern matching, widely used

---

## Summary of Recommendations

### 🔴 IMMEDIATE ACTIONS (Remove/Fix)

1. **Remove `uuid`**
   ```bash
   npm uninstall uuid @types/uuid
   # Remove import from src/beadsAdapter.ts:6
   ```

2. **Move `@types/sql.js` to devDependencies**
   ```bash
   # In package.json:
   # - Remove "@types/sql.js": "^1.4.9" from dependencies
   # - Add "@types/sql.js": "^1.4.9" to devDependencies
   npm install --save-dev @types/sql.js
   npm uninstall @types/sql.js
   ```

### 🔄 RECOMMENDED MIGRATIONS (High Value, Low Risk)

3. **Replace Sortable.js with Pragmatic Drag and Drop**
   ```bash
   npm install @atlaskit/pragmatic-drag-and-drop
   # Refactor media/board.js to use Pragmatic D&D adapters
   # Remove media/Sortable.min.js
   ```
   **Benefits:** 90% bundle size reduction (44KB → 4.7KB), better maintenance, enterprise support

### 🟡 FUTURE CONSIDERATIONS (Document as Technical Debt)

4. **sql.js** - Consider migration to `@sqlite.org/sqlite-wasm` in future major version
   - Official SQLite project implementation
   - Better long-term support
   - Migration effort: Medium (API changes required)

### 🟢 KEEP AS-IS (Well-Maintained, Security-Critical, or Complex to Replace)

5. **Zod** - Security-critical input validation, zero dependencies
6. **DOMPurify** - Security-critical HTML sanitization
7. **marked.js** - Actively maintained markdown parser
8. **All devDependencies** - Standard tooling, not in production bundle

---

## Security Posture

**Overall:** ✅ **GOOD**
- No high-severity vulnerabilities detected
- Only 1 unused dependency (uuid)
- Security-critical libraries (Zod, DOMPurify) are actively maintained with zero dependencies
- Historical vulnerabilities in marked.js have been patched

**Supply Chain Risk:** 🟢 **LOW**
- Total runtime dependencies: 4 (after removing uuid)
- Zod has zero dependencies
- DOMPurify has minimal dependencies
- sql.js is isolated to one adapter

---

## Estimated Impact of Changes

| Action | Bundle Size Reduction | Risk Reduction | Effort |
|--------|---------------------|----------------|--------|
| Remove uuid | ~18KB | Medium (unused code) | 5 minutes |
| Move @types/sql.js | 0 (compile-time only) | None | 2 minutes |
| **Replace Sortable.js → Pragmatic D&D** ⭐ | **~39.3KB** | Low | **4-8 hours** |
| Replace sql.js → @sqlite.org/sqlite-wasm | 0 (similar size) | Low | 8-16 hours |
| Internalize Sortable.js (not recommended) | -44KB | Low | 40-80 hours |
| Internalize Zod (not recommended) | -58KB | **HIGH** | 100+ hours |

---

## Dependency Tree Summary

### Runtime Dependencies (After Cleanup)
```
beads-kanban
├── @types/sql.js (MOVE TO DEV) ← Type definitions only
├── dompurify@3.3.1 (23KB) ← Security-critical
├── sql.js@1.13.0 (~1.7MB) ← Consider migration path
├── uuid@10.0.0 (REMOVE) ← Unused
└── zod@4.3.4 (~58KB) ← Security-critical, zero deps

Webview (media/)
├── Sortable.min.js (v1.15.2, 44KB) ← 🔄 REPLACE with Pragmatic D&D (4.7KB)
├── marked.min.js (v15.0.12, 40KB) ← Actively maintained
└── purify.min.js (from dompurify, 23KB) ← Security-critical
```

### Development Dependencies (Keep All)
```
Testing: mocha, chai, sinon, c8, @vscode/test-*
TypeScript: typescript, @types/*
Native Modules: better-sqlite3, @electron/rebuild, node-gyp
Utilities: glob
```

---

## Conclusion

The project has a **healthy dependency profile** with one critical issue (unused uuid package) and one high-value optimization opportunity (Sortable.js replacement). The security-critical libraries (Zod, DOMPurify, marked.js) are actively maintained and well-supported.

**Key Findings:**
- ✅ No high-severity security vulnerabilities
- ⚠️ One unused dependency (uuid) - remove immediately
- ⭐ **High-value optimization:** Replace Sortable.js with Pragmatic D&D for 90% bundle reduction
- 🟡 Sortable.js maintenance is acceptable but not optimal
- ✅ All security-critical libraries are well-maintained

**Recommended Priority:**
1. **High Priority:** Remove uuid, move @types/sql.js (7 minutes total)
2. **Medium Priority:** Migrate Sortable.js → Pragmatic D&D (4-8 hours, 39KB savings)
3. **Low Priority:** Document sql.js migration path for future major version

**Next Steps:**
1. ✅ Remove uuid package (5 minutes)
2. ✅ Move @types/sql.js to devDependencies (2 minutes)
3. ⭐ **Migrate Sortable.js to Pragmatic Drag and Drop** (4-8 hours, high ROI)
4. 📋 Document sql.js migration path for future consideration
5. 🔔 Set up dependabot or similar for security monitoring

---

## References

### Security & Vulnerabilities
- [Marked.js security advisories - Snyk](https://security.snyk.io/package/npm/marked)
- [Marked XSS vulnerability fixes](https://snyk.io/blog/marked-xss-vulnerability/)
- [Marked CVE database](https://www.cvedetails.com/vulnerability-list/vendor_id-15209/product_id-30972/Marked-Project-Marked.html)
- [SortableJS vulnerabilities - Snyk](https://security.snyk.io/package/npm/sortablejs)

### Maintenance Status
- [SortableJS package health](https://snyk.io/advisor/npm-package/sortablejs)
- [SortableJS npm page](https://www.npmjs.com/package/sortablejs)
- [SortableJS GitHub](https://sortablejs.github.io/Sortable/)

### SQLite WebAssembly Alternatives
- [Chrome: From Web SQL to SQLite WASM](https://developer.chrome.com/blog/from-web-sql-to-sqlite-wasm)
- [SQLite WASM with OPFS](https://developer.chrome.com/blog/sqlite-wasm-in-the-browser-backed-by-the-origin-private-file-system)
- [Official SQLite WASM docs](https://sqlite.org/wasm/doc/tip/about.md)
- [SQLite WASM API reference](https://sqlite.org/wasm)

### TypeScript Validation Libraries
- [TypeBox vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/typebox-vs-zod/)
- [Joi vs Zod comparison](https://betterstack.com/community/guides/scaling-nodejs/joi-vs-zod/)
- [Valibot introduction](https://www.builder.io/blog/introducing-valibot)
- [Valibot vs Zod - DEV Community](https://dev.to/sheraz4194/zod-vs-valibot-which-validation-library-is-right-for-your-typescript-project-303d)
- [ArkType vs Zod comparison](https://medium.com/@ruverd/why-use-arktype-instead-of-zod-08c401fd4f6f)

### Node.js SQLite Libraries
- [better-sqlite3 vs sequelize comparison](https://npm-compare.com/better-sqlite3,sequelize,sqlite,sqlite3)
- [better-sqlite3 GitHub](https://github.com/WiseLibs/better-sqlite3)
- [Understanding better-sqlite3](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8)

### Drag and Drop Libraries
- [Pragmatic Drag and Drop - GitHub](https://github.com/atlassian/pragmatic-drag-and-drop)
- [Pragmatic Drag and Drop - Documentation](https://atlassian.design/components/pragmatic-drag-and-drop/)
- [Pragmatic Drag and Drop - Core Package](https://atlassian.design/components/pragmatic-drag-and-drop/core-package/)
- [Pragmatic Drag and Drop - Implementation Guide](https://blog.logrocket.com/implement-pragmatic-drag-drop-library-guide/)
- [Top 5 Drag-and-Drop Libraries for React 2026](https://puckeditor.com/blog/top-5-drag-and-drop-libraries-for-react)
- [Best Drag and Drop JavaScript Libraries 2026](https://www.cssscript.com/best-drag-drop-javascript-libraries/)
- [Front-End Drag-and-Drop Libraries 2025](https://en.kelen.cc/share/frontend-drag-and-drop-libraries-2025/)
- [Dragula GitHub](https://github.com/bevacqua/dragula)
- [Dragula Bundle Analysis](https://bundlephobia.com/package/dragula)
- [DFlex Website](https://www.dflex.dev/)
- [DFlex GitHub](https://github.com/dflex-js/dflex)
- [Shopify Draggable GitHub](https://github.com/Shopify/draggable)
- [Shopify Draggable Bundle Analysis](https://bundlephobia.com/package/@shopify/draggable)

---

**Document Version:** 1.1
**Last Updated:** 2026-01-16
**Next Review:** 2026-04-16 (Quarterly)

**Changelog:**
- v1.1 (2026-01-16): Added comprehensive Sortable.js replacement analysis with Pragmatic Drag and Drop recommendation
- v1.0 (2026-01-16): Initial dependency review

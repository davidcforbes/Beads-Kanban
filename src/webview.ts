import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  // Use package version for cache-busting (production-friendly, changes only on updates)
  const version = "2.0.2";
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "out", "webview", "board.js")) + `?v=${version}`;
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css")) + `?v=${version}`;
  const dompurifyUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "purify.min.js")) + `?v=${version}`;
  const markedUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "marked.min.js")) + `?v=${version}`;

  // Generate cryptographically secure nonce
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Detect platform for keyboard shortcut display
  const isMac = process.platform === 'darwin';
  const modKey = isMac ? '⌘' : 'Ctrl';

  return `<!DOCTYPE html>
<!-- Forced No-Quirks Mode -->
<html lang="en">
<head>
  <meta charset="UTF-8">
  <!--
    CSP Policy:
    - No inline style attributes are used in the HTML
    - JavaScript style manipulations via .style property are not affected by style-src-attr
    - All user content is sanitized via DOMPurify preventing XSS
    - Nonce-based script loading prevents unauthorized script execution
  -->
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 img-src ${webview.cspSource} data:;
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 connect-src ${webview.cspSource};
                 base-uri 'none';
                 frame-ancestors 'none';
                 form-action 'none';
                 object-src 'none';
                 media-src 'none';
                 font-src 'none';
                 worker-src 'none';
                 manifest-src 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Agent Native Abstraction Layer for Beads</title>
</head>
<body>
  <header class="topbar">
    <div class="title">
      <span class="title-text">Agent Native Abstraction Layer for Beads</span>
      <button id="repoMenuBtn" class="repo-menu-btn" title="Select Repository">⋯</button>
    </div>
    <div class="actions">
      <div class="view-toggle">
        <button id="viewKanbanBtn" class="view-toggle-btn active">Kanban</button>
        <button id="viewTableBtn" class="view-toggle-btn">Table</button>
      </div>
      <div class="filters">
        <input id="filterSearch" type="text" placeholder="Search... (${modKey}+F)" title="Focus search (${modKey}+F)" class="search-input" />
        <select id="filterPriority" class="select">
           <option value="">Priority: All</option>
           <option value="0">P0</option>
           <option value="1">P1</option>
           <option value="2">P2</option>
           <option value="3">P3</option>
        </select>
        <select id="filterType" class="select">
           <option value="">Type: All</option>
           <option value="task">Task</option>
           <option value="bug">Bug</option>
           <option value="feature">Feature</option>
           <option value="epic">Epic</option>
           <option value="chore">Chore</option>
        </select>
        <div class="status-filter-wrapper">
          <button id="filterStatusBtn" class="select status-filter-btn" type="button" title="Filter by status">
            <span id="filterStatusLabel">Status: All</span>
            <span class="dropdown-arrow">▼</span>
          </button>
          <div id="filterStatusDropdown" class="status-dropdown hidden">
            <label class="status-option"><input type="checkbox" value="" checked /> All</label>
            <label class="status-option"><input type="checkbox" value="open" /> Open</label>
            <label class="status-option"><input type="checkbox" value="in_progress" /> In Progress</label>
            <label class="status-option"><input type="checkbox" value="blocked" /> Blocked</label>
            <label class="status-option"><input type="checkbox" value="deferred" /> Deferred</label>
            <label class="status-option"><input type="checkbox" value="closed" /> Closed</label>
            <label class="status-option"><input type="checkbox" value="tombstone" /> Tombstone</label>
            <label class="status-option"><input type="checkbox" value="pinned" /> Pinned</label>
          </div>
        </div>
        <button id="clearFiltersBtn" class="btn" title="Clear all filters">Clear Filters</button>
      </div>
      <button id="refreshBtn" class="btn" title="Refresh board (${modKey}+R)">Refresh</button>
      <button id="newBtn" class="btn primary" title="Create new issue (${modKey}+N)">New</button>
    </div>
  </header>

  <main>
    <div id="board" class="board"></div>
  </main>

  <dialog id="detailDialog" class="dialog">
    <form method="dialog" class="dialogForm">
      <h3 id="detTitle" class="detTitle"></h3>
      <div id="detMeta" class="badges detMeta">
        <!-- Populated via JS -->
      </div>
      <hr class="detHr">
      <div id="detDesc" class="detDesc"></div>
      <div class="dialogActions detActions">
        <div class="actionButtons">
            <button id="addToChatBtn" class="btn">Add to Chat</button>
            <button id="copyContextBtn" class="btn">Copy Context</button>
        </div>
        <button value="close" class="btn">Close</button>
      </div>
    </form>
  </dialog>

  <div id="toast" class="toast hidden"></div>

  <div id="loadingOverlay" class="loading-overlay hidden">
    <div class="loading-spinner"></div>
    <div id="loadingText" class="loading-text">Loading...</div>
  </div>

  <script nonce="${nonce}" src="${dompurifyUri}"></script>
  <script nonce="${nonce}" src="${markedUri}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const sortableUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "Sortable.min.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css"));
  const dompurifyUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "purify.min.js"));

  // Generate cryptographically secure nonce
  const nonce = crypto.randomBytes(16).toString('hex');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 img-src ${webview.cspSource};
                 style-src ${webview.cspSource};
                 style-src-attr 'unsafe-inline';
                 script-src 'nonce-${nonce}';
                 connect-src ${webview.cspSource};
                 base-uri 'none';
                 frame-ancestors 'none';
                 form-action 'none';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Agent Native Abstraction Layer for Beads</title>
</head>
<body>
  <header class="topbar">
    <div class="title">Agent Native Abstraction Layer for Beads</div>
    <div class="actions">
      <div class="filters">
        <input id="filterSearch" type="text" placeholder="Search..." class="search-input" />
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
      </div>
      <button id="refreshBtn" class="btn">Refresh</button>
      <button id="newBtn" class="btn primary">New</button>
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
  </div>

  <script nonce="${nonce}" src="${dompurifyUri}"></script>
  <script nonce="${nonce}" src="${sortableUri}"></script>
  <script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "marked.min.js"))}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

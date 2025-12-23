import * as vscode from "vscode";
import * as path from "path";

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "main.js"));
  const sortableUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "Sortable.min.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "styles.css"));

  const nonce = String(Date.now());

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 img-src ${webview.cspSource} https:;
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Agent Native Abstraction Layer for Beads</title>
</head>
<body>
  <header class="topbar">
    <div class="title">Agent Native Abstraction Layer for Beads</div>
    <div class="actions">
      <div class="filters" style="display:flex; gap:8px; margin-right: 12px;">
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
           <option value="bug">Bug</option>
           <option value="task">Task</option>
           <option value="feature">Feature</option>
        </select>
      </div>
      <button id="refreshBtn" class="btn">Refresh</button>
      <button id="newBtn" class="btn primary">New</button>
    </div>
  </header>

  <main>
    <div id="board" class="board"></div>
  </main>

  <dialog id="newDialog" class="dialog">
    <form method="dialog" class="dialogForm">
      <h3>Create issue</h3>
      <label>Title</label>
      <input id="newTitle" type="text" maxlength="500" />
      <label>Description</label>
      <textarea id="newDesc" rows="4"></textarea>
      <div class="dialogActions">
        <button value="cancel" class="btn">Cancel</button>
        <button id="createConfirm" value="default" class="btn primary">Create</button>
      </div>
    </form>
  </dialog>

  <dialog id="detailDialog" class="dialog">
    <form method="dialog" class="dialogForm">
      <h3 id="detTitle" style="margin-top:0"></h3>
      <div id="detMeta" class="badges" style="margin-bottom: 12px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
        <!-- Populated via JS -->
      </div>
      <hr style="border: 0; border-top: 1px solid var(--border); margin: 12px 0;">
      <div id="detDesc" style="white-space: pre-wrap; font-family: inherit; opacity: 0.9;"></div>
      <div class="dialogActions" style="margin-top: 16px;">
        <div style="margin-right: auto; display: flex; gap: 8px;">
            <button id="addToChatBtn" class="btn">Add to Chat</button>
            <button id="copyContextBtn" class="btn">Copy Context</button>
        </div>
        <button value="close" class="btn">Close</button>
      </div>
    </form>
  </dialog>

  <div id="toast" class="toast hidden"></div>

  <script nonce="${nonce}" src="${sortableUri}"></script>
  <script nonce="${nonce}" src="${webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "marked.min.js"))}"></script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

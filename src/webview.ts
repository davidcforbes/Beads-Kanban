import * as vscode from "vscode";
import * as crypto from "crypto";

export function getWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  // Use package version for cache-busting (production-friendly, changes only on updates)
  const version = "2.0.6";
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
        <div class="status-filter-wrapper">
          <button id="filterPriorityBtn" class="select status-filter-btn" type="button" title="Filter by priority">
            <span id="filterPriorityLabel">Priority: All</span>
            <span class="dropdown-arrow">▼</span>
          </button>
          <div id="filterPriorityDropdown" class="status-dropdown hidden">
            <label class="status-option"><input type="checkbox" value="" checked /> All</label>
            <label class="status-option"><input type="checkbox" value="0" /> P0</label>
            <label class="status-option"><input type="checkbox" value="1" /> P1</label>
            <label class="status-option"><input type="checkbox" value="2" /> P2</label>
            <label class="status-option"><input type="checkbox" value="3" /> P3</label>
          </div>
        </div>
        <div class="status-filter-wrapper">
          <button id="filterTypeBtn" class="select status-filter-btn" type="button" title="Filter by type">
            <span id="filterTypeLabel">Type: All</span>
            <span class="dropdown-arrow">▼</span>
          </button>
          <div id="filterTypeDropdown" class="status-dropdown hidden">
            <label class="status-option"><input type="checkbox" value="" checked /> All</label>
            <label class="status-option"><input type="checkbox" value="task" /> Task</label>
            <label class="status-option"><input type="checkbox" value="bug" /> Bug</label>
            <label class="status-option"><input type="checkbox" value="feature" /> Feature</label>
            <label class="status-option"><input type="checkbox" value="epic" /> Epic</label>
            <label class="status-option"><input type="checkbox" value="chore" /> Chore</label>
          </div>
        </div>
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

  <!-- Static Edit Issue Dialog - populated dynamically via JS -->
  <dialog id="detailDialog" class="dialog">
    <form method="dialog" class="dialogForm">
      <div class="edit-form-container">
        <!-- Header -->
        <h3 id="editFormHeader" class="form-section-header">Edit Issue</h3>
        
        <!-- Row 1: Title -->
        <div class="form-row">
          <label class="form-label" for="editTitle">Title:</label>
          <input id="editTitle" type="text" class="form-input-title" placeholder="Issue title" />
        </div>

        <!-- Row 2: Status, Type, Priority, Assignee -->
        <div class="form-row-multi">
          <div class="form-group">
            <label class="form-label" for="editStatus">Status:</label>
            <select id="editStatus" class="form-input-inline">
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="blocked">Blocked</option>
              <option value="deferred">Deferred</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="editType">Type:</label>
            <select id="editType" class="form-input-inline">
              <option value="task">task</option>
              <option value="bug">bug</option>
              <option value="feature">feature</option>
              <option value="epic">epic</option>
              <option value="chore">chore</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="editPriority">Priority:</label>
            <select id="editPriority" class="form-input-inline">
              <option value="0">P0</option>
              <option value="1">P1</option>
              <option value="2">P2</option>
              <option value="3">P3</option>
              <option value="4">P4</option>
            </select>
          </div>
          <div class="form-group-large">
            <label class="form-label" for="editAssignee">Assignee:</label>
            <input id="editAssignee" type="text" placeholder="Unassigned" class="form-input-inline" />
          </div>
        </div>

        <!-- Row 3: Est. Minutes, Due At, Defer Until -->
        <div class="form-row-multi">
          <div class="form-group">
            <label class="form-label" for="editEst">Est. Minutes:</label>
            <input id="editEst" type="number" placeholder="Min" class="form-input-inline" />
          </div>
          <div class="form-group">
            <label class="form-label" for="editDueAt">Due At:</label>
            <input id="editDueAt" type="datetime-local" class="form-input-inline" />
          </div>
          <div class="form-group">
            <label class="form-label" for="editDeferUntil">Defer Until:</label>
            <input id="editDeferUntil" type="datetime-local" class="form-input-inline" />
          </div>
        </div>

        <!-- Row 4: Tags -->
        <div class="form-section">
          <label class="form-label-small">Tags</label>
          <div id="labelsContainer" class="labels-container"></div>
          <div class="inline-add-row">
            <input id="newLabel" type="text" placeholder="Add tag..." class="inline-input" />
            <button type="button" id="btnAddLabel" class="btn btn-small">+</button>
          </div>
        </div>

        <!-- Row 5: Flags -->
        <div class="form-section">
          <label class="form-label-small">Flags</label>
          <div class="flags-row">
            <label class="flag-label">
              <input type="checkbox" id="editPinned" />
              📌 Pinned
            </label>
            <label class="flag-label">
              <input type="checkbox" id="editTemplate" />
              📄 Template
            </label>
            <label class="flag-label">
              <input type="checkbox" id="editEphemeral" />
              ⏱ Ephemeral
            </label>
          </div>
        </div>

        <!-- Row 6: Ext Ref -->
        <div class="form-row-wide-label">
          <label class="form-label" for="editExtRef">Ext Ref:</label>
          <input id="editExtRef" type="text" placeholder="JIRA-123" class="form-input-full" />
        </div>

        <hr class="form-hr">

        <!-- Markdown Fields -->
        <div class="markdown-fields-container">
          <!-- Description -->
          <div class="markdown-field-wrapper">
            <div class="markdown-field-header">
              <label class="form-label-small" for="editDesc">Description</label>
              <button type="button" class="btn btn-small toggle-preview" data-target="editDesc">Preview</button>
            </div>
            <textarea id="editDesc" class="markdown-field-editor" rows="4"></textarea>
            <div id="editDesc-preview" class="markdown-body markdown-field-preview hidden"></div>
          </div>
          
          <!-- Acceptance Criteria -->
          <div class="markdown-field-wrapper">
            <div class="markdown-field-header">
              <label class="form-label-small" for="editAC">Acceptance Criteria</label>
              <button type="button" class="btn btn-small toggle-preview" data-target="editAC">Preview</button>
            </div>
            <textarea id="editAC" class="markdown-field-editor" rows="3"></textarea>
            <div id="editAC-preview" class="markdown-body markdown-field-preview hidden"></div>
          </div>
          
          <!-- Design Notes -->
          <div class="markdown-field-wrapper">
            <div class="markdown-field-header">
              <label class="form-label-small" for="editDesign">Design Notes</label>
              <button type="button" class="btn btn-small toggle-preview" data-target="editDesign">Preview</button>
            </div>
            <textarea id="editDesign" class="markdown-field-editor" rows="3"></textarea>
            <div id="editDesign-preview" class="markdown-body markdown-field-preview hidden"></div>
          </div>
          
          <!-- Notes -->
          <div class="markdown-field-wrapper">
            <div class="markdown-field-header">
              <label class="form-label-small" for="editNotes">Notes</label>
              <button type="button" class="btn btn-small toggle-preview" data-target="editNotes">Preview</button>
            </div>
            <textarea id="editNotes" class="markdown-field-editor" rows="3"></textarea>
            <div id="editNotes-preview" class="markdown-body markdown-field-preview hidden"></div>
          </div>
        </div>

        <!-- Relationships Section -->
        <div class="form-section-bordered">
          <label class="form-label-small section-label">Structure</label>
          
          <!-- Parent -->
          <div class="relationship-group">
            <span class="relationship-label">Parent:</span>
            <span id="parentDisplay" class="relationship-value">None</span>
            <span id="removeParent" class="remove-link hidden">(Unlink)</span>
          </div>
          <div id="parentAddRow" class="inline-add-row">
            <input id="newParentId" type="text" placeholder="Parent Issue ID" list="issueIdOptions" class="inline-input" />
            <button type="button" id="btnSetParent" class="btn btn-small">Set</button>
          </div>

          <!-- Blocked By -->
          <div class="relationship-group">
            <span class="relationship-label">Blocked By:</span>
          </div>
          <ul id="blockedByList" class="relationship-list"></ul>
          <div class="inline-add-row">
            <input id="newBlockerId" type="text" placeholder="Blocker Issue ID" list="issueIdOptions" class="inline-input" />
            <button type="button" id="btnAddBlocker" class="btn btn-small">Add</button>
          </div>

          <!-- Blocks -->
          <div class="relationship-group">
            <span class="relationship-label">Blocks:</span>
          </div>
          <ul id="blocksList" class="relationship-list"></ul>

          <!-- Children -->
          <div class="relationship-group">
            <span class="relationship-label">Children:</span>
          </div>
          <ul id="childrenList" class="relationship-list"></ul>
          <div class="inline-add-row">
            <input id="newChildId" type="text" placeholder="Child Issue ID" list="issueIdOptions" class="inline-input" />
            <button type="button" id="btnAddChild" class="btn btn-small">Add</button>
          </div>
        </div>

        <!-- Issue ID datalist for autocomplete -->
        <datalist id="issueIdOptions"></datalist>

        <!-- Advanced Metadata (Event/Agent) - hidden by default -->
        <details id="advancedMetadata" class="form-section-bordered hidden">
          <summary class="form-label-small section-label clickable">Advanced Metadata (Event/Agent)</summary>
          <div id="advancedMetadataContent" class="metadata-grid"></div>
        </details>

        <!-- Comments Section -->
        <div class="form-section-bordered">
          <label class="form-label-small section-label">Comments</label>
          <div id="commentsList" class="comments-list"></div>
          <div class="comment-add-row">
            <textarea id="newCommentText" rows="2" placeholder="Write a comment..." class="comment-input"></textarea>
            <button type="button" id="btnPostComment" class="btn">Post</button>
          </div>
          <div id="createModeCommentNote" class="muted-note hidden">Comments will be added after issue creation.</div>
        </div>

        <!-- Action Buttons -->
        <div class="dialogActions form-actions">
          <div class="actions-left">
            <button type="button" id="btnSave" class="btn primary">Save Changes</button>
            <button type="button" id="btnClose" class="btn">Close</button>
          </div>
          <div class="actions-right">
            <button type="button" id="btnChat" class="btn icon-btn" title="Add to Chat">💬 Chat</button>
            <button type="button" id="btnCopy" class="btn icon-btn" title="Copy Context">📋 Copy</button>
          </div>
        </div>

        <!-- Footer Metadata -->
        <div id="editFormFooter" class="form-footer"></div>
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

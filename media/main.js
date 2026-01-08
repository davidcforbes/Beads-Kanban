// Webview side
const vscode = acquireVsCodeApi();

const boardEl = document.getElementById("board");
const refreshBtn = document.getElementById("refreshBtn");
const newBtn = document.getElementById("newBtn");
const toastEl = document.getElementById("toast");

const detDialog = document.getElementById("detailDialog");
const detTitle = document.getElementById("detTitle");
const detDesc = document.getElementById("detDesc");
const detMeta = document.getElementById("detMeta");
const addToChatBtn = document.getElementById("addToChatBtn");
const copyContextBtn = document.getElementById("copyContextBtn");

const filterPriority = document.getElementById("filterPriority");
const filterType = document.getElementById("filterType");
const filterSearch = document.getElementById("filterSearch");

const viewKanbanBtn = document.getElementById("viewKanbanBtn");
const viewTableBtn = document.getElementById("viewTableBtn");

// Column-based state for incremental loading
let columns = [];
let columnState = {
  ready: { cards: [], offset: 0, totalCount: 0, hasMore: false, loading: false },
  in_progress: { cards: [], offset: 0, totalCount: 0, hasMore: false, loading: false },
  blocked: { cards: [], offset: 0, totalCount: 0, hasMore: false, loading: false },
  closed: { cards: [], offset: 0, totalCount: 0, hasMore: false, loading: false }
};

// Legacy boardData for backward compatibility
let boardData = null;
let detailDirty = false;

// Table view pagination state
let tableState_paginationPage = 0;
const tableState_rowsPerPage = 100; // Render 100 rows at a time

// Debounce utility for performance optimization
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function requestDetailClose() {
    if (!detailDirty) {
        detDialog.close();
        return;
    }
    const shouldClose = confirm("Discard unsaved changes?");
    if (shouldClose) {
        detailDirty = false;
        detDialog.close();
    }
}

detDialog.addEventListener("cancel", (event) => {
    if (!detailDirty) {
        return;
    }
    event.preventDefault();
    requestDetailClose();
});
// Restore state from VS Code persisted state
const vscodeState = vscode.getState() || {};
const collapsedColumns = new Set(vscodeState.collapsedColumns || []);

// View mode: 'kanban' (default) or 'table'
let viewMode = vscodeState.viewMode || 'kanban';

// Table-specific state
let tableState = {
  sorting: vscodeState.tableSorting || [], // Array of {id, dir: 'asc'|'desc'}
  columnVisibility: vscodeState.tableColumnVisibility || {},
  columnOrder: vscodeState.tableColumnOrder || [],
  filters: vscodeState.tableFilters || {} // Additional table filters (status, assignee, labels)
};

// Table column definitions
const tableColumns = [
  {
    id: 'type',
    label: 'Type',
    visible: true,
    width: 80,
    getValue: c => c.issue_type || 'task',
    render: (c) => {
      const type = c.issue_type || 'task';
      return `<span class="badge badge-type-${type}">${escapeHtml(type)}</span>`;
    },
    sort: (a, b) => {
      const order = ['epic', 'feature', 'bug', 'task', 'chore'];
      const aType = a.issue_type || 'task';
      const bType = b.issue_type || 'task';
      return order.indexOf(aType) - order.indexOf(bType);
    }
  },
  {
    id: 'id',
    label: 'ID',
    visible: true,
    width: 100,
    getValue: c => c.id,
    render: (c) => `<span class="table-id copy-id" data-full-id="${escapeHtml(c.id)}" title="Click to copy: ${escapeHtml(c.id)}">${escapeHtml(c.id.slice(-8))}</span>`,
    sort: (a, b) => a.id.localeCompare(b.id)
  },
  {
    id: 'title',
    label: 'Title',
    visible: true,
    width: 300,
    getValue: c => c.title,
    render: (c) => `<span class="table-title">${escapeHtml(c.title)}</span>`,
    sort: (a, b) => (a.title || '').localeCompare(b.title || '')
  },
  {
    id: 'status',
    label: 'Status',
    visible: true,
    width: 100,
    getValue: c => c.status,
    render: (c) => `<span class="badge">${escapeHtml(c.status || 'open')}</span>`,
    sort: (a, b) => {
      const order = ['open', 'in_progress', 'blocked', 'closed'];
      return order.indexOf(a.status || 'open') - order.indexOf(b.status || 'open');
    }
  },
  {
    id: 'priority',
    label: 'Priority',
    visible: true,
    width: 80,
    getValue: c => c.priority,
    render: (c) => `<span class="badge badge-priority-${c.priority}">P${c.priority}</span>`,
    sort: (a, b) => (a.priority || 2) - (b.priority || 2)
  },
  {
    id: 'assignee',
    label: 'Assignee',
    visible: true,
    width: 120,
    getValue: c => c.assignee || 'Unassigned',
    render: (c) => {
      if (c.assignee) {
        return `<span class="badge badge-assignee">${escapeHtml(c.assignee)}</span>`;
      }
      return `<span class="badge badge-assignee badge-unassigned">Unassigned</span>`;
    },
    sort: (a, b) => (a.assignee || 'zzz').localeCompare(b.assignee || 'zzz')
  },
  {
    id: 'labels',
    label: 'Labels',
    visible: true,
    width: 150,
    getValue: c => (c.labels || []).join(', '),
    render: (c) => {
      if (!c.labels || c.labels.length === 0) return '';
      const labelBadges = c.labels.slice(0, 3).map(l => 
        `<span class="badge">#${escapeHtml(l)}</span>`
      ).join(' ');
      const more = c.labels.length > 3 ? ` <span class="badge">+${c.labels.length - 3}</span>` : '';
      return labelBadges + more;
    },
    sort: (a, b) => ((a.labels || []).join(',')).localeCompare((b.labels || []).join(','))
  },
  {
    id: 'estimate',
    label: 'Estimate',
    visible: false,
    width: 80,
    getValue: c => c.estimated_minutes || 0,
    render: (c) => {
      if (!c.estimated_minutes) return '';
      const hours = Math.floor(c.estimated_minutes / 60);
      const mins = c.estimated_minutes % 60;
      let timeStr = '';
      if (hours > 0) timeStr += `${hours}h`;
      if (mins > 0) timeStr += `${mins}m`;
      return `<span class="badge badge-estimate">⏱ ${timeStr}</span>`;
    },
    sort: (a, b) => (a.estimated_minutes || 0) - (b.estimated_minutes || 0)
  },
  {
    id: 'updated_at',
    label: 'Updated',
    visible: true,
    width: 120,
    getValue: c => c.updated_at,
    render: (c) => {
      if (!c.updated_at) return '';
      const date = new Date(c.updated_at);
      return `<span class="table-date">${date.toLocaleDateString()}</span>`;
    },
    sort: (a, b) => {
      const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bTime - aTime; // Most recent first
    }
  },
  {
    id: 'due_at',
    label: 'Due Date',
    visible: false,
    width: 120,
    getValue: c => c.due_at,
    render: (c) => {
      if (!c.due_at) return '';
      const dueDate = new Date(c.due_at);
      const now = new Date();
      const isOverdue = dueDate < now;
      return `<span class="badge ${isOverdue ? 'badge-overdue' : 'badge-due'}">📅 ${dueDate.toLocaleDateString()}</span>`;
    },
    sort: (a, b) => {
      const aTime = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bTime = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return aTime - bTime;
    }
  }
];

// Helper to persist all UI state
function saveState() {
    vscode.setState({
        ...vscode.getState(),
        collapsedColumns: [...collapsedColumns],
        viewMode: viewMode,
        tableSorting: tableState.sorting,
        tableColumnVisibility: tableState.columnVisibility,
        tableColumnOrder: tableState.columnOrder,
        tableFilters: tableState.filters
    });
}

// Legacy function name for backward compatibility
function saveCollapsedColumnsState() {
    saveState();
}
let activeRequests = 0;

// Loading indicator helpers
function showLoading() {
    activeRequests++;
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.classList.remove('hidden');
    }
}

function hideLoading() {
    activeRequests = Math.max(0, activeRequests - 1);
    console.log('[Webview] hideLoading() called, activeRequests:', activeRequests);
    if (activeRequests === 0) {
        const loader = document.getElementById('loadingOverlay');
        console.log('[Webview] hideLoading() - hiding loader, element:', loader);
        if (loader) {
            loader.classList.add('hidden');
            console.log('[Webview] hideLoading() - loader.classList:', loader.classList.toString());
        } else {
            console.error('[Webview] hideLoading() - loadingOverlay element not found!');
        }
    }
}

// Configure DOMPurify for safe HTML sanitization
const purifyConfig = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false,
    // Prevent XSS via javascript: URIs - only allow safe protocols
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
};

// HTML escape function to prevent XSS in dynamic content
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Configure marked to use GFM breaks
if (typeof marked !== 'undefined') {
    marked.use({
        breaks: true,
        gfm: true
    });
}

// Request/response tracking for async operations
const pendingRequests = new Map();

// Cleanup pending requests to prevent memory leaks
function cleanupPendingRequests() {
    for (const [reqId, { reject }] of pendingRequests.entries()) {
        reject(new Error('Request cancelled: webview hidden or disposed'));
    }
    pendingRequests.clear();
}

// Cleanup pending requests when webview becomes hidden or is disposed
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        cleanupPendingRequests();
    }
});

// Also cleanup on page unload
window.addEventListener('pagehide', cleanupPendingRequests);

function requestId() {
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Post with promise support
function postAsync(type, payload) {
    showLoading();
    const reqId = requestId();
    return new Promise((resolve, reject) => {
        // Timeout after 30 seconds
        const timeoutId = setTimeout(() => {
            if (pendingRequests.has(reqId)) {
                pendingRequests.delete(reqId);
                // Don't call hideLoading here - let finally block handle it
                reject(new Error('Request timeout'));
            }
        }, 30000);

        // Store resolve, reject, AND timeoutId in the Map
        // This allows response handlers to clear the timeout properly
        pendingRequests.set(reqId, { resolve, reject, timeoutId });
        vscode.postMessage({ type, requestId: reqId, payload });
    }).finally(() => {
        // Cleanup: Clear the timeout if the request is still pending
        // The response handlers will have already cleared it if they ran
        if (pendingRequests.has(reqId)) {
            const { timeoutId } = pendingRequests.get(reqId);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(reqId);
        }
        // Always call hideLoading exactly once per showLoading
        hideLoading();
    });
}

function post(type, payload) {
    const reqId = requestId();
    console.log('[Webview] Posting message:', type, 'requestId:', reqId, 'payload:', payload);
    vscode.postMessage({ type, requestId: reqId, payload });
}

function toLocalDateTimeInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = (num) => String(num).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIsoFromLocalInput(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
}

function toast(msg, actionName, actionCb) {
    toastEl.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = msg;
    toastEl.appendChild(span);

    if (actionName && actionCb) {
        const btn = document.createElement("button");
        btn.className = "toast-btn";
        btn.textContent = actionName;
        btn.onclick = () => {
            actionCb();
            toastEl.classList.add("hidden");
        };
        toastEl.appendChild(btn);
    }

    toastEl.classList.remove("hidden");

    // Auto-hide with hover detection
    let isHovering = false;
    const onMouseEnter = () => { isHovering = true; };
    const onMouseLeave = () => { isHovering = false; };

    toastEl.addEventListener('mouseenter', onMouseEnter);
    toastEl.addEventListener('mouseleave', onMouseLeave);

    const hideToast = () => {
        if (!isHovering) {
            toastEl.classList.add("hidden");
            toastEl.removeEventListener('mouseenter', onMouseEnter);
            toastEl.removeEventListener('mouseleave', onMouseLeave);
        } else {
            // Check again in 1 second if still hovering
            setTimeout(hideToast, 1000);
        }
    };

    setTimeout(hideToast, 5000);
}

function columnForCard(card) {
    // Deterministic mapping (matches extension-side assumptions)
    if (card.status === "closed") return "closed";
    if (card.is_ready) return "ready";
    if (card.status === "in_progress") return "in_progress";

    // If it's open but not ready, it must be because of blocking (direct or transitive).
    // So we classify it as blocked.
    if (card.status === "blocked" || (card.blocked_by_count || 0) > 0) return "blocked";

    // Fallback: If status is 'open' and not ready, and not explicitly blocked by count (transitive block),
    // we still put it in 'blocked' because 'open' column is gone.
    if (card.status === "open") return "blocked";

    return "blocked"; // Default fallback
}

// Dispatch to the appropriate render function based on view mode
function render() {
    console.log('[Webview] render() called, viewMode:', viewMode, 'columnState:', columnState);
    if (!columns || columns.length === 0) {
        console.log('[Webview] render() aborted - no columns');
        return;
    }

    // Reset table pagination when filters/sort changes (user likely wants to see results from page 1)
    tableState_paginationPage = 0;

    if (viewMode === 'table') {
        renderTable();
    } else {
        renderKanban();
    }
}

// Kanban view rendering
function renderKanban() {
    console.log('[Webview] renderKanban() - columns:', columns.length);

    // Filtering
    const pVal = filterPriority.value;
    const tVal = filterType.value;
    const sVal = filterSearch.value.toLowerCase();

    // Filter within each column's loaded cards
    const byCol = {};
    for (const col of columns) {
        const colKey = col.key;
        const colCards = columnState[colKey]?.cards || [];
        
        byCol[colKey] = colCards.filter(c => {
            if (pVal !== "" && c.priority !== parseInt(pVal)) return false;
            if (tVal !== "" && c.issue_type !== tVal) return false;
            if (sVal !== "" && !c.title.toLowerCase().includes(sVal)) return false;
            return true;
        });
    }

    console.log('[Webview] render() - filtered cards:', Object.values(byCol).flat().length);
    console.log('[Webview] render() - clearing board and rebuilding DOM');
    boardEl.innerHTML = "";
    for (const col of columns) {
        const colWrap = document.createElement("section");
        colWrap.className = "column";
        if (collapsedColumns.has(col.key)) {
            colWrap.classList.add("collapsed");
        }

        const header = document.createElement("div");
        header.className = "columnHeader";

        // Collapse toggle button
        const toggleBtn = document.createElement("button");
        toggleBtn.className = "icon-btn";
        toggleBtn.innerHTML = collapsedColumns.has(col.key)
            ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentcolor"><path d="M6 12l4-4-4-4"/></svg>` // Right arrow
            : `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentcolor"><path d="M4 6l4 4 4-4"/></svg>`; // Down arrow (or similar indicating expansion) (Actually left/right might be better for column? Let's use simple chevrons)

        // Better Ref: Expanded = Left/Inward? Collapsed = ...
        // Let's just use standard: 
        // Generic "Toggle" icon or:
        // Expanded: < (collapse)
        // Collapsed: > (expand)

        // Let's match typical VS Code or side-panel behavior.
        // When expanded, show "Collapse" (e.g. arrow pointing opposite to content flow or just standard chevron).
        // Let's use: 
        // Expanded: SVG for "Contract" (Arrows pointing in?) Or simple "Chevron Left" if it collapses left?
        // Let's stick to: Chevron Left (<) to collapse, Chevron Right (>) to expand? 
        // Or simply toggling state icon.
        if (collapsedColumns.has(col.key)) {
            // Is collapsed. Show Expand (Right or Open)
            toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
        } else {
            // Is expanded. Show Collapse (Left? or Down?)
            // Since it collapses horizontally, maybe Left < ?
            toggleBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>`;
        }

        toggleBtn.onclick = () => {
            if (collapsedColumns.has(col.key)) {
                collapsedColumns.delete(col.key);
            } else {
                collapsedColumns.add(col.key);
            }
            saveCollapsedColumnsState();
            render();
        };

        const titleDiv = document.createElement("div");
        titleDiv.className = "columnTitle";
        titleDiv.textContent = col.title;

        const countDiv = document.createElement("div");
        countDiv.className = "columnCount";
        
        // Show "loaded / total" format for incremental loading
        const colState = columnState[col.key];
        const filteredCount = (byCol[col.key] || []).length;
        
        if (colState && colState.totalCount > colState.cards.length) {
            // Partial load: show "filtered (loaded / total)"
            countDiv.textContent = `${filteredCount} (${colState.cards.length} / ${colState.totalCount})`;
        } else if (colState && colState.totalCount > 0) {
            // Fully loaded: show "filtered / total"
            countDiv.textContent = `${filteredCount} / ${colState.totalCount}`;
        } else {
            // Legacy or no data
            countDiv.textContent = filteredCount;
        }

        header.appendChild(titleDiv);
        header.appendChild(countDiv);
        header.appendChild(toggleBtn);


        const dropZone = document.createElement("div");
        dropZone.className = "dropZone";
        dropZone.dataset.col = col.key;

        // Initialize Sortable on the dropZone
        new Sortable(dropZone, {
            group: 'shared', // set both lists to same group
            animation: 150,
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            onEnd: function (evt) {
                const itemEl = evt.item;  // dragged HTMLElement
                const id = itemEl.dataset.id;
                const toColumn = evt.to.dataset.col;
                const fromColumn = evt.from.dataset.col;

                if (!id || !toColumn) return;

                // If moved to a different position or column
                if (toColumn !== fromColumn || evt.newIndex !== evt.oldIndex) {
                    post("issue.move", { id, toColumn });

                    // Simple undo toast if moved between columns (optional, kept from original logic)
                    if (fromColumn !== toColumn) {
                        // We don't implement full undo logic with Sortable easily here since state updates shortly,
                        // but we can keep the toast notification.
                        // Logic from original was:
                        // toast(`Moved to ${toColumn}`, "Undo", () => { ... });
                        // But for now let's just notify.
                    }
                }
            }
        });

        // Native drag events removed. Sortable handles it.

        for (const card of (byCol[col.key] || [])) {
            const el = document.createElement("div");
            el.className = "card";
            el.dataset.id = card.id;

            el.addEventListener("click", () => openDetail(card));

            const badges = [];
            badges.push({ text: `P${card.priority}`, cls: `badge-priority-${card.priority}` });
            if (card.issue_type) {
                badges.push({
                    text: card.issue_type,
                    cls: `badge-type-${card.issue_type}`
                });
            }
            // Assignee badge positioned right after type
            if (card.assignee) {
                badges.push({ text: `Assignee: ${card.assignee}`, cls: 'badge-assignee' });
            } else {
                badges.push({ text: 'Assignee: Unassigned', cls: 'badge-assignee badge-unassigned' });
            }
            if (card.estimated_minutes) {
                const hours = Math.floor(card.estimated_minutes / 60);
                const mins = card.estimated_minutes % 60;
                let timeStr = '';
                if (hours > 0) timeStr += `${hours}h`;
                if (mins > 0) timeStr += `${mins}m`;
                badges.push({ text: `⏱ ${timeStr}`, cls: 'badge-estimate' });
            }

            // Blocked By logic
            if (card.blocked_by && card.blocked_by.length > 0) {
                badges.push({ text: `blocked by ${card.blocked_by.length}`, cls: 'badge-blocked' });
            } else if ((card.blocked_by_count || 0) > 0) {
                badges.push({ text: `blocked:${card.blocked_by_count}`, cls: 'badge-blocked' });
            }

            if (card.external_ref) badges.push({ text: card.external_ref });
            for (const l of (card.labels || []).slice(0, 4)) badges.push({ text: `#${l}` });

            // Flag badges
            if (card.pinned) badges.push({ text: '📌 Pinned', cls: 'badge-flag' });
            if (card.is_template) badges.push({ text: '📄 Template', cls: 'badge-flag' });
            if (card.ephemeral) badges.push({ text: '⏱ Ephemeral', cls: 'badge-flag' });

            // Scheduling badges
            if (card.due_at) {
                const dueDate = new Date(card.due_at);
                const now = new Date();
                const isOverdue = dueDate < now;
                badges.push({
                    text: `📅 Due: ${dueDate.toLocaleDateString()}`,
                    cls: isOverdue ? 'badge-overdue' : 'badge-due'
                });
            }
            if (card.defer_until) {
                const deferDate = new Date(card.defer_until);
                badges.push({ text: `⏰ Defer: ${deferDate.toLocaleDateString()}`, cls: 'badge-defer' });
            }

            // Parent info
            let parentHtml = "";
            if (card.parent) {
                parentHtml = `<div class="cardParent" title="Parent: ${escapeHtml(card.parent.title)}">
                    <span class="icon-parent">↳</span> ${escapeHtml(card.parent.title)}
                </div>`;
            }

            el.innerHTML = `
        ${parentHtml}
        <div class="cardTitle">${escapeHtml(card.title)}</div>
        <div class="badges">${badges.map(b => `<span class="badge ${b.cls || ''}">${escapeHtml(b.text)}</span>`).join("")}</div>
      `;

            dropZone.appendChild(el);
        }

        // Add loading spinner if column is loading
        const colState = columnState[col.key];
        if (colState && colState.loading) {
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'column-loading';
            loadingDiv.innerHTML = `
                <div class="spinner"></div>
                <span>Loading...</span>
            `;
            dropZone.appendChild(loadingDiv);
        }

        // Add Load More button if there are more cards to load
        if (colState && colState.hasMore && !colState.loading) {
            const loadMoreDiv = document.createElement('div');
            loadMoreDiv.className = 'load-more-container';
            
            const remaining = colState.totalCount - colState.cards.length;
            const btn = document.createElement('button');
            btn.className = 'btn load-more-btn';
            btn.textContent = `Load More (${remaining} remaining)`;
            btn.dataset.column = col.key;
            
            btn.onclick = async () => {
                try {
                    // Set loading state
                    columnState[col.key].loading = true;
                    render(); // Re-render to show spinner
                    
                    // Request more data
                    await postAsync('board.loadMore', { column: col.key });
                } catch (error) {
                    console.error('[Webview] Load More failed:', error);
                    toast(`Failed to load more: ${error.message}`);
                    columnState[col.key].loading = false;
                    render();
                }
            };
            
            loadMoreDiv.appendChild(btn);
            dropZone.appendChild(loadMoreDiv);
        }

        colWrap.appendChild(header);
        colWrap.appendChild(dropZone);
        boardEl.appendChild(colWrap);
    }
    console.log('[Webview] renderKanban() completed successfully - DOM rebuilt with', columns.length, 'columns');
}

// Flatten columnState into a deduplicated array of cards
function flattenColumnState() {
    const cardMap = new Map();
    
    // Iterate through all columns and collect cards
    for (const col of columns) {
        const colState = columnState[col.key];
        if (colState && colState.cards) {
            for (const card of colState.cards) {
                // Use Map to deduplicate by id (last occurrence wins)
                if (!cardMap.has(card.id)) {
                    cardMap.set(card.id, card);
                }
            }
        }
    }
    
    return Array.from(cardMap.values());
}

// Check if there's more data to load across all columns
function hasPartialData() {
    for (const col of columns) {
        const colState = columnState[col.key];
        if (colState && colState.hasMore) {
            return true;
        }
    }
    return false;
}

// Get total count across all columns
function getTotalCount() {
    let total = 0;
    for (const col of columns) {
        const colState = columnState[col.key];
        if (colState && colState.totalCount) {
            total += colState.totalCount;
        }
    }
    return total;
}

// Get loaded count across all columns
function getLoadedCount() {
    let loaded = 0;
    for (const col of columns) {
        const colState = columnState[col.key];
        if (colState && colState.cards) {
            loaded += colState.cards.length;
        }
    }
    return loaded;
}

// Table view rendering
function renderTable() {
    console.log('[Webview] renderTable() called');

    // Check if any column is loading
    const isLoading = columns.some(col => {
        const colState = columnState[col.key];
        return colState && colState.loading;
    });

    // Flatten and deduplicate cards from all columns
    let tableRows = flattenColumnState();
    console.log('[Webview] Flattened', tableRows.length, 'unique cards');

    // Apply existing filters (search, priority, type) plus table-specific filters
    const searchTerm = filterSearch.value.toLowerCase().trim();
    const priorityFilter = filterPriority.value;
    const typeFilter = filterType.value;
    const statusFilter = tableState.filters.status;
    const assigneeFilter = tableState.filters.assignee;
    const labelsFilter = tableState.filters.labels; // Array of labels to match

    if (searchTerm || priorityFilter || typeFilter || statusFilter || assigneeFilter || labelsFilter) {
        tableRows = tableRows.filter(card => {
            // Search filter (title, id, and optionally description)
            if (searchTerm) {
                const matchesSearch = 
                    card.title.toLowerCase().includes(searchTerm) ||
                    card.id.toLowerCase().includes(searchTerm) ||
                    (card.description && card.description.toLowerCase().includes(searchTerm));
                if (!matchesSearch) return false;
            }

            // Priority filter
            if (priorityFilter && String(card.priority) !== priorityFilter) {
                return false;
            }

            // Type filter
            if (typeFilter && card.issue_type !== typeFilter) {
                return false;
            }

            // Status filter (supports presets and specific statuses)
            if (statusFilter) {
                if (statusFilter === 'not_closed') {
                    if (card.status === 'closed') return false;
                } else if (statusFilter === 'active') {
                    if (card.status !== 'in_progress' && card.status !== 'open') return false;
                } else if (statusFilter === 'blocked') {
                    if (card.status !== 'blocked') return false;
                } else if (statusFilter !== 'all') {
                    // Specific status match
                    if (card.status !== statusFilter) return false;
                }
            }

            // Assignee filter
            if (assigneeFilter) {
                if (assigneeFilter === 'unassigned') {
                    if (card.assignee) return false;
                } else {
                    if (card.assignee !== assigneeFilter) return false;
                }
            }

            // Labels filter (must have ALL specified labels)
            if (labelsFilter && labelsFilter.length > 0) {
                if (!card.labels || card.labels.length === 0) return false;
                const hasAllLabels = labelsFilter.every(label => 
                    card.labels.includes(label)
                );
                if (!hasAllLabels) return false;
            }

            return true;
        });
        console.log('[Webview] After filtering:', tableRows.length, 'cards');
    }

    // Apply sorting (for now, just default to updated_at desc)
    if (tableState.sorting.length > 0) {
        // Apply multi-column sorting
        tableRows.sort((a, b) => {
            for (const sortSpec of tableState.sorting) {
                const col = tableColumns.find(c => c.id === sortSpec.id);
                if (!col || !col.sort) continue;
                
                const cmp = col.sort(a, b);
                if (cmp !== 0) {
                    return sortSpec.dir === 'desc' ? -cmp : cmp;
                }
            }
            // Fallback to updated_at desc
            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return bTime - aTime;
        });
    } else {
        // Default sort: updated_at desc
        tableRows.sort((a, b) => {
            const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
            const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
            return bTime - aTime;
        });
    }

    // Get visible columns (respecting user preferences)
    let visibleColumns = tableColumns.filter(col => {
        // Use columnVisibility map if set, otherwise use default visible property
        if (Object.keys(tableState.columnVisibility).length > 0) {
            return tableState.columnVisibility[col.id] !== false;
        }
        return col.visible;
    });

    // Apply column order if set
    if (tableState.columnOrder.length > 0) {
        visibleColumns = tableState.columnOrder
            .map(id => visibleColumns.find(c => c.id === id))
            .filter(Boolean);
    }

    // Apply pagination: calculate visible rows for current page
    const totalRows = tableRows.length;
    const totalPages = Math.ceil(totalRows / tableState_rowsPerPage);
    const currentPage = Math.min(tableState_paginationPage, totalPages - 1);
    const startIdx = currentPage * tableState_rowsPerPage;
    const endIdx = Math.min(startIdx + tableState_rowsPerPage, totalRows);
    const visibleRows = tableRows.slice(startIdx, endIdx);

    console.log('[Webview] Pagination:', totalRows, 'total rows,', visibleRows.length, 'visible rows on page', currentPage + 1, 'of', totalPages);

    // Build table HTML
    let tableHtml = `
        <div class="table-view">
            <div class="table-wrapper">
                <table class="issues-table">
                    <thead>
                        <tr>
                            ${visibleColumns.map(col => {
                                const sortSpec = tableState.sorting.find(s => s.id === col.id);
                                const sortIndicator = sortSpec 
                                    ? `<span class="sort-indicator ${sortSpec.dir}">${sortSpec.dir === 'asc' ? '▲' : '▼'}</span>`
                                    : '';
                                return `<th class="sortable" data-column-id="${escapeHtml(col.id)}" style="width: ${col.width}px">${escapeHtml(col.label)}${sortIndicator}</th>`;
                            }).join('')}
                        </tr>
                    </thead>
                    <tbody>
    `;

    // Render only visible rows for current page
    for (const card of visibleRows) {
        tableHtml += '<tr class="table-row" data-id="' + escapeHtml(card.id) + '">';
        for (const col of visibleColumns) {
            const cellContent = col.render(card);
            tableHtml += '<td>' + cellContent + '</td>';
        }
        tableHtml += '</tr>';
    }

    tableHtml += `
                    </tbody>
                </table>
            </div>
        </div>
    `;

    boardEl.innerHTML = tableHtml;

    // Add pagination controls if there are multiple pages
    if (totalPages > 1) {
        const paginationDiv = document.createElement('div');
        paginationDiv.className = 'table-pagination';
        paginationDiv.innerHTML = `
            <span class="pagination-info">Showing ${startIdx + 1}-${endIdx} of ${totalRows} rows (Page ${currentPage + 1} of ${totalPages})</span>
            <button class="btn pagination-btn" id="tablePrevPage" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
            <button class="btn pagination-btn" id="tableNextPage" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
        `;
        boardEl.appendChild(paginationDiv);

        // Add pagination button handlers
        const prevBtn = document.getElementById('tablePrevPage');
        const nextBtn = document.getElementById('tableNextPage');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (tableState_paginationPage > 0) {
                    tableState_paginationPage--;
                    renderTable();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (tableState_paginationPage < totalPages - 1) {
                    tableState_paginationPage++;
                    renderTable();
                }
            });
        }
    }

    // Add loading indicator or partial load banner
    if (isLoading) {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'table-footer';
        loadingDiv.innerHTML = `
            <div class="column-loading">
                <div class="spinner"></div>
                <span>Loading more issues...</span>
            </div>
        `;
        boardEl.appendChild(loadingDiv);
    } else if (hasPartialData()) {
        const totalCount = getTotalCount();
        const loadedCount = getLoadedCount();
        const remaining = totalCount - loadedCount;
        
        const banner = document.createElement('div');
        banner.className = 'table-footer';
        banner.innerHTML = `
            Showing ${loadedCount} of ${totalCount} issues (${remaining} remaining).
            <button class="btn load-more-btn" id="tableLoadMoreBtn" style="margin-left: 12px;">Load More</button>
        `;
        boardEl.appendChild(banner);
        
        // Add load more handler
        const loadMoreBtn = document.getElementById('tableLoadMoreBtn');
        loadMoreBtn.addEventListener('click', async () => {
            // Load more from all columns that have more data
            for (const col of columns) {
                const colState = columnState[col.key];
                if (colState && colState.hasMore && !colState.loading) {
                    try {
                        colState.loading = true;
                        render(); // Re-render to show loading state
                        await postAsync('board.loadMore', { column: col.key });
                    } catch (error) {
                        console.error('[Webview] Load More failed for', col.key, ':', error);
                        toast(`Failed to load more: ${error.message}`);
                        colState.loading = false;
                    }
                }
            }
        });
    } catch (error) {
                        console.error('[Webview] Load More failed for', col.key, ':', error);
                        toast(`Failed to load more: ${error.message}`);
                        colState.loading = false;
                    }
                }
            }
        });
    }

    // Add click handlers to table rows
    const rows = boardEl.querySelectorAll('.table-row');
    for (const row of rows) {
        const cardId = row.dataset.id;
        const card = tableRows.find(c => c.id === cardId);
        if (card) {
            row.addEventListener('click', () => openDetail(card));
            row.style.cursor = 'pointer';
        }
    }

    // Add click handlers to sortable headers
    const headers = boardEl.querySelectorAll('th.sortable');
    for (const header of headers) {
        const columnId = header.dataset.columnId;
        header.addEventListener('click', (e) => {
            handleColumnSort(columnId, e.shiftKey);
        });
    }

    // Add keyboard navigation for table rows
    for (const row of rows) {
        row.setAttribute('tabindex', '0'); // Make rows focusable
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                row.click(); // Trigger the click handler
            }
        });
    }

    // Add copy handlers for ID cells
    const idCells = boardEl.querySelectorAll('.copy-id');
    for (const cell of idCells) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent row click
            const fullId = cell.dataset.fullId;
            post('issue.copyToClipboard', { text: fullId });
            toast(`Copied: ${fullId.slice(-8)}`);
        });
    }

    console.log('[Webview] renderTable() completed -', tableRows.length, 'rows rendered');
}

// Handle column sorting
function handleColumnSort(columnId, isShiftKey) {
    console.log('[Webview] handleColumnSort:', columnId, 'shift:', isShiftKey);
    
    // Find existing sort for this column
    const existingIndex = tableState.sorting.findIndex(s => s.id === columnId);
    
    if (!isShiftKey) {
        // Single column sort: cycle through none -> asc -> desc -> none
        if (existingIndex === -1) {
            // Not sorted: set to asc
            tableState.sorting = [{ id: columnId, dir: 'asc' }];
        } else {
            const currentDir = tableState.sorting[existingIndex].dir;
            if (currentDir === 'asc') {
                // asc -> desc
                tableState.sorting = [{ id: columnId, dir: 'desc' }];
            } else {
                // desc -> none (clear sorting)
                tableState.sorting = [];
            }
        }
    } else {
        // Multi-column sort: shift+click adds/cycles secondary sort
        if (existingIndex === -1) {
            // Add new sort as secondary
            tableState.sorting.push({ id: columnId, dir: 'asc' });
        } else {
            const currentDir = tableState.sorting[existingIndex].dir;
            if (currentDir === 'asc') {
                // asc -> desc
                tableState.sorting[existingIndex].dir = 'desc';
            } else {
                // desc -> remove this sort
                tableState.sorting.splice(existingIndex, 1);
            }
        }
    }
    
    console.log('[Webview] New sorting:', tableState.sorting);
    saveState();
    render();
}

function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;");
}

// View toggle event listeners
viewKanbanBtn.addEventListener("click", () => {
    if (viewMode !== 'kanban') {
        viewMode = 'kanban';
        viewKanbanBtn.classList.add('active');
        viewTableBtn.classList.remove('active');
        saveState();
        render();
    }
});

viewTableBtn.addEventListener("click", () => {
    if (viewMode !== 'table') {
        viewMode = 'table';
        viewTableBtn.classList.add('active');
        viewKanbanBtn.classList.remove('active');
        saveState();
        render();
    }
});

// Initialize view toggle buttons based on saved state
if (viewMode === 'table') {
    viewTableBtn.classList.add('active');
    viewKanbanBtn.classList.remove('active');
} else {
    viewKanbanBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
}

refreshBtn.addEventListener("click", () => post("board.refresh"));
newBtn.addEventListener("click", () => {
    // Use full detail form for creating new issues
    const emptyCard = {
        id: null, // null indicates create mode
        title: "",
        description: "",
        status: "open",
        priority: 2,
        issue_type: "task",
        assignee: null,
        estimated_minutes: null,
        external_ref: null,
        due_at: null,
        defer_until: null,
        acceptance_criteria: "",
        design: "",
        notes: "",
        labels: [],
        comments: [],
        blocked_by: [],
        blocks: [],
        children: [],
        parent: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    openDetail(emptyCard);
});

// Create debounced render function for filter changes (300ms delay)
const debouncedRender = debounce(render, 300);

filterPriority.addEventListener("change", render); // Immediate for dropdown
filterType.addEventListener("change", render); // Immediate for dropdown
filterSearch.addEventListener("input", debouncedRender); // Debounced for text input

window.addEventListener("message", (event) => {
    console.log('[Webview] Received message event:', event);
    console.log('[Webview] Message data:', event.data);
    const msg = event.data;
    if (!msg || !msg.type) {
        console.log('[Webview] Invalid message structure - missing type');
        return;
    }
    console.log('[Webview] Message type:', msg.type, 'requestId:', msg.requestId);

    // Handle cleanup message from extension (for proper disposal)
    if (msg.type === "webview.cleanup") {
        cleanupPendingRequests();
        return;
    }

    if (msg.type === "board.data") {
        console.log('[Webview] Processing board.data message');
        console.log('[Webview] Payload:', msg.payload);
        console.log('[Webview] Cards count:', msg.payload?.cards?.length);
        
        // Support both legacy flat cards array and new columnData structure
        if (msg.payload.columnData) {
            // New incremental loading format
            console.log('[Webview] Using new columnData format');
            columns = msg.payload.columns || [];
            
            // Initialize columnState from columnData
            for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
                const data = msg.payload.columnData[col];
                if (data) {
                    columnState[col] = {
                        cards: data.cards || [],
                        offset: data.offset || 0,
                        totalCount: data.totalCount || 0,
                        hasMore: data.hasMore || false,
                        loading: false
                    };
                } else {
                    // Reset to empty if not provided
                    columnState[col] = { cards: [], offset: 0, totalCount: 0, hasMore: false, loading: false };
                }
            }
        } else {
            // Legacy format: flat cards array
            console.log('[Webview] Using legacy flat cards array format');
            columns = msg.payload.columns || [];
            const cards = msg.payload.cards || [];
            
            // Distribute cards into columns
            for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
                columnState[col] = {
                    cards: [],
                    offset: 0,
                    totalCount: 0,
                    hasMore: false,
                    loading: false
                };
            }
            
            for (const card of cards) {
                const col = columnForCard(card);
                if (columnState[col]) {
                    columnState[col].cards.push(card);
                }
            }
            
            // Update counts
            for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
                columnState[col].totalCount = columnState[col].cards.length;
            }
        }
        
        // Maintain backward compatibility
        boardData = msg.payload;
        
        console.log('[Webview] columnState initialized, calling render()');
        render();
        console.log('[Webview] render() completed, calling hideLoading()');
        hideLoading();
        
        // Resolve any pending request waiting for board data
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { resolve, timeoutId } = pendingRequests.get(msg.requestId);
            // Clear timeout immediately to prevent unnecessary memory overhead
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            resolve(msg.payload);
        }
        return;
    }

    if (msg.type === "board.columnData") {
        console.log('[Webview] Processing board.columnData message');
        const { column, cards, offset, totalCount, hasMore } = msg.payload;
        
        if (!columnState[column]) {
            console.error('[Webview] Invalid column:', column);
            return;
        }
        
        // Update specific column
        if (offset === 0) {
            // Replace cards (refresh)
            console.log(`[Webview] Replacing ${column} column data`);
            columnState[column].cards = cards;
        } else {
            // Append cards (loading more)
            console.log(`[Webview] Appending ${cards.length} cards to ${column} column`);
            columnState[column].cards = [...columnState[column].cards, ...cards];
        }
        
        columnState[column].offset = offset + cards.length;
        columnState[column].totalCount = totalCount;
        columnState[column].hasMore = hasMore;
        columnState[column].loading = false;
        
        console.log(`[Webview] ${column} column updated: ${columnState[column].cards.length}/${totalCount} cards loaded`);
        render();
        
        // Resolve any pending request
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { resolve, timeoutId } = pendingRequests.get(msg.requestId);
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            resolve(msg.payload);
        }
        return;
    }

    if (msg.type === "mutation.error") {
        toast(msg.error || "Operation failed.");
        
        // Reject pending request
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { reject, timeoutId } = pendingRequests.get(msg.requestId);
            // Clear timeout immediately to prevent unnecessary memory overhead
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            reject(new Error(msg.error || "Operation failed"));
        }
        return;
    }

    if (msg.type === "mutation.ok") {
        // Resolve pending request
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { resolve, timeoutId } = pendingRequests.get(msg.requestId);
            // Clear timeout immediately to prevent unnecessary memory overhead
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            resolve();
        }
        return;
    }
});

// Initial load

function openDetail(card) {
    if (!card) return;

    // We will dynamically rebuild the form content to support editing
    const form = detDialog.querySelector("form");

    // Helper to safe string
    const safe = (s) => escapeHtml(s || "");

    // Helper to format dependency with metadata
    const formatDep = (dep) => {
        let result = escapeHtml(dep.title);
        const meta = [];
        if (dep.created_at) meta.push(`Created: ${new Date(dep.created_at).toLocaleString()}`);
        if (dep.created_by) meta.push(`By: ${escapeHtml(dep.created_by)}`);
        if (dep.thread_id) meta.push(`Thread: ${escapeHtml(dep.thread_id)}`);
        if (meta.length > 0) {
            result += ` <span style="font-size: 10px; color: var(--muted); font-style: italic;">(${meta.join(', ')})</span>`;
        }
        return result;
    };

    const statusOptions = [
        { v: "open", l: "Open" },
        { v: "in_progress", l: "In Progress" },
        { v: "blocked", l: "Blocked" },
        { v: "closed", l: "Closed" }
    ];

    const typeOptions = ["task", "bug", "feature", "epic", "chore"];
    const priorityOptions = [0, 1, 2, 3, 4];

    const isCreateMode = card.id === null;
    const issueOptionsId = "issueIdOptions";
    
    // Collect all cards from columnState for the datalist
    const allCards = [];
    for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
        if (columnState[col]?.cards) {
            allCards.push(...columnState[col].cards);
        }
    }
    
    const issueOptionsHtml = allCards
        .filter(c => !card.id || c.id !== card.id)
        .map(c => `<option value="${escapeHtml(c.id)}" label="${escapeHtml(c.title)}"></option>`)
        .join("");
    const disabledAttr = isCreateMode ? 'disabled' : '';
    const renderStructureSection = () => `
                         <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Structure</label>
                         
                         <!-- Parent -->
                         <div style="margin-bottom: 8px;">
                            <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px;">Parent:
                                ${card.parent ? `
                                    <span style="color: var(--vscode-editor-foreground);">${formatDep(card.parent)}</span>
                                    <span id="removeParent" data-id="${escapeHtml(card.parent.id)}" style="cursor: pointer; color: var(--error); margin-left: 4px;">(Unlink)</span>
                                ` : '<span style="font-style:italic;">None</span>'}
                            </div>
                            ${!card.parent ? `
                                <div style="display: flex; gap: 4px;">
                                    <input id="newParentId" type="text" placeholder="Parent Issue ID" list="${issueOptionsId}" ${disabledAttr} style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                                    <button id="btnSetParent" class="btn" ${disabledAttr} style="padding: 2px 8px;">Set</button>
                                </div>
                            ` : ''}
                         </div>

                         <!-- Blocker -->
                          <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px;">Blocked By:</div>
                          ${(card.blocked_by && card.blocked_by.length > 0) ? `
                          <ul style="margin: 0; padding-left: 16px; font-size: 11px; margin-bottom: 4px;">
                            ${card.blocked_by.map(b => `
                                <li>
                                    ${formatDep(b)}
                                    <span class="remove-blocker" data-id="${escapeHtml(b.id)}" style="cursor: pointer; color: var(--error); margin-left: 4px;">&times;</span>
                                </li>
                            `).join('')}
                          </ul>
                          ` : '<div style="font-size: 11px; font-style: italic; color: var(--muted); margin-bottom: 4px;">None</div>'}
                          <div style="display: flex; gap: 4px;">
                                <input id="newBlockerId" type="text" placeholder="Blocker Issue ID" list="${issueOptionsId}" ${disabledAttr} style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                                <button id="btnAddBlocker" class="btn" ${disabledAttr} style="padding: 2px 8px;">Add</button>
                          </div>

                          <!-- Blocks (issues this item blocks) -->
                          <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px; margin-top: 12px;">Blocks:</div>
                          ${(card.blocks && card.blocks.length > 0) ? `
                            <ul style="margin: 0; padding-left: 16px; font-size: 11px; margin-bottom: 4px;">
                              ${card.blocks.map(b => `
                                  <li>${formatDep(b)}</li>
                              `).join('')}
                            </ul>
                          ` : '<div style="font-size: 11px; font-style: italic; color: var(--muted);">None</div>'}

                          <!-- Children (sub-issues) -->
                          <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px; margin-top: 12px;">Children:</div>
                          ${(card.children && card.children.length > 0) ? `
                            <ul style="margin: 0; padding-left: 16px; font-size: 11px; margin-bottom: 4px;">
                              ${card.children.map(c => `
                                  <li>${formatDep(c)}</li>
                              `).join('')}
                            </ul>
                          ` : '<div style="font-size: 11px; font-style: italic; color: var(--muted);">None</div>'}
                          ${isCreateMode ? '<div style="font-size: 10px; color: var(--muted); margin-top: 6px;">Create the issue to manage relationships.</div>' : ''}
    `;
    
    form.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
            <h3 style="margin: 0 0 12px 0;">${isCreateMode ? 'Create New Issue' : `Edit Issue <span style="color: var(--muted); font-weight: normal; font-size: 14px;">${escapeHtml(card.id)}</span>`}</h3>
            <div style="display: flex; gap: 8px; align-items: center;">
                 <div style="flex: 1;">
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Title</label>
                    <input id="editTitle" type="text" value="${safe(card.title)}" style="width: 100%; font-size: 16px; font-weight: bold; margin-top: 4px;" />
                 </div>
                 <div style="display: flex; flex-direction: column; width: 100px;">
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Status</label>
                    <select id="editStatus" style="width: 100%; margin-top: 4px;">
                        ${statusOptions.map(o => `<option value="${o.v}" ${card.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
                    </select>
                 </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
                <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Type</label>
                    <select id="editType" style="width: 100%; margin-top: 4px;">
                        ${typeOptions.map(t => `<option value="${t}" ${card.issue_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div>
                     <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Priority</label>
                     <select id="editPriority" style="width: 100%; margin-top: 4px;">
                        ${priorityOptions.map(p => `<option value="${p}" ${card.priority === p ? 'selected' : ''}>P${p}</option>`).join('')}
                     </select>
                </div>
                <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Assignee</label>
                    <input id="editAssignee" type="text" value="${safe(card.assignee)}" placeholder="Unassigned" style="width: 100%; margin-top: 4px;" />
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                 <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Est. Minutes</label>
                    <input id="editEst" type="number" value="${card.estimated_minutes || ''}" placeholder="Min" style="width: 100%; margin-top: 4px;" />
                </div>
                <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Ext Ref</label>
                    <input id="editExtRef" type="text" value="${safe(card.external_ref)}" placeholder="JIRA-123" style="width: 100%; margin-top: 4px;" />
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px;">
                 <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Due At</label>
                    <input id="editDueAt" type="datetime-local" value="${toLocalDateTimeInput(card.due_at)}" style="width: 100%; margin-top: 4px;" />
                </div>
                <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Defer Until</label>
                    <input id="editDeferUntil" type="datetime-local" value="${toLocalDateTimeInput(card.defer_until)}" style="width: 100%; margin-top: 4px;" />
                </div>
            </div>

            <!-- Flags -->
            <div style="margin-top: 8px;">
                <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Flags</label>
                <div style="display: flex; gap: 6px; margin-top: 4px; flex-wrap: wrap;">
                    ${card.pinned ? '<span class="badge badge-flag" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px;">📌 Pinned</span>' : ''}
                    ${card.is_template ? '<span class="badge badge-flag" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px;">📄 Template</span>' : ''}
                    ${card.ephemeral ? '<span class="badge badge-flag" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px;">⏱ Ephemeral</span>' : ''}
                    ${!card.pinned && !card.is_template && !card.ephemeral ? '<span style="font-size: 11px; font-style: italic; color: var(--muted);">None</span>' : ''}
                </div>
            </div>

            <hr style="border: 0; border-top: 1px solid var(--border); margin: 4px 0;">

            <div style="display: flex; gap: 12px; height: 300px;">
                ${createMarkdownField("Description", "editDesc", card.description)}
                ${createMarkdownField("Acceptance Criteria", "editAC", card.acceptance_criteria)}
                ${createMarkdownField("Design Notes", "editDesign", card.design)}
                ${createMarkdownField("Notes", "editNotes", card.notes)}
            </div>

            <!-- Relationships & Tags -->
            <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <div>
                         <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Tags</label>
                         <div class="labels-container" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px 0;">
                            ${(card.labels || []).map(l => `
                                <span class="badge" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                                    #${escapeHtml(l)}
                                    <span class="remove-label" data-label="${escapeHtml(l)}" style="cursor: pointer; opacity: 0.7;">&times;</span>
                                </span>
                            `).join('')}
                         </div>
                         <div style="display: flex; gap: 4px;">
                            <input id="newLabel" type="text" placeholder="Add tag..." ${disabledAttr} style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                            <button id="btnAddLabel" class="btn" ${disabledAttr} style="padding: 2px 8px;">+</button>
                         </div>
                         ${isCreateMode ? '<div style="font-size: 10px; color: var(--muted); margin-top: 4px;">Create the issue to add tags.</div>' : ''}
                    </div>
                    <div id="structureSection">
                        ${renderStructureSection()}
                    </div>
                </div>
            </div>
            <datalist id="${issueOptionsId}">
                ${issueOptionsHtml}
            </datalist>

            <!-- Event/Agent Metadata Panel (only shown when populated) -->
            ${(() => {
                const hasEventData = card.event_kind || card.actor || card.target || card.payload || card.sender ||
                                     card.mol_type || card.role_type || card.rig || card.agent_state ||
                                     card.last_activity || card.hook_bead || card.role_bead ||
                                     card.await_type || card.await_id || card.timeout_ns || card.waiters;
                if (!hasEventData) return '';

                return `
                    <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
                        <details>
                            <summary style="font-size: 10px; color: var(--muted); text-transform: uppercase; cursor: pointer; user-select: none;">
                                Advanced Metadata (Event/Agent)
                            </summary>
                            <div style="margin-top: 8px; display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: 11px;">
                                ${card.event_kind ? `<span style="color: var(--muted);">Event Kind:</span><span>${escapeHtml(card.event_kind)}</span>` : ''}
                                ${card.actor ? `<span style="color: var(--muted);">Actor:</span><span>${escapeHtml(card.actor)}</span>` : ''}
                                ${card.target ? `<span style="color: var(--muted);">Target:</span><span>${escapeHtml(card.target)}</span>` : ''}
                                ${card.sender ? `<span style="color: var(--muted);">Sender:</span><span>${escapeHtml(card.sender)}</span>` : ''}
                                ${card.mol_type ? `<span style="color: var(--muted);">Mol Type:</span><span>${escapeHtml(card.mol_type)}</span>` : ''}
                                ${card.role_type ? `<span style="color: var(--muted);">Role Type:</span><span>${escapeHtml(card.role_type)}</span>` : ''}
                                ${card.rig ? `<span style="color: var(--muted);">Rig:</span><span>${escapeHtml(card.rig)}</span>` : ''}
                                ${card.agent_state ? `<span style="color: var(--muted);">Agent State:</span><span>${escapeHtml(card.agent_state)}</span>` : ''}
                                ${card.last_activity ? `<span style="color: var(--muted);">Last Activity:</span><span>${new Date(card.last_activity).toLocaleString()}</span>` : ''}
                                ${card.hook_bead ? `<span style="color: var(--muted);">Hook Bead:</span><span>${escapeHtml(card.hook_bead)}</span>` : ''}
                                ${card.role_bead ? `<span style="color: var(--muted);">Role Bead:</span><span>${escapeHtml(card.role_bead)}</span>` : ''}
                                ${card.await_type ? `<span style="color: var(--muted);">Await Type:</span><span>${escapeHtml(card.await_type)}</span>` : ''}
                                ${card.await_id ? `<span style="color: var(--muted);">Await ID:</span><span>${escapeHtml(card.await_id)}</span>` : ''}
                                ${card.timeout_ns !== null && card.timeout_ns !== undefined ? `<span style="color: var(--muted);">Timeout (ns):</span><span>${card.timeout_ns}</span>` : ''}
                                ${card.waiters ? `<span style="color: var(--muted);">Waiters:</span><span>${escapeHtml(card.waiters)}</span>` : ''}
                                ${card.payload ? `<span style="color: var(--muted); vertical-align: top;">Payload:</span><pre style="margin: 0; font-size: 10px; overflow-x: auto; max-width: 100%; background: rgba(0,0,0,0.2); padding: 4px; border-radius: 3px;">${escapeHtml(card.payload)}</pre>` : ''}
                            </div>
                        </details>
                    </div>
                `;
            })()}

            <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
                <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Comments</label>
                <div id="commentsList" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; max-height: 200px; overflow-y: auto;">
                    ${card.comments && card.comments.length > 0 ? card.comments.map(c => `
                        <div class="comment" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid var(--border);">
                            <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: flex; justify-content: space-between;">
                                <span>${escapeHtml(c.author)}</span>
                                <span>${new Date(c.created_at).toLocaleString()}</span>
                            </div>
                            <div class="markdown-body" style="font-size: 13px;">${DOMPurify.sanitize(marked.parse(c.text), purifyConfig)}</div>
                        </div>
                    `).join('') : '<div style="font-size: 12px; color: var(--muted); font-style: italic;">No comments yet.</div>'}
                </div>
                
                <div style="display: flex; gap: 8px;">
                    <textarea id="newCommentText" rows="2" placeholder="Write a comment..." ${disabledAttr} style="flex: 1; resize: vertical; margin: 0;"></textarea>
                    <button type="button" id="btnPostComment" class="btn" ${disabledAttr} style="align-self: flex-start; height: auto;">Post</button>
                </div>
                ${isCreateMode ? '<div style="font-size: 10px; color: var(--muted); margin-top: 6px;">Create the issue to add comments.</div>' : ''}
            </div>

            <div class="dialogActions" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 8px;">
                     <button type="button" id="btnSave" class="btn primary">${isCreateMode ? 'Create Issue' : 'Save Changes'}</button>
                     <button type="button" id="btnClose" class="btn">Close</button>
                </div>
                <div style="display: flex; gap: 8px;">
                     <button type="button" id="btnChat" class="btn icon-btn" title="Add to Chat">💬 Chat</button>
                     <button type="button" id="btnCopy" class="btn icon-btn" title="Copy Context">📋 Copy</button>
                </div>
            </div>
            <div style="font-size: 10px; color: var(--muted); text-align: right; margin-top: 8px; line-height: 1.5;">
               ID: ${isCreateMode ? 'Assigned on create' : escapeHtml(card.id)}<br>
               Created: ${isCreateMode ? 'Not yet created' : new Date(card.created_at).toLocaleString()}<br>
               Updated: ${isCreateMode ? 'Not yet created' : new Date(card.updated_at).toLocaleString()}${!isCreateMode && card.closed_at ? `<br>Closed: ${new Date(card.closed_at).toLocaleString()}` : ''}
            </div>
        </div>
    `;

    detailDirty = false;
    const markDirty = () => { detailDirty = true; };
    const dirtyFieldIds = [
        "editTitle",
        "editStatus",
        "editType",
        "editPriority",
        "editAssignee",
        "editEst",
        "editExtRef",
        "editDueAt",
        "editDeferUntil",
        "editDesc",
        "editAC",
        "editDesign",
        "editNotes"
    ];
    dirtyFieldIds.forEach((id) => {
        const field = form.querySelector(`#${id}`);
        if (!field) return;
        field.addEventListener("input", markDirty);
        field.addEventListener("change", markDirty);
    });

    // Bind events
    form.querySelector("#btnClose").onclick = (e) => {
        e.preventDefault();
        requestDetailClose();
    };

    form.querySelector("#btnSave").onclick = async (e) => {
        e.preventDefault();
        const data = {
            title: document.getElementById("editTitle").value.trim(),
            status: document.getElementById("editStatus").value,
            issue_type: document.getElementById("editType").value,
            priority: parseInt(document.getElementById("editPriority").value),
            assignee: document.getElementById("editAssignee").value.trim() || null,
            estimated_minutes: document.getElementById("editEst").value ? parseInt(document.getElementById("editEst").value) : null,
            external_ref: document.getElementById("editExtRef").value.trim() || null,
            due_at: toIsoFromLocalInput(document.getElementById("editDueAt").value),
            defer_until: toIsoFromLocalInput(document.getElementById("editDeferUntil").value),
            description: document.getElementById("editDesc").value,
            acceptance_criteria: document.getElementById("editAC").value,
            design: document.getElementById("editDesign").value,
            notes: document.getElementById("editNotes").value
        };

        if (data.title) {
            try {
                if (isCreateMode) {
                    // Create new issue
                    await postAsync("issue.create", data);
                    toast("Issue created successfully");
                } else {
                    // Update existing issue
                    await postAsync("issue.update", { id: card.id, updates: data });
                    toast("Changes saved successfully");
                }
                detailDirty = false;
                detDialog.close();
            } catch (err) {
                // Show error feedback (mutation.error toast or timeout/network error)
                console.error(isCreateMode ? "Create failed:" : "Save failed:", err);
                toast(`Failed to ${isCreateMode ? 'create issue' : 'save changes'}: ${err.message}`);
            }
        } else {
            toast("Title is required");
        }
    };

    function renderCommentsList() {
        if (!card.comments || card.comments.length === 0) {
            return '<div style="font-size: 12px; color: var(--muted); font-style: italic;">No comments yet.</div>';
        }
        return card.comments.map(c => `
            <div class="comment" style="padding: 8px; background: rgba(255,255,255,0.03); border-radius: 6px; border: 1px solid var(--border);">
                <div style="font-size: 11px; color: var(--muted); margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>${escapeHtml(c.author)}</span>
                    <span>${new Date(c.created_at).toLocaleString()}</span>
                </div>
                <div class="markdown-body" style="font-size: 13px;">${DOMPurify.sanitize(marked.parse(c.text), purifyConfig)}</div>
            </div>
        `).join('');
    }

    function refreshCommentsDisplay() {
        const list = form.querySelector("#commentsList");
        if (!list) return;
        list.innerHTML = renderCommentsList();
    }

    const btnPostComment = form.querySelector("#btnPostComment");
    if (btnPostComment && !isCreateMode) {
        btnPostComment.onclick = async (e) => {
            e.preventDefault();
            const commentInput = form.querySelector("#newCommentText");
            const text = commentInput.value.trim();
            if (!text) return;

            try {
                await postAsync("issue.addComment", { id: card.id, text, author: "Me" });
                if (!card.comments) card.comments = [];
                card.comments.push({
                    id: Date.now(),
                    issue_id: card.id,
                    author: "Me",
                    text,
                    created_at: new Date().toISOString()
                });
                commentInput.value = "";
                refreshCommentsDisplay();
                toast("Comment posted");
            } catch (err) {
                console.error("Add comment failed:", err);
                toast(`Failed to add comment: ${err.message}`);
            }
        };
    }

// Helper function to refresh labels display in the dialog
    function refreshLabelsDisplay() {
        const labelsContainer = form.querySelector(".labels-container");
        if (!labelsContainer) return;

        const labels = card.labels || [];
        if (labels.length === 0) {
            labelsContainer.innerHTML = '<span style="font-size: 11px; font-style: italic; color: var(--muted);">None</span>';
            return;
        }

        labelsContainer.innerHTML = labels.map(l => `
            <span class="badge" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                #${escapeHtml(l)}
                <span class="remove-label" data-label="${escapeHtml(l)}" style="cursor: pointer; opacity: 0.7;">&times;</span>
            </span>
        `).join('');
        
        // Re-attach remove handlers
        if (!isCreateMode) {
            labelsContainer.querySelectorAll(".remove-label").forEach(btn => {
                btn.onclick = async (e) => {
                    const label = e.target.dataset.label;
                    try {
                        await postAsync("issue.removeLabel", { id: card.id, label });
                        // Update card.labels array
                        card.labels = (card.labels || []).filter(l => l !== label);
                        // Refresh the display
                        refreshLabelsDisplay();
                        toast("Label removed");
                        // Refresh board in background
                        postAsync("board.refresh", {});
                    } catch (err) {
                        console.error("Remove label failed:", err);
                        toast(`Failed to remove label: ${err.message}`);
                    }
                };
            });
        }
    }

    // Label Events - supports comma-separated multiple labels
    const btnAddLabel = form.querySelector("#btnAddLabel");
    if (btnAddLabel && !isCreateMode) {
        btnAddLabel.onclick = async (e) => {
        e.preventDefault();
        const input = form.querySelector("#newLabel");
        const rawLabels = input.value.trim();
        if (!rawLabels) return;

        // Split by comma, trim, filter empties, and dedupe
        const labels = [...new Set(
            rawLabels.split(',')
                .map(l => l.trim())
                .filter(l => l.length > 0)
        )];

        if (labels.length === 0) return;

        let successCount = 0;
        let failedLabels = [];

        // Add each label
        for (const label of labels) {
            try {
                await postAsync("issue.addLabel", { id: card.id, label });
                // Update card.labels array
                if (!card.labels) card.labels = [];
                if (!card.labels.includes(label)) {
                    card.labels.push(label);
                }
                successCount++;
            } catch (err) {
                console.error(`Add label '${label}' failed:`, err);
                failedLabels.push(label);
            }
        }

        // Show feedback
        if (successCount > 0) {
            toast(`Added ${successCount} label${successCount > 1 ? 's' : ''}`);
            input.value = ''; // Clear input on success
            // Refresh the labels display in dialog
            refreshLabelsDisplay();
            // Trigger board refresh to show new labels
            postAsync("board.refresh", {});
        }

        if (failedLabels.length > 0) {
            toast(`Failed to add: ${failedLabels.join(', ')}`);
        }

        // Keep dialog open for adding more labels
    };
    }

    // Initialize remove handlers for existing labels
    refreshLabelsDisplay();

    async function refreshRelationshipsFromBoard() {
        if (!card.id) return;
        try {
            const refreshed = await postAsync("board.refresh", {});
            const updated = refreshed?.cards?.find((c) => c.id === card.id);
            if (updated) {
                card.parent = updated.parent;
                card.children = updated.children;
                card.blocks = updated.blocks;
                card.blocked_by = updated.blocked_by;
            }
        } catch (err) {
            console.error("Refresh relationships failed:", err);
        }
        refreshStructureSection();
    }

    function refreshStructureSection() {
        const structure = form.querySelector("#structureSection");
        if (!structure) return;
        structure.innerHTML = renderStructureSection();
        bindStructureEvents();
    }

    function bindStructureEvents() {
        const btnSetParent = form.querySelector("#btnSetParent");
        if (btnSetParent && !isCreateMode) {
            btnSetParent.onclick = async (e) => {
                e.preventDefault();
                const parentId = form.querySelector("#newParentId").value.trim();
                if (!parentId) return;
                try {
                    await postAsync("issue.addDependency", { id: card.id, otherId: parentId, type: 'parent-child' });
                    toast("Parent set");
                    await refreshRelationshipsFromBoard();
                } catch (err) {
                    console.error("Set parent failed:", err);
                    toast(`Failed to set parent: ${err.message}`);
                }
            };
        }

        const removeParentBtn = form.querySelector("#removeParent");
        if (removeParentBtn && !isCreateMode) {
            removeParentBtn.onclick = async (e) => {
                try {
                    await postAsync("issue.removeDependency", { id: card.id, otherId: card.parent.id, type: 'parent-child' });
                    toast("Parent unlinked");
                    await refreshRelationshipsFromBoard();
                } catch (err) {
                    console.error("Remove parent failed:", err);
                    toast(`Failed to remove parent: ${err.message}`);
                }
            };
        }

        const btnAddBlocker = form.querySelector("#btnAddBlocker");
        if (btnAddBlocker && !isCreateMode) {
            btnAddBlocker.onclick = async (e) => {
                e.preventDefault();
                const blockerId = form.querySelector("#newBlockerId").value.trim();
                if (!blockerId) return;
                try {
                    await postAsync("issue.addDependency", { id: card.id, otherId: blockerId, type: 'blocks' });
                    toast("Blocker added");
                    await refreshRelationshipsFromBoard();
                } catch (err) {
                    console.error("Add blocker failed:", err);
                    toast(`Failed to add blocker: ${err.message}`);
                }
            };
        }

        form.querySelectorAll(".remove-blocker").forEach(btn => {
            btn.onclick = async (e) => {
                const blockerId = e.target.dataset.id;
                try {
                    await postAsync("issue.removeDependency", { id: card.id, otherId: blockerId, type: 'blocks' });
                    toast("Blocker removed");
                    await refreshRelationshipsFromBoard();
                } catch (err) {
                    console.error("Remove blocker failed:", err);
                    toast(`Failed to remove blocker: ${err.message}`);
                }
            };
        });
    }

    bindStructureEvents();

    // Context Helpers
    function getContext() {
        return `Issue: ${card.title}
ID: ${card.id}
Status: ${card.status}
Priority: P${card.priority}
Type: ${card.issue_type}
Assignee: ${card.assignee || 'Unassigned'}
Description:
${card.description || 'No description'}
Acceptance Criteria:
${card.acceptance_criteria || 'None'}
Design:
${card.design || 'None'}
`;
    }

    form.querySelector("#btnChat").onclick = (e) => {
        e.preventDefault();
        post("issue.addToChat", { text: getContext() });
        toast("Added to Chat input");
    };

    form.querySelector("#btnCopy").onclick = (e) => {
        e.preventDefault();
        post("issue.copyToClipboard", { text: getContext() });
        toast("Copying...");
    };

    // Markdown Field Helper
    function createMarkdownField(label, id, value) {
        // We use a unique ID for the preview container
        const safeVal = safe(value);
        return `
            <div style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">${label}</label>
                    <button type="button" class="btn icon-btn toggle-preview" data-target="${id}" style="font-size: 10px; padding: 2px 6px;">Preview</button>
                </div>
                <!-- Editor -->
                <textarea id="${id}" style="flex: 1; font-family: inherit; resize: none; display: block;">${safeVal}</textarea>
                <!-- Preview (Hidden by default) -->
                <div id="${id}-preview" class="markdown-body" style="flex: 1; overflow-y: auto; display: none; padding: 8px; border: 1px solid var(--border); border-radius: 10px; background: rgba(255,255,255,0.03);"></div>
            </div>
        `;
    }

    // Bind Toggle Events
    form.querySelectorAll(".toggle-preview").forEach(btn => {
        btn.onclick = (e) => {
            const targetId = e.target.dataset.target;
            const textarea = form.querySelector(`#${targetId}`);
            const preview = form.querySelector(`#${targetId}-preview`);

            if (textarea.style.display !== "none") {
                // Switch to Preview
                preview.innerHTML = DOMPurify.sanitize(marked.parse(textarea.value), purifyConfig);
                textarea.style.display = "none";
                preview.style.display = "block";
                e.target.textContent = "Edit";
            } else {
                // Switch to Edit
                textarea.style.display = "block";
                preview.style.display = "none";
                e.target.textContent = "Preview";
            }
        };
    });

    detDialog.showModal();
}

console.log('[Webview] Sending initial board.load request');
post("board.load");

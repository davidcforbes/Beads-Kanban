// Webview side
const vscode = acquireVsCodeApi();

const boardEl = document.getElementById("board");
const refreshBtn = document.getElementById("refreshBtn");
const newBtn = document.getElementById("newBtn");
const repoMenuBtn = document.getElementById("repoMenuBtn");
const toastEl = document.getElementById("toast");

const detDialog = document.getElementById("detailDialog");
const detTitle = document.getElementById("detTitle");
const detDesc = document.getElementById("detDesc");
const detMeta = document.getElementById("detMeta");
const addToChatBtn = document.getElementById("addToChatBtn");
const copyContextBtn = document.getElementById("copyContextBtn");

const filterPriority = document.getElementById("filterPriority");
const filterType = document.getElementById("filterType");
const filterStatusBtn = document.getElementById("filterStatusBtn");
const filterStatusLabel = document.getElementById("filterStatusLabel");
const filterStatusDropdown = document.getElementById("filterStatusDropdown");
const filterSearch = document.getElementById("filterSearch");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");

// Custom status filter dropdown logic
function getSelectedStatuses() {
    if (!filterStatusDropdown) return [];
    const checkboxes = filterStatusDropdown.querySelectorAll('input[type="checkbox"]:checked');
    const values = Array.from(checkboxes).map(cb => cb.value).filter(v => v !== ''); // Filter out "All" (empty value)
    return values;
}

function updateStatusLabel() {
    if (!filterStatusLabel) return;
    const selected = getSelectedStatuses();
    if (selected.length === 0) {
        filterStatusLabel.textContent = 'Status: All';
    } else if (selected.length === 1) {
        // Capitalize first letter
        const status = selected[0].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        filterStatusLabel.textContent = `Status: ${status}`;
    } else {
        filterStatusLabel.textContent = `Status: ${selected.length} selected`;
    }
}

// Toggle dropdown on button click
if (filterStatusBtn && filterStatusDropdown) {
    filterStatusBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        filterStatusDropdown.classList.toggle('hidden');
    });

    // Update label and trigger filter when checkbox changes
    filterStatusDropdown.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const allCheckbox = filterStatusDropdown.querySelector('input[value=""]');

            if (checkbox.value === '') {
                // "All" checkbox was clicked
                if (checkbox.checked) {
                    // Uncheck all other checkboxes
                    filterStatusDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                        if (cb.value !== '') cb.checked = false;
                    });
                }
            } else {
                // A specific status checkbox was clicked
                if (checkbox.checked) {
                    // Uncheck "All"
                    if (allCheckbox) allCheckbox.checked = false;
                } else {
                    // If no checkboxes are checked, check "All"
                    const anyChecked = Array.from(filterStatusDropdown.querySelectorAll('input[type="checkbox"]'))
                        .some(cb => cb.value !== '' && cb.checked);
                    if (!anyChecked && allCheckbox) {
                        allCheckbox.checked = true;
                    }
                }
            }

            updateStatusLabel();
            render();
        });
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!filterStatusDropdown.contains(e.target) && e.target !== filterStatusBtn) {
            filterStatusDropdown.classList.add('hidden');
        }
    });

    // Prevent dropdown from closing when clicking inside it
    filterStatusDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });
}

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
let readOnly = false; // Read-only mode flag from extension
let detailDirty = false;

// Phase 2: Client-side card cache for fast filtering/sorting
// Maps card ID to card data (MinimalCard, EnrichedCard, or FullCard)
const cardCache = new Map();

// Track which tier each card is loaded to: 'minimal' | 'enriched' | 'full'
// This prevents redundant loads when we already have the data
const cardStateLevel = new Map();

// Table view pagination state (server-side)
let tablePaginationState = {
    currentPage: 0,
    pageSize: 100, // Configurable page size
    totalCount: 0,
    cards: [],
    loading: false
};

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
function showLoading(message = 'Loading...') {
    activeRequests++;
    const loader = document.getElementById('loadingOverlay');
    const loaderText = document.getElementById('loadingText');
    if (loader) {
        loader.classList.remove('hidden');
    }
    if (loaderText) {
        loaderText.textContent = message;
    }
}

function hideLoading() {
    activeRequests = Math.max(0, activeRequests - 1);
    if (activeRequests === 0) {
        const loader = document.getElementById('loadingOverlay');
        if (loader) {
            loader.classList.add('hidden');
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

// Safe function for HTML attributes - escapes quotes and special chars
function safe(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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

// Periodic cleanup for stale requests (prevents memory leak if extension becomes unresponsive)
setInterval(() => {
    const now = Date.now();
    const MAX_REQUEST_AGE = 60000; // 60 seconds
    let cleanedCount = 0;

    for (const [reqId, { timeoutId, createdAt }] of pendingRequests.entries()) {
        if (createdAt && now - createdAt > MAX_REQUEST_AGE) {
            clearTimeout(timeoutId);
            pendingRequests.delete(reqId);
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        console.log(`[Cleanup] Removed ${cleanedCount} stale request(s) older than 60s`);
    }
}, 10000); // Run cleanup every 10 seconds

function requestId() {
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Post with promise support
function postAsync(type, payload, loadingMessage = 'Loading...') {
    showLoading(loadingMessage);
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

        // Store resolve, reject, timeoutId, and createdAt in the Map
        // This allows response handlers to clear the timeout properly and periodic cleanup
        pendingRequests.set(reqId, { resolve, reject, timeoutId, createdAt: Date.now() });
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

// Phase 2: In-memory filtering over cardCache
// Returns filtered array of cards based on current filter values
// Performance target: <16ms for 10,000 cards
function getFilteredCards() {
    const pVal = filterPriority?.value || "";
    const tVal = filterType?.value || "";
    const sVal = filterSearch?.value?.toLowerCase()?.trim() || "";
    
    // Get selected status values from custom dropdown
    const selectedStatuses = getSelectedStatuses();

    
    // If no filters, return all cards from cache
    if (!pVal && !tVal && !sVal && selectedStatuses.length === 0) {
        return Array.from(cardCache.values());
    }
    
    // Filter cards in memory
    const filtered = [];
    for (const card of cardCache.values()) {
        // Priority filter
        if (pVal !== "" && card.priority !== parseInt(pVal)) {
            continue;
        }
        
        // Type filter
        if (tVal !== "" && card.issue_type !== tVal) {
            continue;
        }
        
        // Status filter (multi-select)
        // Filter by actual database status, not visual column mapping
        if (selectedStatuses.length > 0) {
            if (!selectedStatuses.includes(card.status)) {
                continue;
            }
        }
        
        // Search filter (title, description, ID, or labels)
        if (sVal !== "") {
            const titleMatch = card.title.toLowerCase().includes(sVal);
            const descMatch = card.description && card.description.toLowerCase().includes(sVal);
            const idMatch = card.id.toLowerCase().includes(sVal);
            const labelMatch = card.labels && card.labels.some(label => label.toLowerCase().includes(sVal));
            
            if (!titleMatch && !descMatch && !idMatch && !labelMatch) {
                continue;
            }
        }
        
        filtered.push(card);
    }
    

    return filtered;
}

// Phase 2: In-memory sorting
// Takes array of cards and sorts by specified field and direction
// Performance target: <16ms for 10,000 cards
// sortBy: 'updated_at' | 'created_at' | 'priority' | 'title' | 'status' (default: 'updated_at')
// sortDir: 'asc' | 'desc' (default: 'desc')
function getSortedCards(cards, sortBy = 'updated_at', sortDir = 'desc') {
    if (!cards || cards.length === 0) {
        return [];
    }
    
    const sorted = [...cards]; // Copy to avoid mutating input
    
    sorted.sort((a, b) => {
        let aVal, bVal;
        
        switch (sortBy) {
            case 'priority':
                aVal = a.priority ?? 2; // Default to medium priority
                bVal = b.priority ?? 2;
                break;
            
            case 'title':
                aVal = (a.title || '').toLowerCase();
                bVal = (b.title || '').toLowerCase();
                return sortDir === 'asc' 
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            
            case 'status':
                aVal = a.status || '';
                bVal = b.status || '';
                return sortDir === 'asc'
                    ? aVal.localeCompare(bVal)
                    : bVal.localeCompare(aVal);
            
            case 'created_at':
                aVal = new Date(a.created_at || 0).getTime();
                bVal = new Date(b.created_at || 0).getTime();
                break;
            
            case 'updated_at':
            default:
                aVal = new Date(a.updated_at || 0).getTime();
                bVal = new Date(b.updated_at || 0).getTime();
                break;
        }
        
        // Numeric comparison for dates and priority
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    
    return sorted;
}

// Phase 2: In-memory grouping by column
// Takes array of cards and groups them into columns
// Performance target: <16ms for 10,000 cards
// Returns: { ready: [], in_progress: [], blocked: [], closed: [] }
function getCardsByColumn(cards) {
    const byColumn = {
        ready: [],
        in_progress: [],
        blocked: [],
        closed: []
    };
    
    if (!cards || cards.length === 0) {
        return byColumn;
    }
    
    for (const card of cards) {
        const col = columnForCard(card);
        if (byColumn[col]) {
            byColumn[col].push(card);
        }
    }
    
    return byColumn;
}

// Dispatch to the appropriate render function based on view mode
function render() {

    if (!columns || columns.length === 0) {

        return;
    }

    // Update UI based on read-only mode
    if (readOnly) {
        newBtn.style.display = 'none'; // Hide New Issue button

        // Show read-only banner if not already present
        if (!document.getElementById('readOnlyBanner')) {
            const banner = document.createElement('div');
            banner.id = 'readOnlyBanner';
            banner.style.cssText = 'background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-inputValidation-warningForeground); padding: 12px; text-align: center; font-weight: 600; margin-bottom: 12px; border-radius: 6px; border: 1px solid var(--vscode-inputValidation-warningBorder);';
            banner.textContent = '📖 Read-Only Mode - Viewing only, changes are disabled';
            boardEl.parentElement.insertBefore(banner, boardEl);
        }
    } else {
        newBtn.style.display = ''; // Show New Issue button

        // Remove read-only banner if present
        const banner = document.getElementById('readOnlyBanner');
        if (banner) {
            banner.remove();
        }
    }

    // Reset table pagination when filters/sort changes (user likely wants to see results from page 1)
    tablePaginationState.currentPage = 0;

    if (viewMode === 'table') {
        renderTable();
    } else {
        renderKanban();
    }
}

// Kanban view rendering
function renderKanban() {


    // Phase 2: Use in-memory filtering, sorting, and grouping over cardCache
    // This provides instant UI updates without server round-trips
    const filtered = getFilteredCards();
    const sorted = getSortedCards(filtered, 'updated_at', 'desc'); // Sort by most recently updated
    const byCol = getCardsByColumn(sorted);
    

    
    // Legacy filtering for backward compatibility when cardCache is not populated
    // This handles the case where board.load (old path) is used instead of board.loadMinimal
    if (cardCache.size === 0) {

        const pVal = filterPriority.value;
        const tVal = filterType.value;
        const sVal = filterSearch.value.toLowerCase();
        
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
    }


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
        const hasActiveFilters = filterPriority.value || filterType.value || getSelectedStatuses().length > 0 || filterSearch.value;

        if (colState && colState.totalCount > colState.cards.length) {
            // Partial load: show "filtered (loaded / total)"
            if (hasActiveFilters && filteredCount !== colState.cards.length) {
                countDiv.textContent = `${filteredCount} matches (${colState.cards.length} / ${colState.totalCount} loaded)`;
                countDiv.setAttribute('title', `${filteredCount} cards match filters out of ${colState.cards.length} loaded (${colState.totalCount} total in this column)`);
            } else {
                countDiv.textContent = `${colState.cards.length} / ${colState.totalCount} loaded`;
                countDiv.setAttribute('title', `${colState.cards.length} cards loaded out of ${colState.totalCount} total in this column`);
            }
        } else if (colState && colState.totalCount > 0) {
            // Fully loaded: show "filtered / total"
            if (hasActiveFilters && filteredCount !== colState.totalCount) {
                countDiv.textContent = `${filteredCount} matches of ${colState.totalCount}`;
                countDiv.setAttribute('title', `${filteredCount} cards match filters out of ${colState.totalCount} total in this column`);
            } else {
                countDiv.textContent = `${colState.totalCount}`;
                countDiv.setAttribute('title', `${colState.totalCount} cards in this column`);
            }
        } else {
            // Legacy or no data
            countDiv.textContent = filteredCount;
            countDiv.setAttribute('title', `${filteredCount} cards in this column`);
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
            disabled: readOnly, // Disable drag-and-drop in read-only mode
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

        // Performance optimization: Use DocumentFragment for batch DOM operations
        // This prevents reflow/repaint for each card, significantly improving render time for large datasets
        const fragment = document.createDocumentFragment();

        for (const card of (byCol[col.key] || [])) {
            const el = document.createElement("div");
            el.className = "card";
            el.dataset.id = card.id;

            // Accessibility: Make cards keyboard-navigable
            el.setAttribute('tabindex', '0');
            el.setAttribute('role', 'button');
            el.setAttribute('aria-label', `Issue: ${escapeHtml(card.title)}`);

            el.addEventListener("click", () => openDetail(card));

            // Keyboard navigation: Enter and Space to open detail
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    openDetail(card);
                }
            });

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

            fragment.appendChild(el);
        }

        // Single DOM operation: append all cards at once
        dropZone.appendChild(fragment);

        // Add loading spinner if column is loading
        // colState already declared at line 536
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
                    await postAsync('board.loadMore', { column: col.key }, 'Loading more issues...');
                } catch (error) {

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

// Load table page from server with filters and sorting
// Phase 2: In-memory table pagination using cardCache
// No server requests - instant filtering, sorting, and pagination
function loadTablePage(page = null) {
    if (page !== null) {
        tablePaginationState.currentPage = page;
    }



    // Get filtered cards from cache (uses same filters as Kanban view)
    let filteredCards = getFilteredCards();
    
    // Apply table-specific filters (if any)
    if (tableState.filters.status && tableState.filters.status !== '') {
        filteredCards = filteredCards.filter(card => card.status === tableState.filters.status);
    }
    if (tableState.filters.assignee && tableState.filters.assignee !== '') {
        filteredCards = filteredCards.filter(card => card.assignee === tableState.filters.assignee);
    }
    if (tableState.filters.labels && tableState.filters.labels.length > 0) {
        filteredCards = filteredCards.filter(card => 
            card.labels && tableState.filters.labels.some(label => card.labels.includes(label))
        );
    }

    // Sort cards using in-memory sort (handle multi-column sorting)
    let sortedCards = filteredCards;
    if (tableState.sorting.length > 0) {
        // Use first sort column (primary sort)
        const primarySort = tableState.sorting[0];
        sortedCards = getSortedCards(filteredCards, primarySort.id, primarySort.dir);
    } else {
        // Default sort by updated_at descending
        sortedCards = getSortedCards(filteredCards, 'updated_at', 'desc');
    }

    // Calculate pagination
    const totalCount = sortedCards.length;
    const offset = tablePaginationState.currentPage * tablePaginationState.pageSize;
    const limit = tablePaginationState.pageSize;
    
    // Slice for current page
    const pageCards = sortedCards.slice(offset, offset + limit);

    // Update state
    tablePaginationState.cards = pageCards;
    tablePaginationState.totalCount = totalCount;
    tablePaginationState.loading = false;


    return true;
}

// Table view rendering (synchronous - uses in-memory cardCache)
function renderTable() {


    // Load current page from cardCache with filters and sorting (instant)
    const success = loadTablePage();
    if (!success) {
        // Error already displayed by loadTablePage
        return;
    }

    const tableRows = tablePaginationState.cards;
    const totalCount = tablePaginationState.totalCount;
    const totalPages = Math.ceil(totalCount / tablePaginationState.pageSize);
    const currentPage = tablePaginationState.currentPage;
    const startIdx = currentPage * tablePaginationState.pageSize;
    const endIdx = Math.min(startIdx + tablePaginationState.pageSize, totalCount);



    // Get visible columns (respecting user preferences)
    let visibleColumns = tableColumns.filter(col => {
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

    // Build table HTML with pagination controls in header
    let tableHtml = `
        <div class="table-view">
            <div class="table-controls">
                <div class="table-controls-left">
                    <label for="pageSizeSelect">Rows per page:</label>
                    <select id="pageSizeSelect" class="page-size-select">
                        <option value="25" ${tablePaginationState.pageSize === 25 ? 'selected' : ''}>25</option>
                        <option value="50" ${tablePaginationState.pageSize === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${tablePaginationState.pageSize === 100 ? 'selected' : ''}>100</option>
                        <option value="250" ${tablePaginationState.pageSize === 250 ? 'selected' : ''}>250</option>
                        <option value="500" ${tablePaginationState.pageSize === 500 ? 'selected' : ''}>500</option>
                    </select>
                    <span class="pagination-info">Showing ${startIdx + 1}-${endIdx} of ${totalCount} rows</span>
                </div>
                <div class="table-controls-right">
                    ${totalPages > 1 ? `
                        <button class="btn pagination-btn" id="tablePrevPage" ${currentPage === 0 ? 'disabled' : ''}>Previous</button>
                        <span class="pagination-info">Page ${currentPage + 1} of ${totalPages}</span>
                        <button class="btn pagination-btn" id="tableNextPage" ${currentPage >= totalPages - 1 ? 'disabled' : ''}>Next</button>
                    ` : ''}
                </div>
            </div>
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

    // Render all rows (already paginated server-side)
    for (const card of tableRows) {
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

    // Add page size selector handler
    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            tablePaginationState.pageSize = parseInt(e.target.value);
            tablePaginationState.currentPage = 0; // Reset to first page
            renderTable();
        });
    }

    // Add pagination button handlers (buttons are now in header)
    if (totalPages > 1) {
        const prevBtn = document.getElementById('tablePrevPage');
        const nextBtn = document.getElementById('tableNextPage');
        
        if (prevBtn) {
            prevBtn.addEventListener('click', () => {
                if (tablePaginationState.currentPage > 0) {
                    tablePaginationState.currentPage--;
                    renderTable();
                }
            });
        }
        
        if (nextBtn) {
            nextBtn.addEventListener('click', () => {
                if (tablePaginationState.currentPage < totalPages - 1) {
                    tablePaginationState.currentPage++;
                    renderTable();
                }
            });
        }
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
        row.setAttribute('tabindex', '0');
        row.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                row.click();
            }
        });
    }

    // Add copy handlers for ID cells
    const idCells = boardEl.querySelectorAll('.copy-id');
    for (const cell of idCells) {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', (e) => {
            e.stopPropagation();
            const fullId = cell.dataset.fullId;
            post('issue.copyToClipboard', { text: fullId });
            toast(`Copied: ${fullId.slice(-8)}`);
        });
    }


}

// Handle column sorting
function handleColumnSort(columnId, isShiftKey) {

    
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
    

    // Reset to first page when sorting changes (for table view server-side pagination)
    tablePaginationState.currentPage = 0;
    saveState();
    render();
}

// Removed duplicate escapeHtml function - using the DOM-based implementation at line ~284 instead

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

repoMenuBtn.addEventListener("click", () => {
    post("repo.select");
    toast("Opening repository selector...");
});

// Create debounced render function for filter changes (300ms delay)
const debouncedRender = debounce(render, 300);

filterPriority.addEventListener("change", render); // Immediate for dropdown
filterType.addEventListener("change", render); // Immediate for dropdown
// Status filter now handled by custom dropdown logic above
filterSearch.addEventListener("input", debouncedRender); // Debounced for text input

// Clear all filters
clearFiltersBtn.addEventListener("click", () => {
    filterPriority.value = '';
    filterType.value = '';
    // Clear all status checkboxes and check "All"
    filterStatusDropdown.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        if (cb.value === '') {
            cb.checked = true; // Check "All"
        } else {
            cb.checked = false; // Uncheck all others
        }
    });
    updateStatusLabel();
    filterSearch.value = '';
    render();
});

// Keyboard shortcuts
document.addEventListener("keydown", (e) => {
    // Detect platform-specific modifier key
    const modKey = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    
    // Ignore shortcuts when typing in input fields (except Escape)
    const isTyping = e.target.tagName === 'INPUT' || 
                     e.target.tagName === 'TEXTAREA' || 
                     e.target.isContentEditable;
    
    // Escape: Close detail dialog
    if (e.key === 'Escape' && detDialog.open) {
        e.preventDefault();
        requestDetailClose();
        return;
    }
    
    // Don't trigger other shortcuts while typing (unless it's Escape)
    if (isTyping && e.key !== 'Escape') {
        // Allow Ctrl/Cmd+F even in input fields to focus search
        if (modKey && e.key.toLowerCase() === 'f') {
            // Continue to handler below
        } else {
            return;
        }
    }
    
    // Ctrl/Cmd+R: Refresh board
    if (modKey && e.key.toLowerCase() === 'r') {
        e.preventDefault();
        post("board.refresh");
        toast("Refreshing board...");
        return;
    }
    
    // Ctrl/Cmd+N: New issue
    if (modKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newBtn.click();
        return;
    }
    
    // Ctrl/Cmd+F: Focus search
    if (modKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        filterSearch.focus();
        filterSearch.select();
        return;
    }
});

window.addEventListener("message", (event) => {

    const msg = event.data;
    if (!msg || !msg.type) {

        return;
    }


    // Handle cleanup message from extension (for proper disposal)
    if (msg.type === "webview.cleanup") {
        cleanupPendingRequests();
        return;
    }

    if (msg.type === "board.data") {

        
        // Support both legacy flat cards array and new columnData structure
        if (msg.payload.columnData) {
            // New incremental loading format

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
        readOnly = msg.payload.readOnly || false; // Extract read-only flag

        render();
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

    // Phase 2: Handle board.minimal response (fast loading with MinimalCard[])
    if (msg.type === "board.minimal") {

        
        const cards = msg.payload.cards || [];
        
        // Initialize columns with default kanban columns
        columns = [
            { key: "ready", title: "Ready" },
            { key: "in_progress", title: "In Progress" },
            { key: "blocked", title: "Blocked" },
            { key: "closed", title: "Closed" }
        ];
        
        // Phase 2: Populate cardCache with all MinimalCard data
        cardCache.clear();
        cardStateLevel.clear();
        for (const card of cards) {
            cardCache.set(card.id, card);
            cardStateLevel.set(card.id, 'minimal');
        }

        
        // Initialize columnState by distributing cards into columns
        for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
            columnState[col] = {
                cards: [],
                offset: 0,
                totalCount: 0,
                hasMore: false,
                loading: false
            };
        }
        
        // Distribute cards into appropriate columns
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
        
        // Maintain backward compatibility with boardData
        boardData = {
            columns: columns,
            cards: cards
        };
        
        render();
        hideLoading();
        
        // Resolve any pending request waiting for board data
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

    if (msg.type === "board.columnData") {

        const { column, cards, offset, totalCount, hasMore } = msg.payload;
        
        if (!columnState[column]) {

            return;
        }
        
        // Update specific column
        if (offset === 0) {
            // Replace cards (refresh)

            columnState[column].cards = cards;
        } else {
            // Append cards (loading more)

            columnState[column].cards = [...columnState[column].cards, ...cards];
        }
        
        columnState[column].offset = offset + cards.length;
        columnState[column].totalCount = totalCount;
        columnState[column].hasMore = hasMore;
        columnState[column].loading = false;
        

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

    if (msg.type === "table.pageData") {

        
        // Resolve pending request with the payload
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { resolve, timeoutId } = pendingRequests.get(msg.requestId);
            // Clear timeout immediately
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            resolve(msg);  // Resolve with the full message so loadTablePage can check response.type
        }
        return;
    }

    // Phase 2: Handle issue.full response (full card details)
    if (msg.type === "issue.full") {

        
        // Resolve pending request with the full message
        if (msg.requestId && pendingRequests.has(msg.requestId)) {
            const { resolve, timeoutId } = pendingRequests.get(msg.requestId);
            // Clear timeout immediately
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            pendingRequests.delete(msg.requestId);
            resolve(msg);  // Resolve with the full message so loadFullIssue can check response.type
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

// Phase 2: Load full issue details on-demand
// Checks cardStateLevel and only loads from server if needed
// Returns: Promise<FullCard>
async function loadFullIssue(issueId) {
    if (!issueId) {
        throw new Error('Issue ID is required');
    }
    
    // Check if we already have full details in cache
    const currentLevel = cardStateLevel.get(issueId);
    if (currentLevel === 'full') {

        return cardCache.get(issueId);
    }
    

    
    try {
        // Request full issue details from extension
        const response = await postAsync('issue.getFull', { id: issueId }, 'Loading issue details...');
        
        if (response.type === 'issue.full' && response.payload?.card) {
            const fullCard = response.payload.card;
            
            // Update cache with full card data
            cardCache.set(issueId, fullCard);
            cardStateLevel.set(issueId, 'full');
            

            return fullCard;
        } else {
            throw new Error('Unexpected response type: ' + response.type);
        }
    } catch (error) {

        toast('Failed to load issue details: ' + error.message);
        throw error;
    }
}

async function openDetail(card) {

    if (!card) return;

    // Phase 2: Load full issue details if editing existing issue
    const isCreateMode = card.id === null;
    if (!isCreateMode) {
        try {
            // Load full details from server or cache
            const fullCard = await loadFullIssue(card.id);
            // Use full card data for the rest of the function
            card = fullCard;
        } catch (error) {
            // Error already displayed by loadFullIssue()
            return;
        }
    }

    // We will dynamically rebuild the form content to support editing
    const form = detDialog.querySelector("form");

    // Helper to safe string
    const safe = (s) => escapeHtml(s || "");

    // Helper to format dependency: last 20 chars of ID + ": " + Title
    const formatDep = (dep) => {
        const idSuffix = dep.id ? dep.id.slice(-20) : '';
        const title = dep.title || '';
        return `${escapeHtml(idSuffix)}: ${escapeHtml(title)}`;
    };

    const statusOptions = [
        { v: "open", l: "Open" },
        { v: "in_progress", l: "In Progress" },
        { v: "blocked", l: "Blocked" },
        { v: "closed", l: "Closed" }
    ];

    const typeOptions = ["task", "bug", "feature", "epic", "chore"];
    const priorityOptions = [0, 1, 2, 3, 4];

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
                                <div style="display: flex; gap: 4px; max-width: 100%; width: 100%; box-sizing: border-box;">
                                    <input id="newParentId" type="text" placeholder="Parent Issue ID" list="${issueOptionsId}" style="flex: 1; margin: 0; font-size: 12px; padding: 4px; min-width: 0; max-width: 100%; box-sizing: border-box;" />
                                    <button id="btnSetParent" class="btn" style="padding: 2px 8px; flex-shrink: 0;">Set</button>
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
                          <div style="display: flex; gap: 4px; max-width: 100%; width: 100%; box-sizing: border-box;">
                                <input id="newBlockerId" type="text" placeholder="Blocker Issue ID" list="${issueOptionsId}" style="flex: 1; margin: 0; font-size: 12px; padding: 4px; min-width: 0; max-width: 100%; box-sizing: border-box;" />
                                <button id="btnAddBlocker" class="btn" style="padding: 2px 8px; flex-shrink: 0;">Add</button>
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
                                  <li>
                                      ${formatDep(c)}
                                      <span class="remove-child" data-id="${escapeHtml(c.id)}" style="cursor: pointer; color: var(--error); margin-left: 4px;">&times;</span>
                                  </li>
                              `).join('')}
                            </ul>
                          ` : '<div style="font-size: 11px; font-style: italic; color: var(--muted); margin-bottom: 4px;">None</div>'}
                          <div style="display: flex; gap: 4px; max-width: 100%; width: 100%; box-sizing: border-box;">
                                <input id="newChildId" type="text" placeholder="Child Issue ID" list="${issueOptionsId}" style="flex: 1; margin: 0; font-size: 12px; padding: 4px; min-width: 0; max-width: 100%; box-sizing: border-box;" />
                                <button id="btnAddChild" class="btn" style="padding: 2px 8px; flex-shrink: 0;">Add</button>
                          </div>
    `;
    
    form.innerHTML = `
        <div class="form-container">
            <h3 class="form-section-header">${isCreateMode ? 'Create New Issue' : `Edit Issue <span style="color: var(--muted); font-weight: normal; font-size: 14px;">${escapeHtml(card.id)}</span>`}</h3>
            
            <!-- Row 1: Title -->
            <div class="form-row">
                <label class="form-label">Title:</label>
                <input id="editTitle" type="text" value="${safe(card.title)}" class="form-input-title" />
            </div>

            <!-- Row 2: Status, Type, Priority, Assignee -->
            <div class="form-row-multi">
                <div class="form-group">
                    <label class="form-label">Status:</label>
                    <select id="editStatus" class="form-input-inline">
                        ${statusOptions.map(o => `<option value="${o.v}" ${card.status === o.v ? 'selected' : ''}>${o.l}</option>`).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Type:</label>
                    <select id="editType" class="form-input-inline">
                        ${typeOptions.map(t => `<option value="${t}" ${card.issue_type === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                
                <div class="form-group">
                    <label class="form-label">Priority:</label>
                    <select id="editPriority" class="form-input-inline">
                        ${priorityOptions.map(p => `<option value="${p}" ${card.priority === p ? 'selected' : ''}>P${p}</option>`).join('')}
                    </select>
                </div>
                
                <div class="form-group-large">
                    <label class="form-label">Assignee:</label>
                    <input id="editAssignee" type="text" value="${safe(card.assignee)}" placeholder="Unassigned" class="form-input-inline" />
                </div>
            </div>

            <!-- Row 3: Est. Minutes, Due At, Defer Until -->
            <div class="form-row-multi">
                <div class="form-group">
                    <label class="form-label">Est. Minutes:</label>
                    <input id="editEst" type="number" value="${card.estimated_minutes || ''}" placeholder="Min" class="form-input-inline" />
                </div>

                <div class="form-group">
                    <label class="form-label">Due At:</label>
                    <input id="editDueAt" type="datetime-local" value="${toLocalDateTimeInput(card.due_at)}" class="form-input-inline" />
                </div>

                <div class="form-group">
                    <label class="form-label">Defer Until:</label>
                    <input id="editDeferUntil" type="datetime-local" value="${toLocalDateTimeInput(card.defer_until)}" class="form-input-inline" />
                </div>
            </div>

            <!-- Row 4: Tags -->
            <div style="margin-top: 8px;">
                <label class="form-label-small">Tags</label>
                <div class="labels-container" style="display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px 0;">
                    ${(card.labels || []).map(l => `
                        <span class="badge" style="background: var(--bg2); padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; gap: 4px;">
                            #${escapeHtml(l)}
                            <span class="remove-label" data-label="${escapeHtml(l)}" style="cursor: pointer; opacity: 0.7;">&times;</span>
                        </span>
                    `).join('')}
                </div>
                <div style="display: flex; gap: 4px;">
                    <input id="newLabel" type="text" placeholder="Add tag..." style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                    <button id="btnAddLabel" class="btn" style="padding: 2px 8px;">+</button>
                </div>
            </div>

            <!-- Row 5: Flags -->
            <div style="margin-top: 8px;">
                <label class="form-label-small">Flags</label>
                <div style="display: flex; gap: 12px; margin-top: 4px; flex-wrap: wrap;">
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px;">
                        <input type="checkbox" id="editPinned" ${card.pinned ? 'checked' : ''} style="cursor: pointer;" />
                        📌 Pinned
                    </label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px;">
                        <input type="checkbox" id="editTemplate" ${card.is_template ? 'checked' : ''} style="cursor: pointer;" />
                        📄 Template
                    </label>
                    <label style="display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px;">
                        <input type="checkbox" id="editEphemeral" ${card.ephemeral ? 'checked' : ''} style="cursor: pointer;" />
                        ⏱ Ephemeral
                    </label>
                </div>
            </div>

            <!-- Row 6: Ext Ref -->
            <div class="form-row-wide-label">
                <label class="form-label">Ext Ref:</label>
                <input id="editExtRef" type="text" value="${safe(card.external_ref)}" placeholder="JIRA-123" class="form-input-full" />
            </div>

            <hr class="form-hr">

            <div class="markdown-fields-container">
                ${createMarkdownField("Description", "editDesc", card.description)}
                ${createMarkdownField("Acceptance Criteria", "editAC", card.acceptance_criteria)}
                ${createMarkdownField("Design Notes", "editDesign", card.design)}
                ${createMarkdownField("Notes", "editNotes", card.notes)}
            </div>

            <!-- Relationships -->
            <div style="margin-top: 12px; border-top: 1px solid var(--border); padding-top: 12px;">
                <div id="structureSection">
                    ${renderStructureSection()}
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
                            <div class="markdown-body" style="font-size: 13px;">${safeRenderMarkdown(c.text)}</div>
                        </div>
                    `).join('') : '<div style="font-size: 12px; color: var(--muted); font-style: italic;">No comments yet.</div>'}
                </div>
                
                <div style="display: flex; gap: 8px;">
                    <textarea id="newCommentText" rows="2" placeholder="Write a comment..." style="flex: 1; resize: vertical; margin: 0;"></textarea>
                    <button type="button" id="btnPostComment" class="btn" style="align-self: flex-start; height: auto;">Post</button>
                </div>
                ${isCreateMode ? '<div style="font-size: 10px; color: var(--muted); margin-top: 6px;">Comments will be added after issue creation.</div>' : ''}
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
            <div style="font-size: 10px; color: var(--muted); text-align: right; margin-top: 8px; display: flex; gap: 12px; justify-content: flex-end; flex-wrap: wrap;">
               <span>ID: ${isCreateMode ? 'Assigned on create' : escapeHtml(card.id)}</span>
               <span>Created: ${isCreateMode ? 'Not yet created' : new Date(card.created_at).toLocaleString()}</span>
               <span>Updated: ${isCreateMode ? 'Not yet created' : new Date(card.updated_at).toLocaleString()}</span>${!isCreateMode && card.closed_at ? `<span>Closed: ${new Date(card.closed_at).toLocaleString()}</span>` : ''}
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
        "editNotes",
        "editPinned",
        "editTemplate",
        "editEphemeral"
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
            notes: document.getElementById("editNotes").value,
            pinned: document.getElementById("editPinned").checked,
            is_template: document.getElementById("editTemplate").checked,
            ephemeral: document.getElementById("editEphemeral").checked
        };
        
        // In create mode, include labels, parent, blockers, and children
        if (isCreateMode) {
            if (card.labels && card.labels.length > 0) {
                data.labels = card.labels;
            }
            if (card.parent) {
                data.parent_id = card.parent.id;
            }
            if (card.blocked_by && card.blocked_by.length > 0) {
                data.blocked_by_ids = card.blocked_by.map(b => b.id);
            }
            if (card.children && card.children.length > 0) {
                data.children_ids = card.children.map(c => c.id);
            }
        }

        if (data.title) {
            try {
                if (isCreateMode) {
                    // Create new issue
                    const createResponse = await postAsync("issue.create", data, "Creating issue...");
                    const newIssueId = createResponse?.payload?.id;
                    
                    // Post any comments that were added in create mode
                    let failedComments = 0;
                    if (newIssueId && card.comments && card.comments.length > 0) {
                        for (const comment of card.comments) {
                            try {
                                await postAsync("issue.addComment", {
                                    id: newIssueId,
                                    text: comment.text,
                                    author: comment.author
                                }, "Adding comment...");
                            } catch (commentErr) {
                                // Track failed comments but don't fail the whole operation
                                failedComments++;
                                console.error(`Failed to post comment: ${commentErr.message}`);
                            }
                        }
                    }

                    // Show appropriate success/warning message
                    if (failedComments > 0) {
                        toast(`Issue created, but ${failedComments} comment(s) failed to post`);
                    } else {
                        toast("Issue created successfully");
                    }
                } else {
                    // Update existing issue
                    await postAsync("issue.update", { id: card.id, updates: data }, "Saving changes...");
                    toast("Changes saved successfully");
                }
                detailDirty = false;
                detDialog.close();
            } catch (err) {
                // Show error feedback (mutation.error toast or timeout/network error)

                toast(`Failed to ${isCreateMode ? 'create issue' : 'save changes'}: ${err.message}`);
            }
        } else {
            toast("Title is required");
        }
    };

    /**
     * Safely render markdown with size limits to prevent DoS
     * @param {string} text - The markdown text to render
     * @returns {string} - Sanitized HTML or error message if too large
     */
    function safeRenderMarkdown(text) {
        const MAX_MARKDOWN_SIZE = 100000; // 100KB limit
        if (!text) return '';
        if (text.length > MAX_MARKDOWN_SIZE) {
            return `<div class="error" style="color: var(--error); padding: 8px; background: rgba(255,0,0,0.1); border-radius: 4px;">
                Content too large to display (${Math.round(text.length / 1024)}KB). Maximum size: ${Math.round(MAX_MARKDOWN_SIZE / 1024)}KB.
            </div>`;
        }
        return DOMPurify.sanitize(marked.parse(text), purifyConfig);
    }

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
                <div class="markdown-body" style="font-size: 13px;">${safeRenderMarkdown(c.text)}</div>
            </div>
        `).join('');
    }

    function refreshCommentsDisplay() {
        const list = form.querySelector("#commentsList");
        if (!list) return;
        list.innerHTML = renderCommentsList();
    }

    const btnPostComment = form.querySelector("#btnPostComment");
    if (btnPostComment) {
        btnPostComment.onclick = async (e) => {
            e.preventDefault();
            const commentInput = form.querySelector("#newCommentText");
            const text = commentInput.value.trim();
            if (!text) return;

            if (isCreateMode) {
                // In create mode, just add to local array
                if (!card.comments) card.comments = [];
                card.comments.push({
                    id: Date.now(),
                    issue_id: null, // Will be set after creation
                    author: "Me",
                    text,
                    created_at: new Date().toISOString()
                });
                commentInput.value = "";
                refreshCommentsDisplay();
                toast("Comment added (will be posted on save)");
            } else {
                // In edit mode, call API
                try {
                    await postAsync("issue.addComment", { id: card.id, text, author: "Me" }, "Adding comment...");
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
    
                    toast(`Failed to add comment: ${err.message}`);
                }
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
        labelsContainer.querySelectorAll(".remove-label").forEach(btn => {
            btn.onclick = async (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Use currentTarget instead of target to ensure we get the .remove-label element
                const label = e.currentTarget.dataset.label;
                if (isCreateMode) {
                    // In create mode, just remove from local array
                    card.labels = (card.labels || []).filter(l => l !== label);
                    refreshLabelsDisplay();
                    toast("Label removed");
                } else {
                    // In edit mode, call API
                    try {
                        await postAsync("issue.removeLabel", { id: card.id, label }, "Removing label...");
                        // Update card.labels array
                        card.labels = (card.labels || []).filter(l => l !== label);
                        // Refresh the display
                        refreshLabelsDisplay();
                        toast("Label removed");
                        // Refresh board in background
                        postAsync("board.refresh", {}, "Refreshing board...");
                    } catch (err) {
        
                        toast(`Failed to remove label: ${err.message}`);
                    }
                }
            };
        });
    }

    // Label Events - supports comma-separated multiple labels
    const btnAddLabel = form.querySelector("#btnAddLabel");
    if (btnAddLabel) {
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

        if (isCreateMode) {
            // In create mode, just add to local array
            for (const label of labels) {
                if (!card.labels) card.labels = [];
                if (!card.labels.includes(label)) {
                    card.labels.push(label);
                    successCount++;
                }
            }
            toast(`Added ${successCount} label${successCount > 1 ? 's' : ''}`);
            input.value = ''; // Clear input
            refreshLabelsDisplay();
        } else {
            // In edit mode, call API for each label
            for (const label of labels) {
                try {
                    await postAsync("issue.addLabel", { id: card.id, label }, "Adding label...");
                    // Update card.labels array
                    if (!card.labels) card.labels = [];
                    if (!card.labels.includes(label)) {
                        card.labels.push(label);
                    }
                    successCount++;
                } catch (err) {
    
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
        }

        // Keep dialog open for adding more labels
    };
    }

    // Initialize remove handlers for existing labels
    refreshLabelsDisplay();

    async function refreshRelationshipsFromBoard() {
        if (!card.id) return;
        try {
            // Use issue.getFull to get the complete card with relationships
            const response = await postAsync("issue.getFull", { id: card.id }, "Refreshing relationships...");
            const updated = response?.payload?.card;
            if (updated) {
                card.parent = updated.parent;
                card.children = updated.children;
                card.blocks = updated.blocks;
                card.blocked_by = updated.blocked_by;
            }
        } catch (err) {
            console.error("Error refreshing relationships:", err);
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
        if (btnSetParent) {
            btnSetParent.onclick = async (e) => {
                e.preventDefault();
                const parentId = form.querySelector("#newParentId").value.trim();
                if (!parentId) return;
                
                if (isCreateMode) {
                    // In create mode, store parent locally
                    card.parent = { id: parentId, title: parentId }; // We'll display just the ID
                    form.querySelector("#newParentId").value = "";
                    toast("Parent set (will be applied on save)");
                    refreshStructureSection();
                } else {
                    // In edit mode, call API
                    try {
                        await postAsync("issue.addDependency", { id: card.id, otherId: parentId, type: 'parent-child' }, "Adding parent...");
                        toast("Parent set");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to set parent: ${err.message}`);
                    }
                }
            };
        }

        const removeParentBtn = form.querySelector("#removeParent");
        if (removeParentBtn) {
            removeParentBtn.onclick = async (e) => {
                if (isCreateMode) {
                    // In create mode, just remove from local object
                    card.parent = null;
                    toast("Parent unlinked");
                    refreshStructureSection();
                } else {
                    // In edit mode, call API
                    try {
                        await postAsync("issue.removeDependency", { id: card.id, otherId: card.parent.id, type: 'parent-child' }, "Removing parent...");
                        toast("Parent unlinked");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to remove parent: ${err.message}`);
                    }
                }
            };
        }

        const btnAddBlocker = form.querySelector("#btnAddBlocker");
        if (btnAddBlocker) {
            btnAddBlocker.onclick = async (e) => {
                e.preventDefault();
                const blockerId = form.querySelector("#newBlockerId").value.trim();
                if (!blockerId) return;
                
                if (isCreateMode) {
                    // In create mode, add to local array
                    if (!card.blocked_by) card.blocked_by = [];
                    if (!card.blocked_by.find(b => b.id === blockerId)) {
                        card.blocked_by.push({ id: blockerId, title: blockerId });
                        form.querySelector("#newBlockerId").value = "";
                        toast("Blocker added (will be applied on save)");
                        refreshStructureSection();
                    } else {
                        toast("Blocker already added");
                    }
                } else {
                    // In edit mode, call API
                    try {
                        await postAsync("issue.addDependency", { id: card.id, otherId: blockerId, type: 'blocks' }, "Adding blocker...");
                        toast("Blocker added");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to add blocker: ${err.message}`);
                    }
                }
            };
        }

        form.querySelectorAll(".remove-blocker").forEach(btn => {
            btn.onclick = async (e) => {
                const blockerId = e.target.dataset.id;
                
                if (isCreateMode) {
                    // In create mode, remove from local array
                    card.blocked_by = (card.blocked_by || []).filter(b => b.id !== blockerId);
                    toast("Blocker removed");
                    refreshStructureSection();
                } else {
                    // In edit mode, call API
                    try {
                        await postAsync("issue.removeDependency", { id: card.id, otherId: blockerId, type: 'blocks' }, "Removing blocker...");
                        toast("Blocker removed");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to remove blocker: ${err.message}`);
                    }
                }
            };
        });

        const btnAddChild = form.querySelector("#btnAddChild");
        if (btnAddChild) {
            btnAddChild.onclick = async (e) => {
                e.preventDefault();
                const childId = form.querySelector("#newChildId").value.trim();
                if (!childId) return;
                
                if (isCreateMode) {
                    // In create mode, add to local array
                    if (!card.children) card.children = [];
                    if (!card.children.find(c => c.id === childId)) {
                        card.children.push({ id: childId, title: childId });
                        form.querySelector("#newChildId").value = "";
                        toast("Child added (will be applied on save)");
                        refreshStructureSection();
                    } else {
                        toast("Child already added");
                    }
                } else {
                    // In edit mode, call API
                    // Note: To add a child from the parent side, we set the parent on the child
                    try {
                        await postAsync("issue.addDependency", { id: childId, otherId: card.id, type: 'parent-child' }, "Adding child...");
                        toast("Child added");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to add child: ${err.message}`);
                    }
                }
            };
        }

        form.querySelectorAll(".remove-child").forEach(btn => {
            btn.onclick = async (e) => {
                const childId = e.target.dataset.id;
                
                if (isCreateMode) {
                    // In create mode, remove from local array
                    card.children = (card.children || []).filter(c => c.id !== childId);
                    toast("Child removed");
                    refreshStructureSection();
                } else {
                    // In edit mode, call API
                    // To remove a child, we remove the parent relationship from the child
                    try {
                        await postAsync("issue.removeDependency", { id: childId, otherId: card.id, type: 'parent-child' }, "Removing child...");
                        toast("Child removed");
                        await refreshRelationshipsFromBoard();
                    } catch (err) {
        
                        toast(`Failed to remove child: ${err.message}`);
                    }
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
            <div class="markdown-field-wrapper">
                <div class="markdown-field-header">
                    <label class="form-label-small">${label}</label>
                    <button type="button" class="btn icon-btn toggle-preview" data-target="${id}" style="font-size: 10px; padding: 2px 6px;">Preview</button>
                </div>
                <!-- Editor -->
                <textarea id="${id}" class="markdown-field-editor">${safeVal}</textarea>
                <!-- Preview (Hidden by default) -->
                <div id="${id}-preview" class="markdown-body markdown-field-preview"></div>
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

    // Datetime inputs use native browser datepicker (no custom Save/Cancel buttons)

    detDialog.showModal();
}


post("board.loadMinimal");

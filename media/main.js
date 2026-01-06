// Webview side
const vscode = acquireVsCodeApi();

const boardEl = document.getElementById("board");
const refreshBtn = document.getElementById("refreshBtn");
const newBtn = document.getElementById("newBtn");
const toastEl = document.getElementById("toast");

const dialog = document.getElementById("newDialog");
const newTitle = document.getElementById("newTitle");
const newDesc = document.getElementById("newDesc");
const createConfirm = document.getElementById("createConfirm");

const detDialog = document.getElementById("detailDialog");
const detTitle = document.getElementById("detTitle");
const detDesc = document.getElementById("detDesc");
const detMeta = document.getElementById("detMeta");
const addToChatBtn = document.getElementById("addToChatBtn");
const copyContextBtn = document.getElementById("copyContextBtn");

const filterPriority = document.getElementById("filterPriority");
const filterType = document.getElementById("filterType");
const filterSearch = document.getElementById("filterSearch");

let boardData = null;
const collapsedColumns = new Set();

// Configure DOMPurify for safe HTML sanitization
const purifyConfig = {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'title', 'class'],
    ALLOW_DATA_ATTR: false
};

// Configure marked to use GFM breaks
if (typeof marked !== 'undefined') {
    marked.use({
        breaks: true,
        gfm: true
    });
}

function requestId() {
    return `req-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function post(type, payload) {
    vscode.postMessage({ type, requestId: requestId(), payload });
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

function render() {
    if (!boardData) return;
    if (!boardData.columns || !boardData.cards) {
        console.error('Invalid boardData: missing columns or cards');
        return;
    }

    const columns = boardData.columns;
    const cards = boardData.cards;

    // Filtering
    const pVal = filterPriority.value;
    const tVal = filterType.value;
    const sVal = filterSearch.value.toLowerCase();

    const filtered = cards.filter(c => {
        if (pVal !== "" && c.priority !== parseInt(pVal)) return false;
        if (tVal !== "" && c.issue_type !== tVal) return false;
        if (sVal !== "" && !c.title.toLowerCase().includes(sVal)) return false;
        return true;
    });

    const byCol = {};
    for (const c of columns) byCol[c.key] = [];
    for (const card of filtered) {
        const col = columnForCard(card);
        (byCol[col] ?? (byCol[col] = [])).push(card);
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
            render();
        };

        const titleDiv = document.createElement("div");
        titleDiv.className = "columnTitle";
        titleDiv.textContent = col.title;

        const countDiv = document.createElement("div");
        countDiv.className = "columnCount";
        countDiv.textContent = (byCol[col.key] || []).length;

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
            if (card.assignee) badges.push({ text: `@${card.assignee}` });
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

        colWrap.appendChild(header);
        colWrap.appendChild(dropZone);
        boardEl.appendChild(colWrap);
    }
}

function escapeHtml(s) {
    return String(s ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#039;");
}

refreshBtn.addEventListener("click", () => post("board.refresh"));
newBtn.addEventListener("click", () => {
    newTitle.value = "";
    newDesc.value = "";
    newDesc.value = "";
    dialog.showModal();
});

filterPriority.addEventListener("change", render);
filterType.addEventListener("change", render);
filterSearch.addEventListener("input", render);

createConfirm.addEventListener("click", (e) => {
    // dialog will close automatically due to method=dialog
    const title = newTitle.value.trim();
    const description = newDesc.value ?? "";
    if (!title) {
        e.preventDefault();
        toast("Title is required.");
        return;
    }
    post("issue.create", { title, description });
});

window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || !msg.type) return;

    if (msg.type === "board.data") {
        boardData = msg.payload;
        render();
        return;
    }

    if (msg.type === "mutation.error") {
        toast(msg.error || "Operation failed.");
        return;
    }

    if (msg.type === "mutation.ok") {
        // no-op; board refresh usually follows
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

    const typeOptions = ["task", "bug", "feature"];
    const priorityOptions = [0, 1, 2, 3, 4];

    form.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
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
                    <input id="editDueAt" type="datetime-local" value="${card.due_at ? new Date(card.due_at).toISOString().slice(0, 16) : ''}" style="width: 100%; margin-top: 4px;" />
                </div>
                <div>
                    <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Defer Until</label>
                    <input id="editDeferUntil" type="datetime-local" value="${card.defer_until ? new Date(card.defer_until).toISOString().slice(0, 16) : ''}" style="width: 100%; margin-top: 4px;" />
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
                         <div style="display: flex; flex-wrap: wrap; gap: 6px; margin: 4px 0 8px 0;">
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
                    <div>
                         <label style="font-size: 10px; color: var(--muted); text-transform: uppercase;">Structure</label>
                         
                         <!-- Parent -->
                         <div style="margin-bottom: 8px;">
                            <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px;">Parent:
                                ${card.parent ? `
                                    <span style="color: var(--vscode-editor-foreground);">${formatDep(card.parent)}</span>
                                    <span id="removeParent" data-id="${card.parent.id}" style="cursor: pointer; color: var(--error); margin-left: 4px;">(Unlink)</span>
                                ` : '<span style="font-style:italic;">None</span>'}
                            </div>
                            ${!card.parent ? `
                                <div style="display: flex; gap: 4px;">
                                    <input id="newParentId" type="text" placeholder="Parent Issue ID" style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                                    <button id="btnSetParent" class="btn" style="padding: 2px 8px;">Set</button>
                                </div>
                            ` : ''}
                         </div>

                         <!-- Blocker -->
                          <div style="font-size: 11px; color: var(--muted); margin-bottom: 2px;">Blocked By:</div>
                          <ul style="margin: 0; padding-left: 16px; font-size: 11px; margin-bottom: 4px;">
                            ${(card.blocked_by || []).map(b => `
                                <li>
                                    ${formatDep(b)}
                                    <span class="remove-blocker" data-id="${b.id}" style="cursor: pointer; color: var(--error); margin-left: 4px;">&times;</span>
                                </li>
                            `).join('')}
                          </ul>
                          <div style="display: flex; gap: 4px;">
                                <input id="newBlockerId" type="text" placeholder="Blocker Issue ID" style="flex: 1; margin: 0; font-size: 12px; padding: 4px;" />
                                <button id="btnAddBlocker" class="btn" style="padding: 2px 8px;">Add</button>
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
                    </div>
                </div>
            </div>

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
                <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; max-height: 200px; overflow-y: auto;">
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
                    <textarea id="newCommentText" rows="2" placeholder="Write a comment..." style="flex: 1; resize: vertical; margin: 0;"></textarea>
                    <button type="button" id="btnPostComment" class="btn" style="align-self: flex-start; height: auto;">Post</button>
                </div>
            </div>

            <div class="dialogActions" style="margin-top: 12px; display: flex; justify-content: space-between; align-items: center;">
                <div style="display: flex; gap: 8px;">
                     <button type="button" id="btnSave" class="btn primary">Save Changes</button>
                     <button type="button" id="btnClose" class="btn">Close</button>
                </div>
                <div style="display: flex; gap: 8px;">
                     <button type="button" id="btnChat" class="btn icon-btn" title="Add to Chat">💬 Chat</button>
                     <button type="button" id="btnCopy" class="btn icon-btn" title="Copy Context">📋 Copy</button>
                </div>
            </div>
            
            <div style="font-size: 10px; color: var(--muted); text-align: right; margin-top: 8px; line-height: 1.5;">
               ID: ${card.id}<br>
               Created: ${new Date(card.created_at).toLocaleString()}<br>
               Updated: ${new Date(card.updated_at).toLocaleString()}${card.closed_at ? `<br>Closed: ${new Date(card.closed_at).toLocaleString()}` : ''}
            </div>
        </div>
    `;

    // Bind events
    form.querySelector("#btnClose").onclick = (e) => {
        e.preventDefault();
        detDialog.close();
    };

    form.querySelector("#btnSave").onclick = (e) => {
        e.preventDefault();
        const updates = {
            title: document.getElementById("editTitle").value.trim(),
            status: document.getElementById("editStatus").value,
            issue_type: document.getElementById("editType").value,
            priority: parseInt(document.getElementById("editPriority").value),
            assignee: document.getElementById("editAssignee").value.trim() || null,
            estimated_minutes: document.getElementById("editEst").value ? parseInt(document.getElementById("editEst").value) : null,
            external_ref: document.getElementById("editExtRef").value.trim() || null,
            due_at: document.getElementById("editDueAt").value ? new Date(document.getElementById("editDueAt").value).toISOString() : null,
            defer_until: document.getElementById("editDeferUntil").value ? new Date(document.getElementById("editDeferUntil").value).toISOString() : null,
            description: document.getElementById("editDesc").value,
            acceptance_criteria: document.getElementById("editAC").value,
            design: document.getElementById("editDesign").value,
            notes: document.getElementById("editNotes").value
        };

        if (updates.title) {
            post("issue.update", { id: card.id, updates });
            // Optimistic close? Or wait for refresh. Let's wait for refresh but close dialog now for responsiveness
            detDialog.close();
        } else {
            toast("Title is required");
        }
    };

    form.querySelector("#btnPostComment").onclick = (e) => {
        e.preventDefault();
        const text = form.querySelector("#newCommentText").value.trim();
        if (!text) return;

        post("issue.addComment", { id: card.id, text, author: "Me" });
        detDialog.close();
        toast("Comment posted");
    };

    // Label Events
    form.querySelector("#btnAddLabel").onclick = (e) => {
        e.preventDefault();
        const label = form.querySelector("#newLabel").value.trim();
        if (!label) return;
        post("issue.addLabel", { id: card.id, label });
        detDialog.close();
        toast("Label added");
    };

    form.querySelectorAll(".remove-label").forEach(btn => {
        btn.onclick = (e) => {
            const label = e.target.dataset.label;
            post("issue.removeLabel", { id: card.id, label });
            detDialog.close(); // Refresh
        };
    });

    // Dependency Events
    const btnSetParent = form.querySelector("#btnSetParent");
    if (btnSetParent) {
        btnSetParent.onclick = (e) => {
            e.preventDefault();
            const parentId = form.querySelector("#newParentId").value.trim();
            if (!parentId) return;
            // card is child, parentId is parent
            post("issue.addDependency", { id: card.id, otherId: parentId, type: 'parent-child' });
            detDialog.close();
            toast("Parent set");
        };
    }

    const removeParentBtn = form.querySelector("#removeParent");
    if (removeParentBtn) {
        removeParentBtn.onclick = (e) => {
            // Remove dependency where card=id and depends_on=parent.id
            post("issue.removeDependency", { id: card.id, otherId: card.parent.id });
            detDialog.close();
            toast("Parent unlink");
        };
    }

    form.querySelector("#btnAddBlocker").onclick = (e) => {
        e.preventDefault();
        const blockerId = form.querySelector("#newBlockerId").value.trim();
        if (!blockerId) return;
        // card BLOCKED BY blockerId => card depends on blockerId (type=blocks)
        // Wait, schema: (issue_id, depends_on_id, type='blocks')
        // Interpretation: issue_id IS BLOCKED BY depends_on_id.
        post("issue.addDependency", { id: card.id, otherId: blockerId, type: 'blocks' });
        detDialog.close();
        toast("Blocker added");
    };

    form.querySelectorAll(".remove-blocker").forEach(btn => {
        btn.onclick = (e) => {
            const blockerId = e.target.dataset.id;
            post("issue.removeDependency", { id: card.id, otherId: blockerId });
            detDialog.close();
        };
    });

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

post("board.load");

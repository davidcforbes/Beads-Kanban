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

const filterPriority = document.getElementById("filterPriority");
const filterType = document.getElementById("filterType");
const filterSearch = document.getElementById("filterSearch");

let boardData = null;
const collapsedColumns = new Set();

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
    // Auto-hide after 5s if not interacted
    setTimeout(() => {
        // Simple check to avoid hiding if user is hovering? simplified for now
        toastEl.classList.add("hidden");
    }, 5000);
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
            badges.push({ text: `P${card.priority}` });
            if (card.issue_type) {
                badges.push({
                    text: card.issue_type,
                    cls: `badge-type-${card.issue_type}`
                });
            }
            if (card.assignee) badges.push({ text: `@${card.assignee}` });

            // Blocked By logic
            if (card.blocked_by && card.blocked_by.length > 0) {
                badges.push({ text: `blocked by ${card.blocked_by.length}`, cls: 'badge-blocked' });
            } else if ((card.blocked_by_count || 0) > 0) {
                badges.push({ text: `blocked:${card.blocked_by_count}`, cls: 'badge-blocked' });
            }

            if (card.external_ref) badges.push({ text: card.external_ref });
            for (const l of (card.labels || []).slice(0, 4)) badges.push({ text: `#${l}` });

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
    console.log('Opening detail for card:', card);
    if (!card) return;
    detTitle.textContent = card.title;
    detDesc.textContent = card.description || "(No description)";

    // Metadata
    const fields = [
        { label: "Status", value: card.status },
        { label: "Priority", value: `P${card.priority}` },
        { label: "Type", value: card.issue_type },
        { label: "Assignee", value: card.assignee || "-" },
        { label: "External Ref", value: card.external_ref || "-" },
        { label: "Created", value: new Date(card.created_at).toLocaleString() },
        { label: "Updated", value: new Date(card.updated_at).toLocaleString() }
    ];

    let metaHtml = fields.map(f =>
        `<div style="display:flex; flex-direction:column;">
           <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">${f.label}</span>
           <span>${escapeHtml(f.value)}</span>
         </div>`
    ).join("");

    // Relationships section
    if (card.parent || (card.children && card.children.length) || (card.blocked_by && card.blocked_by.length) || (card.blocks && card.blocks.length)) {
        metaHtml += `<div style="grid-column: 1 / -1; margin-top: 10px; border-top: 1px solid var(--border);"></div>`;

        if (card.parent) {
            metaHtml += `<div style="grid-column: 1 / -1; margin-top: 5px;">
                <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">Parent</span><br>
                <span>${escapeHtml(card.parent.title)}</span>
            </div>`;
        }

        if (card.children && card.children.length > 0) {
            metaHtml += `<div style="grid-column: 1 / -1; margin-top: 5px;">
                <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">Children</span><br>
                <ul style="margin:0; padding-left:15px;">
                    ${card.children.map(c => `<li>${escapeHtml(c.title)}</li>`).join('')}
                </ul>
            </div>`;
        }

        if (card.blocked_by && card.blocked_by.length > 0) {
            metaHtml += `<div style="grid-column: 1 / -1; margin-top: 5px;">
                <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">Blocked By</span><br>
                <ul style="margin:0; padding-left:15px; color: var(--error);">
                    ${card.blocked_by.map(c => `<li>${escapeHtml(c.title)}</li>`).join('')}
                </ul>
            </div>`;
        }

        if (card.blocks && card.blocks.length > 0) {
            metaHtml += `<div style="grid-column: 1 / -1; margin-top: 5px;">
                <span style="font-size:10px; color:var(--muted); text-transform:uppercase;">Blocks</span><br>
                <ul style="margin:0; padding-left:15px;">
                    ${card.blocks.map(c => `<li>${escapeHtml(c.title)}</li>`).join('')}
                </ul>
            </div>`;
        }
    }

    detMeta.innerHTML = metaHtml;

    detDialog.showModal();
}

post("board.load");

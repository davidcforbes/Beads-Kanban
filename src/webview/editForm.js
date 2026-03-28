// editForm.js - Static Edit Form Management
// This module manages the edit issue dialog with a static HTML layout
// and dynamic data population

// Module state
let currentCard = null;
let isCreateMode = false;
let detailDirty = false;
let formInitialized = false;

// Expose dirty state to board.js for unified close-guard checks
window.__editFormDirty = {
    isDirty: () => detailDirty,
    reset: () => { detailDirty = false; }
};

// DOM element references (cached once)
let form = null;
let detDialog = null;

// Exported functions will be called from board.js
export function initEditForm(dialogEl, escapeHtmlFn, toastFn, postFn, postAsyncFn, cardCacheFn, columnStateFn, purifyConfigFn) {
    detDialog = dialogEl;
    form = dialogEl.querySelector('form');
    
    // Store references to external functions
    window._editForm = {
        escapeHtml: escapeHtmlFn,
        toast: toastFn,
        post: postFn,
        postAsync: postAsyncFn,
        getCardCache: cardCacheFn,
        getColumnState: columnStateFn,
        getPurifyConfig: purifyConfigFn
    };
    
    if (!form) {
        console.error('[EditForm] Form element not found in dialog');
        return;
    }
    
    setupStaticEventHandlers();
    formInitialized = true;
    console.log('[EditForm] Initialized successfully');
}

function setupStaticEventHandlers() {
    // These handlers are attached ONCE and use currentCard reference
    
    // Close button
    const btnClose = form.querySelector('#btnClose');
    if (btnClose) {
        btnClose.onclick = (e) => {
            e.preventDefault();
            requestDetailClose();
        };
    }
    
    // Save button
    const btnSave = form.querySelector('#btnSave');
    if (btnSave) {
        btnSave.onclick = handleSave;
    }
    
    // Chat button
    const btnChat = form.querySelector('#btnChat');
    if (btnChat) {
        btnChat.onclick = (e) => {
            e.preventDefault();
            window._editForm.post("issue.addToChat", { text: getContext() });
            window._editForm.toast("Added to Chat input");
        };
    }
    
    // Copy button
    const btnCopy = form.querySelector('#btnCopy');
    if (btnCopy) {
        btnCopy.onclick = (e) => {
            e.preventDefault();
            window._editForm.post("issue.copyToClipboard", { text: getContext() });
            window._editForm.toast("Copying...");
        };
    }
    
    // Add Label button
    const btnAddLabel = form.querySelector('#btnAddLabel');
    if (btnAddLabel) {
        btnAddLabel.onclick = handleAddLabel;
    }
    
    // Post Comment button
    const btnPostComment = form.querySelector('#btnPostComment');
    if (btnPostComment) {
        btnPostComment.onclick = handlePostComment;
    }
    
    // Relationship buttons
    const btnSetParent = form.querySelector('#btnSetParent');
    if (btnSetParent) {
        btnSetParent.onclick = handleSetParent;
    }
    
    const btnAddBlocker = form.querySelector('#btnAddBlocker');
    if (btnAddBlocker) {
        btnAddBlocker.onclick = handleAddBlocker;
    }
    
    const btnAddChild = form.querySelector('#btnAddChild');
    if (btnAddChild) {
        btnAddChild.onclick = handleAddChild;
    }
    
    // Toggle preview buttons for markdown fields
    form.querySelectorAll('.toggle-preview').forEach(btn => {
        btn.onclick = handleTogglePreview;
    });
    
    // Track dirty state on form fields
    const dirtyFieldIds = [
        "editTitle", "editStatus", "editType", "editPriority",
        "editAssignee", "editEst", "editExtRef", "editDueAt",
        "editDeferUntil", "editDesc", "editAC", "editDesign",
        "editNotes", "editPinned", "editTemplate", "editEphemeral"
    ];
    
    dirtyFieldIds.forEach(id => {
        const field = form.querySelector(`#${id}`);
        if (field) {
            field.addEventListener('input', markDirty);
            field.addEventListener('change', markDirty);
        }
    });
    
    // Dialog backdrop click to close
    detDialog.addEventListener('click', (e) => {
        if (e.target === detDialog) {
            requestDetailClose();
        }
    });
}

function markDirty() {
    detailDirty = true;
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

// Main entry point - populate form with card data
export async function openDetail(card, loadFullIssueFn) {
    if (!card) return;
    if (!formInitialized) {
        console.error('[EditForm] Form not initialized');
        return;
    }
    
    isCreateMode = card.id === null;
    
    // Load full issue details if editing existing issue
    if (!isCreateMode) {
        try {
            card = await loadFullIssueFn(card.id);
        } catch (error) {
            // Error already displayed
            return;
        }
    }
    
    currentCard = card;
    detailDirty = false;
    
    // Populate all form fields
    populateFormFields(card);
    
    // Update dynamic sections
    refreshLabelsDisplay();
    refreshRelationshipsDisplay();
    refreshCommentsDisplay();
    refreshAdvancedMetadata();
    updateIssueIdDatalist();
    
    // Update header and footer
    updateHeader();
    updateFooter();
    
    // Reset markdown previews to edit mode
    resetMarkdownPreviews();
    
    // Show the dialog
    detDialog.showModal();
}

function populateFormFields(card) {
    // Title
    setValue('#editTitle', card.title || '');
    
    // Selects
    setValue('#editStatus', card.status || 'open');
    setValue('#editType', card.issue_type || 'task');
    setValue('#editPriority', card.priority ?? 2);
    
    // Text inputs
    setValue('#editAssignee', card.assignee || '');
    setValue('#editEst', card.estimated_minutes || '');
    setValue('#editExtRef', card.external_ref || '');
    
    // Datetime inputs
    setValue('#editDueAt', toLocalDateTimeInput(card.due_at));
    setValue('#editDeferUntil', toLocalDateTimeInput(card.defer_until));
    
    // Textareas
    setValue('#editDesc', card.description || '');
    setValue('#editAC', card.acceptance_criteria || '');
    setValue('#editDesign', card.design || '');
    setValue('#editNotes', card.notes || '');
    
    // Checkboxes
    setChecked('#editPinned', card.pinned || false);
    setChecked('#editTemplate', card.is_template || false);
    setChecked('#editEphemeral', card.ephemeral || false);
}

function setValue(selector, value) {
    const el = form.querySelector(selector);
    if (el) el.value = value;
}

function setChecked(selector, checked) {
    const el = form.querySelector(selector);
    if (el) el.checked = checked;
}

function updateHeader() {
    const header = form.querySelector('#editFormHeader');
    if (!header) return;
    
    const { escapeHtml } = window._editForm;
    if (isCreateMode) {
        header.innerHTML = 'Create New Issue';
    } else {
        header.innerHTML = `Edit Issue <span style="color: var(--muted); font-weight: normal; font-size: 14px;">${escapeHtml(currentCard.id)}</span>`;
    }
    
    // Update save button text
    const btnSave = form.querySelector('#btnSave');
    if (btnSave) {
        btnSave.textContent = isCreateMode ? 'Create Issue' : 'Save Changes';
    }
    
    // Show/hide create mode comment note
    const commentNote = form.querySelector('#createModeCommentNote');
    if (commentNote) {
        commentNote.classList.toggle('hidden', !isCreateMode);
    }
}

function updateFooter() {
    const footer = form.querySelector('#editFormFooter');
    if (!footer) return;

    const { escapeHtml, getPurifyConfig } = window._editForm;
    
    if (isCreateMode) {
        footer.innerHTML = `
            <span>ID: Assigned on create</span>
            <span>Created: Not yet created</span>
            <span>Updated: Not yet created</span>
        `;
    } else {
        let html = `
            <span>ID: ${escapeHtml(currentCard.id)}</span>
            <span>Created: ${new Date(currentCard.created_at).toLocaleString()}</span>
            <span>Updated: ${new Date(currentCard.updated_at).toLocaleString()}</span>
        `;
        if (currentCard.closed_at) {
            html += `<span>Closed: ${new Date(currentCard.closed_at).toLocaleString()}</span>`;
        }
        footer.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
    }
}

// Labels management
function refreshLabelsDisplay() {
    const container = form.querySelector('#labelsContainer');
    if (!container) return;
    
    const { escapeHtml, getPurifyConfig } = window._editForm;
    const labels = currentCard.labels || [];
    
    if (labels.length === 0) {
        container.innerHTML = '<span class="muted-note">None</span>';
        return;
    }
    
    const html = labels.map(l => `
        <span class="label-badge">
            #${escapeHtml(l)}
            <span class="remove-label" data-label="${escapeHtml(l)}">&times;</span>
        </span>
    `).join('');
    
    container.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
    
    // Attach remove handlers
    container.querySelectorAll('.remove-label').forEach(btn => {
        btn.onclick = handleRemoveLabel;
    });
}

async function handleAddLabel(e) {
    e.preventDefault();
    const input = form.querySelector('#newLabel');
    const rawLabels = input.value.trim();
    if (!rawLabels) return;
    
    const { toast, postAsync } = window._editForm;
    
    // Split by comma, trim, filter empties, dedupe
    const labels = [...new Set(
        rawLabels.split(',').map(l => l.trim()).filter(l => l.length > 0)
    )];
    
    if (labels.length === 0) return;
    
    if (isCreateMode) {
        if (!currentCard.labels) currentCard.labels = [];
        let added = 0;
        for (const label of labels) {
            if (!currentCard.labels.includes(label)) {
                currentCard.labels.push(label);
                added++;
            }
        }
        if (added > 0) {
            toast(`Added ${added} label${added > 1 ? 's' : ''}`);
            input.value = '';
            refreshLabelsDisplay();
        }
    } else {
        let successCount = 0;
        for (const label of labels) {
            try {
                await postAsync("issue.addLabel", { id: currentCard.id, label }, "Adding label...");
                if (!currentCard.labels) currentCard.labels = [];
                if (!currentCard.labels.includes(label)) {
                    currentCard.labels.push(label);
                }
                successCount++;
            } catch (err) {
                toast(`Failed to add label: ${err.message}`);
            }
        }
        if (successCount > 0) {
            toast(`Added ${successCount} label${successCount > 1 ? 's' : ''}`);
            input.value = '';
            refreshLabelsDisplay();
        }
    }
}

async function handleRemoveLabel(e) {
    e.preventDefault();
    e.stopPropagation();
    const label = e.currentTarget.dataset.label;
    const { toast, postAsync } = window._editForm;
    
    if (isCreateMode) {
        currentCard.labels = (currentCard.labels || []).filter(l => l !== label);
        toast("Label removed");
        refreshLabelsDisplay();
    } else {
        try {
            await postAsync("issue.removeLabel", { id: currentCard.id, label }, "Removing label...");
            currentCard.labels = (currentCard.labels || []).filter(l => l !== label);
            toast("Label removed");
            refreshLabelsDisplay();
        } catch (err) {
            toast(`Failed to remove label: ${err.message}`);
        }
    }
}

// Relationships management
function refreshRelationshipsDisplay() {
    const { escapeHtml, getPurifyConfig } = window._editForm;
    
    // Parent
    const parentDisplay = form.querySelector('#parentDisplay');
    const removeParentBtn = form.querySelector('#removeParent');
    const parentAddRow = form.querySelector('#parentAddRow');
    
    if (parentDisplay) {
        if (currentCard.parent) {
            parentDisplay.innerHTML = DOMPurify.sanitize(formatDep(currentCard.parent), getPurifyConfig());
            parentDisplay.classList.remove('none');
            if (removeParentBtn) removeParentBtn.classList.remove('hidden');
            if (parentAddRow) parentAddRow.classList.add('hidden');
        } else {
            parentDisplay.textContent = 'None';
            parentDisplay.classList.add('none');
            if (removeParentBtn) removeParentBtn.classList.add('hidden');
            if (parentAddRow) parentAddRow.classList.remove('hidden');
        }
    }
    
    // Attach remove parent handler
    if (removeParentBtn) {
        removeParentBtn.onclick = handleRemoveParent;
    }
    
    // Blocked By
    const blockedByList = form.querySelector('#blockedByList');
    if (blockedByList) {
        const blockers = currentCard.blocked_by || [];
        if (blockers.length === 0) {
            blockedByList.innerHTML = '';
        } else {
            const html = blockers.map(b => `
                <li>${formatDep(b)} <span class="remove-dep remove-blocker" data-id="${escapeHtml(b.id)}">&times;</span></li>
            `).join('');
            blockedByList.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
            blockedByList.querySelectorAll('.remove-blocker').forEach(btn => {
                btn.onclick = handleRemoveBlocker;
            });
        }
    }
    
    // Blocks (read-only)
    const blocksList = form.querySelector('#blocksList');
    if (blocksList) {
        const blocks = currentCard.blocks || [];
        if (blocks.length === 0) {
            blocksList.innerHTML = '';
        } else {
            const html = blocks.map(b => `<li>${formatDep(b)}</li>`).join('');
            blocksList.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
        }
    }
    
    // Children
    const childrenList = form.querySelector('#childrenList');
    if (childrenList) {
        const children = currentCard.children || [];
        if (children.length === 0) {
            childrenList.innerHTML = '';
        } else {
            const html = children.map(c => `
                <li>${formatDep(c)} <span class="remove-dep remove-child" data-id="${escapeHtml(c.id)}">&times;</span></li>
            `).join('');
            childrenList.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
            childrenList.querySelectorAll('.remove-child').forEach(btn => {
                btn.onclick = handleRemoveChild;
            });
        }
    }
}

function formatDep(dep) {
    const { escapeHtml } = window._editForm;
    const idSuffix = dep.id ? dep.id.slice(-20) : '';
    const title = dep.title || '';
    return `${escapeHtml(idSuffix)}: ${escapeHtml(title)}`;
}

async function handleSetParent(e) {
    e.preventDefault();
    const input = form.querySelector('#newParentId');
    const parentId = input.value.trim();
    if (!parentId) return;
    
    const { toast, postAsync, getCardCache } = window._editForm;
    const cardCache = getCardCache();
    
    if (parentId === currentCard.id) {
        toast("Error: An issue cannot be its own parent");
        return;
    }
    
    if (!cardCache.has(parentId)) {
        toast(`Error: Parent issue '${parentId}' does not exist`);
        return;
    }
    
    if (isCreateMode) {
        currentCard.parent = { id: parentId, title: parentId };
        input.value = '';
        toast("Parent set (will be applied on save)");
        refreshRelationshipsDisplay();
    } else {
        try {
            await postAsync("issue.addDependency", { id: currentCard.id, otherId: parentId, type: 'parent-child' }, "Adding parent...");
            await refreshRelationshipsFromServer();
            toast("Parent set");
        } catch (err) {
            toast(`Failed to set parent: ${err.message}`);
        }
    }
}

async function handleRemoveParent(e) {
    e.preventDefault();
    const { toast, postAsync } = window._editForm;
    
    if (isCreateMode) {
        currentCard.parent = null;
        toast("Parent unlinked");
        refreshRelationshipsDisplay();
    } else {
        try {
            await postAsync("issue.removeDependency", { id: currentCard.id, otherId: currentCard.parent.id, type: 'parent-child' }, "Removing parent...");
            await refreshRelationshipsFromServer();
            toast("Parent unlinked");
        } catch (err) {
            toast(`Failed to remove parent: ${err.message}`);
        }
    }
}

async function handleAddBlocker(e) {
    e.preventDefault();
    const input = form.querySelector('#newBlockerId');
    const blockerId = input.value.trim();
    if (!blockerId) return;
    
    const { toast, postAsync, getCardCache } = window._editForm;
    const cardCache = getCardCache();
    
    if (blockerId === currentCard.id) {
        toast("Error: An issue cannot block itself");
        return;
    }
    
    if (!cardCache.has(blockerId)) {
        toast(`Error: Blocker issue '${blockerId}' does not exist`);
        return;
    }
    
    if (isCreateMode) {
        if (!currentCard.blocked_by) currentCard.blocked_by = [];
        if (!currentCard.blocked_by.find(b => b.id === blockerId)) {
            currentCard.blocked_by.push({ id: blockerId, title: blockerId });
            input.value = '';
            toast("Blocker added (will be applied on save)");
            refreshRelationshipsDisplay();
        } else {
            toast("Blocker already added");
        }
    } else {
        if (currentCard.blocked_by && currentCard.blocked_by.find(b => b.id === blockerId)) {
            toast("This blocker is already added");
            return;
        }
        try {
            await postAsync("issue.addDependency", { id: currentCard.id, otherId: blockerId, type: 'blocks' }, "Adding blocker...");
            await refreshRelationshipsFromServer();
            toast("Blocker added");
        } catch (err) {
            toast(`Failed to add blocker: ${err.message}`);
        }
    }
}

async function handleRemoveBlocker(e) {
    e.preventDefault();
    const blockerId = e.currentTarget.dataset.id;
    const { toast, postAsync } = window._editForm;
    
    if (isCreateMode) {
        currentCard.blocked_by = (currentCard.blocked_by || []).filter(b => b.id !== blockerId);
        toast("Blocker removed");
        refreshRelationshipsDisplay();
    } else {
        try {
            await postAsync("issue.removeDependency", { id: currentCard.id, otherId: blockerId, type: 'blocks' }, "Removing blocker...");
            await refreshRelationshipsFromServer();
            toast("Blocker removed");
        } catch (err) {
            toast(`Failed to remove blocker: ${err.message}`);
        }
    }
}

async function handleAddChild(e) {
    e.preventDefault();
    const input = form.querySelector('#newChildId');
    const childId = input.value.trim();
    if (!childId) return;
    
    const { toast, postAsync, getCardCache } = window._editForm;
    const cardCache = getCardCache();
    
    if (childId === currentCard.id) {
        toast("Error: An issue cannot be its own child");
        return;
    }
    
    if (!cardCache.has(childId)) {
        toast(`Error: Child issue '${childId}' does not exist`);
        return;
    }
    
    if (isCreateMode) {
        if (!currentCard.children) currentCard.children = [];
        if (!currentCard.children.find(c => c.id === childId)) {
            currentCard.children.push({ id: childId, title: childId });
            input.value = '';
            toast("Child added (will be applied on save)");
            refreshRelationshipsDisplay();
        } else {
            toast("Child already added");
        }
    } else {
        if (currentCard.children && currentCard.children.find(c => c.id === childId)) {
            toast("This child is already added");
            return;
        }
        try {
            await postAsync("issue.addDependency", { id: childId, otherId: currentCard.id, type: 'parent-child' }, "Adding child...");
            await refreshRelationshipsFromServer();
            toast("Child added");
        } catch (err) {
            toast(`Failed to add child: ${err.message}`);
        }
    }
}

async function handleRemoveChild(e) {
    e.preventDefault();
    const childId = e.currentTarget.dataset.id;
    const { toast, postAsync } = window._editForm;
    
    if (isCreateMode) {
        currentCard.children = (currentCard.children || []).filter(c => c.id !== childId);
        toast("Child removed");
        refreshRelationshipsDisplay();
    } else {
        try {
            await postAsync("issue.removeDependency", { id: childId, otherId: currentCard.id, type: 'parent-child' }, "Removing child...");
            await refreshRelationshipsFromServer();
            toast("Child removed");
        } catch (err) {
            toast(`Failed to remove child: ${err.message}`);
        }
    }
}

async function refreshRelationshipsFromServer() {
    if (!currentCard.id) return;
    const { postAsync } = window._editForm;
    
    try {
        const response = await postAsync("issue.getFull", { id: currentCard.id }, "Refreshing relationships...");
        const updated = response?.payload?.card;
        if (updated) {
            currentCard.parent = updated.parent;
            currentCard.children = updated.children;
            currentCard.blocks = updated.blocks;
            currentCard.blocked_by = updated.blocked_by;
        }
    } catch (err) {
        console.error("Error refreshing relationships:", err);
    }
    refreshRelationshipsDisplay();
}

// Comments management
function refreshCommentsDisplay() {
    const list = form.querySelector('#commentsList');
    if (!list) return;
    
    const { escapeHtml, getPurifyConfig } = window._editForm;
    const comments = currentCard.comments || [];
    
    if (comments.length === 0) {
        list.innerHTML = '';
        return;
    }
    
    const html = comments.map(c => `
        <div class="comment">
            <div class="comment-header">
                <span>${escapeHtml(c.author)}</span>
                <span>${new Date(c.created_at).toLocaleString()}</span>
            </div>
            <div class="comment-body markdown-body">${safeRenderMarkdown(c.text)}</div>
        </div>
    `).join('');
    
    list.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
}

async function handlePostComment(e) {
    e.preventDefault();
    const input = form.querySelector('#newCommentText');
    const text = input.value.trim();
    if (!text) return;
    
    const { toast, postAsync } = window._editForm;
    
    if (isCreateMode) {
        if (!currentCard.comments) currentCard.comments = [];
        currentCard.comments.push({
            id: Date.now(),
            issue_id: null,
            author: "Me",
            text,
            created_at: new Date().toISOString()
        });
        input.value = '';
        refreshCommentsDisplay();
        toast("Comment added (will be posted on save)");
    } else {
        try {
            await postAsync("issue.addComment", { id: currentCard.id, text, author: "Me" }, "Adding comment...");
            if (!currentCard.comments) currentCard.comments = [];
            currentCard.comments.push({
                id: Date.now(),
                issue_id: currentCard.id,
                author: "Me",
                text,
                created_at: new Date().toISOString()
            });
            input.value = '';
            refreshCommentsDisplay();
            toast("Comment posted");
        } catch (err) {
            toast(`Failed to add comment: ${err.message}`);
        }
    }
}

// Advanced Metadata
function refreshAdvancedMetadata() {
    const container = form.querySelector('#advancedMetadata');
    const content = form.querySelector('#advancedMetadataContent');
    if (!container || !content) return;

    const { escapeHtml, getPurifyConfig } = window._editForm;
    
    const hasEventData = currentCard.event_kind || currentCard.actor || currentCard.target || 
                         currentCard.payload || currentCard.sender || currentCard.mol_type || 
                         currentCard.role_type || currentCard.rig || currentCard.agent_state ||
                         currentCard.last_activity || currentCard.hook_bead || currentCard.role_bead ||
                         currentCard.await_type || currentCard.await_id || 
                         currentCard.timeout_ns !== null || currentCard.waiters;
    
    if (!hasEventData) {
        container.classList.add('hidden');
        return;
    }
    
    container.classList.remove('hidden');
    
    const fields = [
        ['Event Kind', currentCard.event_kind],
        ['Actor', currentCard.actor],
        ['Target', currentCard.target],
        ['Sender', currentCard.sender],
        ['Mol Type', currentCard.mol_type],
        ['Role Type', currentCard.role_type],
        ['Rig', currentCard.rig],
        ['Agent State', currentCard.agent_state],
        ['Last Activity', currentCard.last_activity ? new Date(currentCard.last_activity).toLocaleString() : null],
        ['Hook Bead', currentCard.hook_bead],
        ['Role Bead', currentCard.role_bead],
        ['Await Type', currentCard.await_type],
        ['Await ID', currentCard.await_id],
        ['Timeout (ns)', currentCard.timeout_ns],
        ['Waiters', currentCard.waiters],
    ];
    
    let html = '';
    for (const [label, value] of fields) {
        if (value !== null && value !== undefined && value !== '') {
            html += `<span class="meta-label">${label}:</span><span class="meta-value">${escapeHtml(String(value))}</span>`;
        }
    }
    
    if (currentCard.payload) {
        html += `<span class="meta-label">Payload:</span><pre>${escapeHtml(currentCard.payload)}</pre>`;
    }

    content.innerHTML = DOMPurify.sanitize(html, getPurifyConfig());
}

// Issue ID datalist for autocomplete
function updateIssueIdDatalist() {
    const datalist = form.querySelector('#issueIdOptions');
    if (!datalist) return;
    
    const { escapeHtml, getColumnState } = window._editForm;
    const columnState = getColumnState();
    
    const allCards = [];
    for (const col of ['ready', 'in_progress', 'blocked', 'closed']) {
        if (columnState[col]?.cards) {
            allCards.push(...columnState[col].cards);
        }
    }
    
    const html = allCards
        .filter(c => !currentCard.id || c.id !== currentCard.id)
        .map(c => `<option value="${escapeHtml(c.id)}" label="${escapeHtml(c.title)}"></option>`)
        .join('');
    
    datalist.innerHTML = html;
}

// Markdown preview toggle
function handleTogglePreview(e) {
    const targetId = e.target.dataset.target;
    const textarea = form.querySelector(`#${targetId}`);
    const preview = form.querySelector(`#${targetId}-preview`);
    
    if (!textarea || !preview) return;
    
    const { getPurifyConfig } = window._editForm;
    
    if (!textarea.classList.contains('hidden')) {
        // Switch to Preview
        preview.innerHTML = DOMPurify.sanitize(marked.parse(textarea.value || ''), getPurifyConfig());
        textarea.classList.add('hidden');
        preview.classList.remove('hidden');
        e.target.textContent = 'Edit';
    } else {
        // Switch to Edit
        textarea.classList.remove('hidden');
        preview.classList.add('hidden');
        e.target.textContent = 'Preview';
    }
}

function resetMarkdownPreviews() {
    form.querySelectorAll('.toggle-preview').forEach(btn => {
        const targetId = btn.dataset.target;
        const textarea = form.querySelector(`#${targetId}`);
        const preview = form.querySelector(`#${targetId}-preview`);
        
        if (textarea && preview) {
            textarea.classList.remove('hidden');
            preview.classList.add('hidden');
            btn.textContent = 'Preview';
        }
    });
}

// Save handler
async function handleSave(e) {
    e.preventDefault();

    const btnSave = form.querySelector('#btnSave');
    if (btnSave && btnSave.disabled) { return; }
    if (btnSave) { btnSave.disabled = true; }
    try {
    const { toast, postAsync } = window._editForm;

    const data = {
        title: form.querySelector('#editTitle').value.trim(),
        status: form.querySelector('#editStatus').value,
        issue_type: form.querySelector('#editType').value,
        priority: parseInt(form.querySelector('#editPriority').value),
        assignee: form.querySelector('#editAssignee').value.trim() || null,
        estimated_minutes: form.querySelector('#editEst').value ? parseInt(form.querySelector('#editEst').value) : null,
        external_ref: form.querySelector('#editExtRef').value.trim() || null,
        due_at: toIsoFromLocalInput(form.querySelector('#editDueAt').value),
        defer_until: toIsoFromLocalInput(form.querySelector('#editDeferUntil').value),
        description: form.querySelector('#editDesc').value,
        acceptance_criteria: form.querySelector('#editAC').value,
        design: form.querySelector('#editDesign').value,
        notes: form.querySelector('#editNotes').value,
        pinned: form.querySelector('#editPinned').checked,
        is_template: form.querySelector('#editTemplate').checked,
        ephemeral: form.querySelector('#editEphemeral').checked
    };

    // In create mode, include relationships
    if (isCreateMode) {
        if (currentCard.labels && currentCard.labels.length > 0) {
            data.labels = currentCard.labels;
        }
        if (currentCard.parent) {
            data.parent_id = currentCard.parent.id;
        }
        if (currentCard.blocked_by && currentCard.blocked_by.length > 0) {
            data.blocked_by_ids = currentCard.blocked_by.map(b => b.id);
        }
        if (currentCard.children && currentCard.children.length > 0) {
            data.children_ids = currentCard.children.map(c => c.id);
        }
    }

    if (!data.title) {
        toast("Title is required");
        return;
    }

    try {
        if (isCreateMode) {
            const createResponse = await postAsync("issue.create", data, "Creating issue...");
            const newIssueId = createResponse?.payload?.id;

            // Post any comments
            let failedComments = 0;
            if (newIssueId && currentCard.comments && currentCard.comments.length > 0) {
                for (const comment of currentCard.comments) {
                    try {
                        await postAsync("issue.addComment", {
                            id: newIssueId,
                            text: comment.text,
                            author: comment.author
                        }, "Adding comment...");
                    } catch (commentErr) {
                        failedComments++;
                        console.error(`Failed to post comment: ${commentErr.message}`);
                    }
                }
            }

            if (failedComments > 0) {
                toast(`Issue created, but ${failedComments} comment(s) failed to post`);
            } else {
                toast("Issue created successfully");
            }
        } else {
            await postAsync("issue.update", { id: currentCard.id, updates: data }, "Saving changes...");
            toast("Changes saved successfully");
        }

        detailDirty = false;
        detDialog.close();
    } catch (err) {
        toast(`Failed to ${isCreateMode ? 'create issue' : 'save changes'}: ${err.message}`);
    }
    } finally {
        if (btnSave) { btnSave.disabled = false; }
    }
}

// Context for chat/copy
function getContext() {
    return `Issue: ${currentCard.title}
ID: ${currentCard.id || 'New'}
Status: ${currentCard.status}
Priority: P${currentCard.priority}
Type: ${currentCard.issue_type}
Assignee: ${currentCard.assignee || 'Unassigned'}
Description:
${currentCard.description || 'No description'}
Acceptance Criteria:
${currentCard.acceptance_criteria || 'None'}
Design:
${currentCard.design || 'None'}
`;
}

// Utility functions
function toLocalDateTimeInput(isoString) {
    if (!isoString) return '';
    try {
        const date = new Date(isoString);
        if (isNaN(date.getTime())) return '';
        const offset = date.getTimezoneOffset();
        const local = new Date(date.getTime() - offset * 60000);
        return local.toISOString().slice(0, 16);
    } catch {
        return '';
    }
}

function toIsoFromLocalInput(localValue) {
    if (!localValue) return null;
    try {
        const date = new Date(localValue);
        if (isNaN(date.getTime())) return null;
        return date.toISOString();
    } catch {
        return null;
    }
}

function safeRenderMarkdown(text) {
    const MAX_MARKDOWN_SIZE = 10000;
    if (!text) return '';
    if (text.length > MAX_MARKDOWN_SIZE) {
        return `<div class="error" style="color: var(--error); padding: 8px; background: rgba(255,0,0,0.1); border-radius: 4px;">
            Content too large to display (${Math.round(text.length / 1024)}KB). Maximum size: ${Math.round(MAX_MARKDOWN_SIZE / 1024)}KB.
        </div>`;
    }
    const { getPurifyConfig } = window._editForm;
    return DOMPurify.sanitize(marked.parse(text), getPurifyConfig());
}

// Export for keyboard handler
export function requestClose() {
    requestDetailClose();
}

export function isDirty() {
    return detailDirty;
}

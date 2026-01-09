"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const beadsAdapter_1 = require("./beadsAdapter");
const daemonBeadsAdapter_1 = require("./daemonBeadsAdapter");
const daemonManager_1 = require("./daemonManager");
const webview_1 = require("./webview");
const sanitizeError_1 = require("./sanitizeError");
const markdownValidator_1 = require("./markdownValidator");
const types_1 = require("./types");
// Size limits for text operations
const MAX_CHAT_TEXT = 50_000; // 50KB reasonable for chat
const MAX_CLIPBOARD_TEXT = 100_000; // 100KB for clipboard
// Sanitize error messages to prevent leaking implementation details
// sanitizeError is now imported from ./sanitizeError
/**
 * Sanitizes text for CSV injection attacks.
 * Prefixes text starting with formula-triggering characters with a single quote.
 * This prevents Excel/CSV applications from interpreting the content as formulas.
 *
 * @param text - The text to sanitize
 * @returns Sanitized text safe for clipboard/CSV
 */
function sanitizeForCSV(text) {
    if (!text || text.length === 0) {
        return text;
    }
    // Check if text starts with formula-triggering characters
    const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
    const firstChar = text.charAt(0);
    if (dangerousChars.includes(firstChar)) {
        // Prefix with single quote to treat as literal text
        return "'" + text;
    }
    return text;
}
/**
 * Validates markdown content in all cards before sending to webview.
 * Logs warnings for suspicious content but does not block sending.
 * This is a defense-in-depth measure - webview still uses DOMPurify.
 */
function validateBoardCards(cards, output) {
    for (const card of cards) {
        (0, markdownValidator_1.validateMarkdownFields)({
            description: card.description,
            acceptance_criteria: card.acceptance_criteria,
            design: card.design,
            notes: card.notes
        }, output);
    }
}
function activate(context) {
    const output = vscode.window.createOutputChannel("Beads Kanban");
    output.appendLine('[BeadsAdapter] Environment Versions: ' + JSON.stringify(process.versions, null, 2));
    // Determine which adapter to use based on configuration
    const config = vscode.workspace.getConfiguration('beadsKanban');
    const useDaemonAdapter = config.get('useDaemonAdapter', false);
    const ws = vscode.workspace.workspaceFolders?.[0];
    let adapter;
    if (useDaemonAdapter && ws) {
        output.appendLine('[Extension] Using DaemonBeadsAdapter');
        adapter = new daemonBeadsAdapter_1.DaemonBeadsAdapter(ws.uri.fsPath, output);
    }
    else {
        output.appendLine('[Extension] Using BeadsAdapter (sql.js)');
        adapter = new beadsAdapter_1.BeadsAdapter(output);
    }
    context.subscriptions.push(output);
    context.subscriptions.push({ dispose: () => adapter.dispose() });
    // Track active panels and polling state (moved here for accessibility)
    let activePanelCount = 0;
    let pollInterval = null;
    let startDaemonPolling;
    let stopDaemonPolling;
    // Daemon management setup
    if (ws) {
        const daemonManager = new daemonManager_1.DaemonManager(ws.uri.fsPath, output);
        // Create status bar item
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = "$(sync~spin) Beads Daemon";
        statusBarItem.tooltip = "Checking daemon status...";
        statusBarItem.command = "beadsKanban.showDaemonActions";
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);
        // Track auto-start attempts to prevent infinite retry loops
        let autoStartAttempted = false;
        // Update daemon status in status bar
        const updateDaemonStatus = async () => {
            try {
                const status = await daemonManager.getStatus();
                if (status.running && status.healthy) {
                    statusBarItem.text = "$(check) Beads Daemon";
                    statusBarItem.tooltip = `Daemon running${status.pid ? ` (PID ${status.pid})` : ''}`;
                    statusBarItem.backgroundColor = undefined;
                    autoStartAttempted = false; // Reset on successful connection
                }
                else if (status.running && !status.healthy) {
                    statusBarItem.text = "$(warning) Beads Daemon";
                    statusBarItem.tooltip = "Daemon unhealthy";
                    statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
                }
                else {
                    // Daemon not running
                    statusBarItem.text = "$(circle-slash) Beads Daemon";
                    statusBarItem.tooltip = "Daemon not running";
                    statusBarItem.backgroundColor = undefined;
                    // Auto-start daemon if configured to use it and haven't tried yet
                    if (useDaemonAdapter && !autoStartAttempted) {
                        autoStartAttempted = true;
                        output.appendLine('[Extension] Daemon not running, attempting auto-start...');
                        try {
                            await daemonManager.start();
                            output.appendLine('[Extension] Daemon started successfully');
                            // Update status immediately after starting
                            setTimeout(updateDaemonStatus, 1000); // Give daemon time to initialize
                        }
                        catch (startError) {
                            output.appendLine(`[Extension] Failed to auto-start daemon: ${(0, sanitizeError_1.sanitizeErrorWithContext)(startError)}`);
                            // Show notification with option to start manually
                            vscode.window.showWarningMessage('Beads daemon is not running. The extension requires the daemon when configured to use DaemonBeadsAdapter.', 'Start Daemon', 'Disable Daemon Mode').then(action => {
                                if (action === 'Start Daemon') {
                                    vscode.commands.executeCommand('beadsKanban.showDaemonActions');
                                }
                                else if (action === 'Disable Daemon Mode') {
                                    vscode.workspace.getConfiguration('beadsKanban').update('useDaemonAdapter', false, true);
                                }
                            });
                        }
                    }
                }
            }
            catch (e) {
                statusBarItem.text = "$(error) Beads Daemon";
                statusBarItem.tooltip = `Error: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`;
                statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
            }
        };
        startDaemonPolling = () => {
            if (pollInterval)
                return; // Already polling
            updateDaemonStatus(); // Initial check
            pollInterval = setInterval(updateDaemonStatus, 10000);
        };
        stopDaemonPolling = () => {
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
        };
        // Cleanup on extension deactivation
        context.subscriptions.push({ dispose: stopDaemonPolling });
        // Register daemon actions command
        context.subscriptions.push(vscode.commands.registerCommand("beadsKanban.showDaemonActions", async () => {
            const actions = [
                { label: "$(info) Show Status", action: "status" },
                { label: "$(play) Start Daemon", action: "start" },
                { label: "$(list-tree) List All Daemons", action: "list" },
                { label: "$(pulse) Check Health", action: "health" },
                { label: "$(debug-restart) Restart Daemon", action: "restart" },
                { label: "$(debug-stop) Stop Daemon", action: "stop" },
                { label: "$(output) View Logs", action: "logs" }
            ];
            const selected = await vscode.window.showQuickPick(actions, {
                placeHolder: "Select daemon action"
            });
            if (!selected)
                return;
            try {
                switch (selected.action) {
                    case "status": {
                        const status = await daemonManager.getStatus();
                        const msg = status.running
                            ? `Daemon is running${status.pid ? ` (PID ${status.pid})` : ''}`
                            : `Daemon is not running${status.error ? `: ${status.error}` : ''}`;
                        vscode.window.showInformationMessage(msg);
                        break;
                    }
                    case "start": {
                        await daemonManager.start();
                        vscode.window.showInformationMessage("Daemon started");
                        updateDaemonStatus();
                        break;
                    }
                    case "list": {
                        const daemons = await daemonManager.listAllDaemons();
                        if (daemons.length === 0) {
                            vscode.window.showInformationMessage("No daemons running");
                        }
                        else {
                            const list = daemons.map(d => `${d.workspace} (PID ${d.pid}, v${d.version})`).join("\n");
                            vscode.window.showInformationMessage(`Running daemons:\n${list}`);
                        }
                        break;
                    }
                    case "health": {
                        const health = await daemonManager.checkHealth();
                        if (health.healthy) {
                            vscode.window.showInformationMessage("Daemon is healthy");
                        }
                        else {
                            vscode.window.showWarningMessage(`Daemon issues:\n${health.issues.join("\n")}`);
                        }
                        break;
                    }
                    case "restart": {
                        await daemonManager.restart();
                        vscode.window.showInformationMessage("Daemon restarted");
                        updateDaemonStatus();
                        break;
                    }
                    case "stop": {
                        await daemonManager.stop();
                        vscode.window.showInformationMessage("Daemon stopped");
                        updateDaemonStatus();
                        break;
                    }
                    case "logs": {
                        const logs = await daemonManager.getLogs(50);
                        const doc = await vscode.workspace.openTextDocument({
                            content: logs,
                            language: "log"
                        });
                        await vscode.window.showTextDocument(doc);
                        break;
                    }
                }
            }
            catch (e) {
                vscode.window.showErrorMessage(`Daemon action failed: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
            }
        }));
    }
    const openCmd = vscode.commands.registerCommand("beadsKanban.openBoard", async () => {
        try {
            output.appendLine('[Extension] === Opening Beads Kanban Board ===');
            output.appendLine('[Extension] Creating webview panel...');
            const panel = vscode.window.createWebviewPanel("beadsKanban.board", "Beads Kanban", vscode.ViewColumn.One, {
                enableScripts: true,
                retainContextWhenHidden: true
            });
            output.appendLine('[Extension] Webview panel created');
            // Track panel lifecycle for daemon polling optimization
            activePanelCount++;
            if (activePanelCount === 1 && startDaemonPolling) {
                startDaemonPolling(); // Start polling when first panel opens
            }
            const readOnly = vscode.workspace.getConfiguration().get("beadsKanban.readOnly", false);
            // Track disposal state and initial load
            let isDisposed = false;
            let initialLoadSent = false;
            // Cancellation token for async operations to prevent posting after disposal
            // This prevents the race condition between checking isDisposed and calling postMessage
            const cancellationToken = { cancelled: false };
            // Track loaded ranges per column for incremental loading
            const loadedRanges = new Map();
            // Initialize with empty arrays for each column
            loadedRanges.set('ready', []);
            loadedRanges.set('in_progress', []);
            loadedRanges.set('blocked', []);
            loadedRanges.set('closed', []);
            const post = (msg) => {
                if (isDisposed) {
                    output.appendLine(`[Extension] Attempted to post to disposed webview: ${msg.type}`);
                    return;
                }
                try {
                    panel.webview.postMessage(msg);
                }
                catch (e) {
                    output.appendLine(`[Extension] Error posting message: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                    isDisposed = true; // Mark as disposed if posting fails
                }
            };
            const sendBoard = async (requestId) => {
                if (isDisposed) {
                    output.appendLine(`[Extension] Skipping sendBoard - webview is disposed`);
                    return;
                }
                output.appendLine(`[Extension] sendBoard called with requestId: ${requestId}`);
                initialLoadSent = true; // Mark that we've sent board data
                try {
                    // Phase 1-3: Prefer fast minimal loading if available
                    const supportsFastLoading = typeof adapter.getBoardMinimal === 'function';
                    if (supportsFastLoading) {
                        output.appendLine(`[Extension] Using fast loading path (getBoardMinimal)`);
                        const cards = await adapter.getBoardMinimal();
                        output.appendLine(`[Extension] Loaded ${cards.length} minimal cards for refresh`);
                        // Check cancellation before posting
                        if (!cancellationToken.cancelled) {
                            post({ type: "board.minimal", requestId, payload: { cards } });
                        }
                        else {
                            output.appendLine(`[Extension] Skipped posting board.minimal - operation cancelled`);
                        }
                        return;
                    }
                    // Fallback: Read configuration settings for incremental loading
                    const config = vscode.workspace.getConfiguration('beadsKanban');
                    const initialLoadLimit = config.get('initialLoadLimit', 100);
                    const preloadClosedColumn = config.get('preloadClosedColumn', false);
                    output.appendLine(`[Extension] Using initialLoadLimit: ${initialLoadLimit}, preloadClosedColumn: ${preloadClosedColumn}`);
                    // Check if adapter supports incremental loading
                    const supportsIncremental = typeof adapter.getColumnData === 'function' && typeof adapter.getColumnCount === 'function';
                    if (supportsIncremental) {
                        // Use incremental loading approach
                        output.appendLine(`[Extension] Using incremental loading for initial board data`);
                        const columnsToPreload = ['ready', 'in_progress', 'blocked'];
                        if (preloadClosedColumn) {
                            columnsToPreload.push('closed');
                        }
                        // Load initial data for each column using proper types
                        // Initialize all columns to satisfy ColumnDataMap type
                        const columnDataMap = {};
                        // Initialize 'open' column with empty data (not displayed in UI)
                        const openTotalCount = await adapter.getColumnCount('open');
                        columnDataMap['open'] = {
                            cards: [],
                            offset: 0,
                            limit: 0,
                            totalCount: openTotalCount,
                            hasMore: openTotalCount > 0
                        };
                        for (const column of columnsToPreload) {
                            try {
                                const cards = await adapter.getColumnData(column, 0, initialLoadLimit);
                                const totalCount = await adapter.getColumnCount(column);
                                const hasMore = initialLoadLimit < totalCount;
                                const columnData = {
                                    cards,
                                    offset: 0,
                                    limit: initialLoadLimit,
                                    totalCount,
                                    hasMore
                                };
                                columnDataMap[column] = columnData;
                                // Track loaded range
                                const ranges = loadedRanges.get(column) || [];
                                ranges.push({ offset: 0, limit: initialLoadLimit });
                                loadedRanges.set(column, ranges);
                                output.appendLine(`[Extension] Loaded ${cards.length}/${totalCount} cards for column ${column}`);
                            }
                            catch (columnError) {
                                output.appendLine(`[Extension] Error loading column ${column}: ${(0, sanitizeError_1.sanitizeErrorWithContext)(columnError)}`);
                                // Initialize with empty data on error
                                const emptyColumnData = {
                                    cards: [],
                                    offset: 0,
                                    limit: initialLoadLimit,
                                    totalCount: 0,
                                    hasMore: false
                                };
                                columnDataMap[column] = emptyColumnData;
                            }
                        }
                        // Initialize closed column with empty data if not preloaded
                        if (!preloadClosedColumn) {
                            const totalCount = await adapter.getColumnCount('closed');
                            const closedColumnData = {
                                cards: [],
                                offset: 0,
                                limit: 0,
                                totalCount,
                                hasMore: totalCount > 0
                            };
                            columnDataMap['closed'] = closedColumnData;
                            output.appendLine(`[Extension] Closed column not preloaded (${totalCount} total cards available)`);
                        }
                        // Use getBoardMetadata() instead of getBoard() to avoid loading all issues
                        const data = await adapter.getBoardMetadata();
                        data.columnData = columnDataMap;
                        // Validate markdown content in column cards (defense-in-depth)
                        // Note: data.cards is now empty array from getBoardMetadata, actual cards are in columnData
                        // Also validate cards in columnData
                        for (const column of Object.keys(columnDataMap)) {
                            const columnCards = columnDataMap[column]?.cards;
                            if (columnCards && columnCards.length > 0) {
                                validateBoardCards(columnCards, output);
                            }
                        }
                        output.appendLine(`[Extension] Sending incremental board data with columnData`);
                        // Check cancellation before posting to prevent race with disposal
                        if (!cancellationToken.cancelled) {
                            post({ type: "board.data", requestId, payload: data });
                        }
                        else {
                            output.appendLine(`[Extension] Skipped posting board.data - operation cancelled`);
                        }
                    }
                    else {
                        // Fallback to legacy full load
                        output.appendLine(`[Extension] Adapter does not support incremental loading, using legacy getBoard()`);
                        const data = await adapter.getBoard();
                        output.appendLine(`[Extension] Got board data: ${data.cards?.length || 0} cards`);
                        // Validate markdown content in all cards (defense-in-depth)
                        validateBoardCards(data.cards || [], output);
                        // Check cancellation before posting to prevent race with disposal
                        if (!cancellationToken.cancelled) {
                            post({ type: "board.data", requestId, payload: data });
                        }
                        else {
                            output.appendLine(`[Extension] Skipped posting board.data - operation cancelled`);
                        }
                    }
                    output.appendLine(`[Extension] Posted board.data message`);
                }
                catch (e) {
                    output.appendLine(`[Extension] Error in sendBoard: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                    // Check both disposal flag and cancellation token
                    if (!isDisposed && !cancellationToken.cancelled) {
                        post({ type: "mutation.error", requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                    }
                }
            };
            const handleLoadColumn = async (requestId, column, offset, limit) => {
                if (isDisposed) {
                    output.appendLine(`[Extension] Skipping handleLoadColumn - webview is disposed`);
                    return;
                }
                output.appendLine(`[Extension] handleLoadColumn: column=${column}, offset=${offset}, limit=${limit}`);
                try {
                    // Validate the request
                    const validation = types_1.BoardLoadColumnSchema.safeParse({ column, offset, limit });
                    if (!validation.success) {
                        post({ type: "mutation.error", requestId, error: `Invalid loadColumn request: ${validation.error.message}` });
                        return;
                    }
                    // Load the column data
                    const cards = await adapter.getColumnData(column, offset, limit);
                    const totalCount = await adapter.getColumnCount(column);
                    const hasMore = (offset + cards.length) < totalCount;
                    // Track loaded range
                    const ranges = loadedRanges.get(column) || [];
                    ranges.push({ offset, limit });
                    loadedRanges.set(column, ranges);
                    output.appendLine(`[Extension] Loaded ${cards.length} cards for column ${column} (${offset}-${offset + cards.length}/${totalCount})`);
                    // Send response - check cancellation before posting
                    if (!cancellationToken.cancelled) {
                        post({
                            type: 'board.columnData',
                            requestId,
                            payload: { column, cards, offset, totalCount, hasMore }
                        });
                    }
                    else {
                        output.appendLine(`[Extension] Skipped posting board.columnData - operation cancelled`);
                    }
                }
                catch (e) {
                    output.appendLine(`[Extension] Error in handleLoadColumn: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                    // Check both disposal flag and cancellation token
                    if (!isDisposed && !cancellationToken.cancelled) {
                        post({ type: "mutation.error", requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                    }
                }
            };
            const handleLoadMore = async (requestId, column) => {
                if (isDisposed) {
                    output.appendLine(`[Extension] Skipping handleLoadMore - webview is disposed`);
                    return;
                }
                output.appendLine(`[Extension] handleLoadMore: column=${column}`);
                try {
                    // Validate the request
                    const validation = types_1.BoardLoadMoreSchema.safeParse({ column });
                    if (!validation.success) {
                        // Check cancellation before posting error
                        if (!cancellationToken.cancelled) {
                            post({ type: "mutation.error", requestId, error: `Invalid loadMore request: ${validation.error.message}` });
                        }
                        return;
                    }
                    // Calculate next offset from loadedRanges
                    const ranges = loadedRanges.get(column) || [];
                    const nextOffset = ranges.reduce((max, r) => Math.max(max, r.offset + r.limit), 0);
                    // Use configured pageSize
                    const pageSize = vscode.workspace.getConfiguration('beadsKanban').get('pageSize', 50);
                    output.appendLine(`[Extension] Loading more for column ${column} from offset ${nextOffset} with pageSize ${pageSize}`);
                    // Delegate to handleLoadColumn logic
                    await handleLoadColumn(requestId, column, nextOffset, pageSize);
                }
                catch (e) {
                    output.appendLine(`[Extension] Error in handleLoadMore: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                    // Check both disposal flag and cancellation token
                    if (!isDisposed && !cancellationToken.cancelled) {
                        post({ type: "mutation.error", requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                    }
                }
            };
            const handleTableLoadPage = async (requestId, filters, sorting, offset, limit) => {
                if (isDisposed) {
                    output.appendLine(`[Extension] Skipping handleTableLoadPage - webview is disposed`);
                    return;
                }
                output.appendLine(`[Extension] handleTableLoadPage: offset=${offset}, limit=${limit}, filters=${JSON.stringify(filters)}, sorting=${JSON.stringify(sorting)}`);
                try {
                    // Call adapter's getTableData method
                    const result = await adapter.getTableData(filters, sorting, offset, limit);
                    // Validate markdown content in returned cards (defense-in-depth)
                    validateBoardCards(result.cards, output);
                    output.appendLine(`[Extension] Loaded ${result.cards.length} cards for table (${offset}-${offset + result.cards.length}/${result.totalCount})`);
                    // Send response - check cancellation before posting
                    if (!cancellationToken.cancelled) {
                        post({
                            type: 'table.pageData',
                            requestId,
                            payload: {
                                cards: result.cards,
                                offset,
                                totalCount: result.totalCount,
                                hasMore: (offset + result.cards.length) < result.totalCount
                            }
                        });
                    }
                    else {
                        output.appendLine(`[Extension] Skipped posting table.pageData - operation cancelled`);
                    }
                }
                catch (e) {
                    output.appendLine(`[Extension] Error in handleTableLoadPage: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                    // Check both disposal flag and cancellation token
                    if (!isDisposed && !cancellationToken.cancelled) {
                        post({ type: "mutation.error", requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                    }
                }
            };
            // Set up message handler BEFORE setting HTML to avoid race condition
            panel.webview.onDidReceiveMessage(async (msg) => {
                output.appendLine(`[Extension] Received message: ${msg?.type} (requestId: ${msg?.requestId})`);
                if (!msg?.type || !msg.requestId)
                    return;
                if (msg.type === "board.load" || msg.type === "board.refresh") {
                    sendBoard(msg.requestId);
                    return;
                }
                if (msg.type === "board.loadColumn") {
                    const { column, offset, limit } = msg.payload;
                    await handleLoadColumn(msg.requestId, column, offset, limit);
                    return;
                }
                if (msg.type === "board.loadMore") {
                    const { column } = msg.payload;
                    await handleLoadMore(msg.requestId, column);
                    return;
                }
                if (msg.type === "board.loadMinimal") {
                    try {
                        // Check if adapter supports fast loading
                        if (typeof adapter.getBoardMinimal !== 'function') {
                            post({ type: "mutation.error", requestId: msg.requestId, error: "Adapter does not support fast minimal loading. Please enable daemon mode or update your adapter." });
                            return;
                        }
                        output.appendLine(`[Extension] Loading minimal board data`);
                        const cards = await adapter.getBoardMinimal();
                        output.appendLine(`[Extension] Loaded ${cards.length} minimal cards`);
                        // Check cancellation before posting
                        if (!cancellationToken.cancelled) {
                            post({ type: "board.minimal", requestId: msg.requestId, payload: { cards } });
                        }
                        else {
                            output.appendLine(`[Extension] Skipped posting board.minimal - operation cancelled`);
                        }
                    }
                    catch (e) {
                        output.appendLine(`[Extension] Error loading minimal board: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                        if (!isDisposed && !cancellationToken.cancelled) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                        }
                    }
                    return;
                }
                if (msg.type === "issue.getFull") {
                    try {
                        const issueId = msg.payload.id;
                        // Validate issue ID
                        if (!issueId || typeof issueId !== 'string' || issueId.length === 0 || issueId.length > 100) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: "Invalid issue ID provided" });
                            return;
                        }
                        // Check if adapter supports fast loading
                        if (typeof adapter.getIssueFull !== 'function') {
                            post({ type: "mutation.error", requestId: msg.requestId, error: "Adapter does not support full issue loading. Please enable daemon mode or update your adapter." });
                            return;
                        }
                        output.appendLine(`[Extension] Loading full details for issue ${issueId}`);
                        const card = await adapter.getIssueFull(issueId);
                        output.appendLine(`[Extension] Loaded full card for ${issueId}`);
                        // Validate markdown content (defense-in-depth)
                        const fullCardValid = (0, markdownValidator_1.validateMarkdownFields)({
                            description: card.description,
                            acceptance_criteria: card.acceptance_criteria,
                            design: card.design,
                            notes: card.notes
                        }, output);
                        if (!fullCardValid) {
                            output.appendLine(`[Extension] Warning: Suspicious content detected in full card ${issueId}`);
                            // Log warning but allow return (defense-in-depth, not blocking)
                        }
                        // Check cancellation before posting
                        if (!cancellationToken.cancelled) {
                            post({ type: "issue.full", requestId: msg.requestId, payload: { card } });
                        }
                        else {
                            output.appendLine(`[Extension] Skipped posting issue.full - operation cancelled`);
                        }
                    }
                    catch (e) {
                        output.appendLine(`[Extension] Error loading full issue: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                        if (!isDisposed && !cancellationToken.cancelled) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: (0, sanitizeError_1.sanitizeErrorWithContext)(e) });
                        }
                    }
                    return;
                }
                if (msg.type === "table.loadPage") {
                    const { filters, sorting, offset, limit } = msg.payload;
                    await handleTableLoadPage(msg.requestId, filters, sorting, offset, limit);
                    return;
                }
                if (msg.type === "repo.select") {
                    // Open folder picker to select a different beads repository
                    const selectedFolder = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: "Select Beads Repository Folder",
                        title: "Select a folder containing a .beads directory"
                    });
                    if (selectedFolder && selectedFolder[0]) {
                        const folderPath = selectedFolder[0].fsPath;
                        const fs = await Promise.resolve().then(() => __importStar(require('fs/promises')));
                        const path = await Promise.resolve().then(() => __importStar(require('path')));
                        const beadsPath = path.join(folderPath, '.beads');
                        try {
                            const stat = await fs.stat(beadsPath);
                            if (!stat.isDirectory()) {
                                vscode.window.showErrorMessage(`Selected folder does not contain a .beads directory.`);
                                post({ type: "mutation.error", requestId: msg.requestId, error: "No .beads directory found" });
                                return;
                            }
                            // Store the selected path in workspace state for future sessions
                            await context.workspaceState.update('beadsRepoPath', folderPath);
                            // Show info message
                            vscode.window.showInformationMessage(`Switched to repository: ${folderPath}. Please reload the extension to apply changes.`, 'Reload')
                                .then(action => {
                                if (action === 'Reload') {
                                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                                }
                            });
                            post({ type: "mutation.ok", requestId: msg.requestId });
                        }
                        catch (err) {
                            vscode.window.showErrorMessage(`Selected folder does not contain a .beads directory.`);
                            post({ type: "mutation.error", requestId: msg.requestId, error: "No .beads directory found" });
                        }
                    }
                    else {
                        // User cancelled
                        post({ type: "mutation.ok", requestId: msg.requestId });
                    }
                    return;
                }
                if (readOnly) {
                    post({ type: "mutation.error", requestId: msg.requestId, error: "Extension is in read-only mode." });
                    return;
                }
                try {
                    if (msg.type === "issue.create") {
                        const validation = types_1.IssueCreateSchema.safeParse(msg.payload);
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid issue data: ${validation.error.message}` });
                            return;
                        }
                        // Validate markdown content (defense-in-depth)
                        const createValid = (0, markdownValidator_1.validateMarkdownFields)({
                            description: validation.data.description
                        }, output);
                        if (!createValid) {
                            output.appendLine(`[Extension] Warning: Suspicious content detected in new issue`);
                            // Log warning but allow creation (defense-in-depth, not blocking)
                        }
                        await adapter.createIssue(validation.data);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        // push refreshed board
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.move") {
                        const toStatus = mapColumnToStatus(msg.payload.toColumn);
                        const validation = types_1.SetStatusSchema.safeParse({
                            id: msg.payload.id,
                            status: toStatus
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid move data: ${validation.error.message}` });
                            return;
                        }
                        await adapter.setIssueStatus(validation.data.id, validation.data.status);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.addToChat") {
                        if (!msg.payload.text || msg.payload.text.length > MAX_CHAT_TEXT) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Text too large for chat (max ${MAX_CHAT_TEXT} characters)` });
                            return;
                        }
                        vscode.commands.executeCommand("workbench.action.chat.open", { query: msg.payload.text });
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        return;
                    }
                    if (msg.type === "issue.copyToClipboard") {
                        if (!msg.payload.text || msg.payload.text.length > MAX_CLIPBOARD_TEXT) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Text too large for clipboard (max ${MAX_CLIPBOARD_TEXT} characters)` });
                            return;
                        }
                        // Sanitize for CSV injection before copying to clipboard
                        const sanitizedText = sanitizeForCSV(msg.payload.text);
                        vscode.env.clipboard.writeText(sanitizedText);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        vscode.window.showInformationMessage("Issue context copied to clipboard.");
                        return;
                    }
                    if (msg.type === "issue.update") {
                        const validation = types_1.IssueUpdateSchema.safeParse(msg.payload);
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid update data: ${validation.error.message}` });
                            return;
                        }
                        // Validate markdown content in updates (defense-in-depth)
                        const updateValid = (0, markdownValidator_1.validateMarkdownFields)({
                            description: validation.data.updates.description,
                            acceptance_criteria: validation.data.updates.acceptance_criteria,
                            design: validation.data.updates.design,
                            notes: validation.data.updates.notes
                        }, output);
                        if (!updateValid) {
                            output.appendLine(`[Extension] Warning: Suspicious content detected in issue update`);
                            // Log warning but allow update (defense-in-depth, not blocking)
                        }
                        await adapter.updateIssue(validation.data.id, validation.data.updates);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.addComment") {
                        // TODO: Attempt to get git user name or vs code user name?
                        // For now, default to "Me" or let UI send it?
                        // Let's use a simple default here if not provided.
                        const author = msg.payload.author || "User";
                        const validation = types_1.CommentAddSchema.safeParse({
                            id: msg.payload.id,
                            text: msg.payload.text,
                            author
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid comment data: ${validation.error.message}` });
                            return;
                        }
                        // Validate comment markdown content (defense-in-depth)
                        const commentValidation = (0, markdownValidator_1.validateCommentContent)(validation.data.text, output);
                        if (!commentValidation.isValid) {
                            output.appendLine(`[Extension] Warning: Suspicious content detected in comment`);
                            // Log warning but allow comment (defense-in-depth, not blocking)
                        }
                        await adapter.addComment(validation.data.id, validation.data.text, validation.data.author);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.addLabel") {
                        const validation = types_1.LabelSchema.safeParse({
                            id: msg.payload.id,
                            label: msg.payload.label
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid label data: ${validation.error.message}` });
                            return;
                        }
                        await adapter.addLabel(validation.data.id, validation.data.label);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.removeLabel") {
                        const validation = types_1.LabelSchema.safeParse({
                            id: msg.payload.id,
                            label: msg.payload.label
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid label data: ${validation.error.message}` });
                            return;
                        }
                        await adapter.removeLabel(validation.data.id, validation.data.label);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.addDependency") {
                        const validation = types_1.DependencySchema.safeParse({
                            id: msg.payload.id,
                            otherId: msg.payload.otherId,
                            type: msg.payload.type
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid dependency data: ${validation.error.message}` });
                            return;
                        }
                        await adapter.addDependency(validation.data.id, validation.data.otherId, validation.data.type);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    if (msg.type === "issue.removeDependency") {
                        const validation = types_1.DependencySchema.safeParse({
                            id: msg.payload.id,
                            otherId: msg.payload.otherId
                        });
                        if (!validation.success) {
                            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid dependency data: ${validation.error.message}` });
                            return;
                        }
                        await adapter.removeDependency(validation.data.id, validation.data.otherId);
                        post({ type: "mutation.ok", requestId: msg.requestId });
                        await sendBoard(msg.requestId);
                        return;
                    }
                    post({ type: "mutation.error", requestId: msg.requestId, error: `Unknown message type: ${msg.type}` });
                }
                catch (e) {
                    post({
                        type: "mutation.error",
                        requestId: msg.requestId,
                        error: (0, sanitizeError_1.sanitizeErrorWithContext)(e)
                    });
                }
            });
            // Set HTML after message handler is ready to avoid race condition
            output.appendLine('[Extension] Setting webview HTML');
            try {
                panel.webview.html = (0, webview_1.getWebviewHtml)(panel.webview, context.extensionUri);
                output.appendLine('[Extension] Webview HTML set successfully');
            }
            catch (e) {
                output.appendLine(`[Extension] Error setting webview HTML: ${(0, sanitizeError_1.sanitizeErrorWithContext)(e)}`);
                isDisposed = true;
                return;
            }
            // Auto refresh when DB files change
            const ws = vscode.workspace.workspaceFolders?.[0];
            if (ws) {
                const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(ws, ".beads/**/*.{db,sqlite,sqlite3}"));
                let refreshTimeout = null;
                let changeCount = 0; // Track changes during debounce window
                const refresh = (uri) => {
                    // Ignore WAL/SHM/Journal files which change frequently during reads
                    if (uri && (uri.fsPath.endsWith('-wal') || uri.fsPath.endsWith('-shm') || uri.fsPath.endsWith('-journal'))) {
                        return;
                    }
                    // Log what triggered the refresh
                    if (uri) {
                        output.appendLine(`[Extension] File changed: ${uri.fsPath}`);
                    }
                    else {
                        output.appendLine(`[Extension] File changed (unknown URI)`);
                    }
                    // Skip refresh if this change is from our own save operation
                    if (adapter.isRecentSelfSave()) {
                        output.appendLine(`[Extension] Ignoring change due to recent self-save/interaction`);
                        return;
                    }
                    // Track rapid changes for monitoring
                    changeCount++;
                    if (changeCount > 3) {
                        output.appendLine(`[Extension] Warning: ${changeCount} rapid file changes detected in debounce window. This may indicate external tool making frequent DB updates. Consider increasing debounce delay if you see stale data.`);
                    }
                    if (refreshTimeout) {
                        clearTimeout(refreshTimeout);
                    }
                    refreshTimeout = setTimeout(async () => {
                        try {
                            // Reload database from disk to pick up external changes
                            await adapter.reloadDatabase();
                            const requestId = `fs-${Date.now()}`;
                            sendBoard(requestId);
                        }
                        catch (error) {
                            const errorMsg = `Failed to reload database: ${(0, sanitizeError_1.sanitizeErrorWithContext)(error)}`;
                            // Send error to webview
                            panel.webview.postMessage({
                                type: "mutation.error",
                                requestId: `fs-error-${Date.now()}`,
                                error: errorMsg
                            });
                            // Show warning to user so they know auto-refresh is broken
                            vscode.window.showWarningMessage(`Beads auto-refresh failed: ${errorMsg}. Use the Refresh button to try again.`);
                        }
                        // Reset change tracking after refresh completes
                        changeCount = 0;
                        refreshTimeout = null;
                    }, 300);
                };
                watcher.onDidChange(refresh);
                watcher.onDidCreate(refresh);
                watcher.onDidDelete(refresh);
                panel.onDidDispose(() => {
                    output.appendLine('[Extension] Panel disposed');
                    isDisposed = true;
                    // Cancel all pending async operations to prevent posting after disposal
                    cancellationToken.cancelled = true;
                    // Try to send cleanup message to webview before disposal
                    try {
                        panel.webview.postMessage({ type: 'webview.cleanup' });
                    }
                    catch (e) {
                        // Webview already disposed, ignore
                    }
                    // Clear loaded ranges tracking
                    loadedRanges.clear();
                    if (refreshTimeout) {
                        clearTimeout(refreshTimeout);
                    }
                    watcher.dispose();
                    // Stop polling when last panel closes
                    activePanelCount--;
                    if (activePanelCount === 0 && stopDaemonPolling) {
                        stopDaemonPolling();
                    }
                });
            }
            // initial load - give webview time to initialize (safety net)
            // Skip if webview already requested the initial load
            output.appendLine('[Extension] Triggering initial board load timeout');
            setTimeout(() => {
                if (isDisposed) {
                    output.appendLine('[Extension] Panel disposed before initial load timeout');
                }
                else if (initialLoadSent) {
                    output.appendLine('[Extension] Skipping timeout load - webview already loaded');
                }
                else {
                    output.appendLine('[Extension] Sending initial board data from timeout');
                    sendBoard(`init-${Date.now()}`);
                }
            }, 500);
        }
        catch (error) {
            output.appendLine(`[Extension] Error in openBoard command: ${(0, sanitizeError_1.sanitizeErrorWithContext)(error)}`);
            vscode.window.showErrorMessage(`Failed to open Beads Kanban: ${(0, sanitizeError_1.sanitizeErrorWithContext)(error)}`);
        }
    });
    context.subscriptions.push(openCmd);
}
function deactivate() {
    // nothing
}
function mapColumnToStatus(col) {
    // Map column keys to issue statuses
    // Ready is derived from `ready_issues` view; status is still "open"
    const mapping = {
        ready: "open",
        open: "open",
        in_progress: "in_progress",
        blocked: "blocked",
        closed: "closed"
    };
    const status = mapping[col];
    if (!status) {
        throw new Error(`Invalid column: ${col}`);
    }
    return status;
}

import * as vscode from "vscode";
import { DaemonBeadsAdapter } from "./daemonBeadsAdapter";
import { DaemonManager } from "./daemonManager";
import { getWebviewHtml } from "./webview";
import { sanitizeErrorWithContext as sanitizeError } from "./sanitizeError";
import { validateMarkdownFields, validateCommentContent } from "./markdownValidator";
import {
  BoardData,
  BoardCard,
  MinimalCard,
  FullCard,
  BoardColumnKey,
  IssueStatus,
  IssueUpdateSchema,
  IssueCreateSchema,
  CommentAddSchema,
  LabelSchema,
  DependencySchema,
  SetStatusSchema,
  BoardLoadColumnSchema,
  BoardLoadMoreSchema,
  ColumnDataMap,
  ColumnData,
  IssueIdSchema
} from "./types";

type WebMsg =
  | { type: "board.load"; requestId: string }
  | { type: "board.refresh"; requestId: string }
  | { type: "board.loadMinimal"; requestId: string }
  | { type: "board.loadColumn"; requestId: string; payload: { column: BoardColumnKey; offset: number; limit: number } }
  | { type: "board.loadMore"; requestId: string; payload: { column: BoardColumnKey } }
  | { type: "table.loadPage"; requestId: string; payload: { filters: any; sorting: Array<{ id: string; dir: 'asc' | 'desc' }>; offset: number; limit: number } }
  | { type: "repo.select"; requestId: string }
  | { type: "issue.create"; requestId: string; payload: { title: string; description?: string } }
  | { type: "issue.move"; requestId: string; payload: { id: string; toColumn: BoardColumnKey } }
  | { type: "issue.getFull"; requestId: string; payload: { id: string } }
  | { type: "issue.addToChat"; requestId: string; payload: { text: string } }
  | { type: "issue.copyToClipboard"; requestId: string; payload: { text: string } }
  | { type: "issue.update"; requestId: string; payload: { id: string; updates: any } }
  | { type: "issue.addComment"; requestId: string; payload: { id: string; text: string; author?: string } }
  | { type: "issue.addLabel"; requestId: string; payload: { id: string; label: string } }
  | { type: "issue.removeLabel"; requestId: string; payload: { id: string; label: string } }
  | { type: "issue.addDependency"; requestId: string; payload: { id: string; otherId: string; type: 'parent-child' | 'blocks' } }
  | { type: "issue.removeDependency"; requestId: string; payload: { id: string; otherId: string } };

type ExtMsg =
  | { type: "board.data"; requestId: string; payload: BoardData }
  | { type: "board.minimal"; requestId: string; payload: { cards: MinimalCard[] } }
  | { type: "board.columnData"; requestId: string; payload: { column: BoardColumnKey; cards: BoardCard[]; offset: number; totalCount: number; hasMore: boolean } }
  | { type: "table.pageData"; requestId: string; payload: { cards: BoardCard[]; offset: number; totalCount: number; hasMore: boolean } }
  | { type: "issue.full"; requestId: string; payload: { card: FullCard } }
  | { type: "mutation.ok"; requestId: string }
  | { type: "mutation.error"; requestId: string; error: string };

// Size limits for text operations
const MAX_CHAT_TEXT = 50_000; // 50KB reasonable for chat
const MAX_CLIPBOARD_TEXT = 100_000; // 100KB for clipboard

// Sanitize error messages to prevent leaking implementation details
// sanitizeError is now imported from ./sanitizeError

/**
 * Sanitizes text for CSV injection attacks.
 * Uses OWASP-recommended double-quote escaping: https://owasp.org/www-community/attacks/CSV_Injection
 *
 * Defense layers:
 * 1. Strip control characters (prevents tab-prefixed formulas)
 * 2. Prefix dangerous start characters with single quote (defense-in-depth)
 * 3. Wrap entire field in double quotes with proper CSV escaping (standard approach)
 *
 * @param text - The text to sanitize
 * @returns Sanitized text safe for clipboard/CSV
 */
function sanitizeForCSV(text: string): string {
  if (!text || text.length === 0) {
    return '""'; // Empty cells should still be quoted
  }

  // Replace control characters (including tabs, newlines, null bytes) with spaces
  // This prevents cell splitting and tab-prefixed formula injection
  let sanitized = text.replace(/[\x00-\x1F\x7F]/g, ' ');

  // Check for formula-triggering characters at start: =, +, -, @, |, whitespace
  // Note: Pipe (|) is used in some CSV injection techniques
  const dangerousStart = /^[\s=+\-@|]/;

  if (dangerousStart.test(sanitized)) {
    // Prefix with single quote as an additional defense layer
    sanitized = "'" + sanitized;
  }

  // Standard CSV escaping: wrap in double quotes and escape internal quotes by doubling them
  // This is the OWASP-recommended approach and universally supported by CSV parsers
  sanitized = sanitized.replace(/"/g, '""');
  sanitized = '"' + sanitized + '"';

  return sanitized;
}

/**
 * Validates markdown content in all cards before sending to webview.
 * Logs warnings for suspicious content but does not block sending.
 * This is a defense-in-depth measure - webview still uses DOMPurify.
 * Async and chunked to prevent blocking the event loop on large datasets.
 */
async function validateBoardCards(cards: BoardCard[], output: vscode.OutputChannel): Promise<void> {
  const CHUNK_SIZE = 50;
  for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
    const chunk = cards.slice(i, i + CHUNK_SIZE);
    
    // Process chunk synchronously
    for (const card of chunk) {
      validateMarkdownFields({
        description: card.description,
        acceptance_criteria: card.acceptance_criteria,
        design: card.design,
        notes: card.notes
      }, output);
    }
    
    // Yield to event loop to prevent freezing UI
    if (i + CHUNK_SIZE < cards.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Beads Kanban");
  output.appendLine('[BeadsAdapter] Environment Versions: ' + JSON.stringify(process.versions, null, 2));

  context.subscriptions.push(output);

  // Always use DaemonBeadsAdapter (v2.0+ is daemon-only)
  let adapter: DaemonBeadsAdapter | null = null;
  let adapterWorkspaceRoot: string | null = null;
  let daemonManager: DaemonManager | null = null;
  let daemonWorkspaceRoot: string | null = null;
  let statusBarItem: vscode.StatusBarItem | null = null;
  let updateDaemonStatus: (() => void) | null = null;
  let autoStartAttempted = false;

  const ensureAdapter = (): DaemonBeadsAdapter | null => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      return null;
    }

    if (!adapter || adapterWorkspaceRoot !== ws.uri.fsPath) {
      adapter?.dispose();
      output.appendLine('[Extension] Using DaemonBeadsAdapter');
      adapter = new DaemonBeadsAdapter(ws.uri.fsPath, output);
      adapterWorkspaceRoot = ws.uri.fsPath;
    }

    return adapter;
  };

  // Track active panels and polling state (moved here for accessibility)
  let activePanelCount = 0;
  let pollInterval: NodeJS.Timeout | null = null;
  let startDaemonPolling: (() => void) | undefined;
  let stopDaemonPolling: (() => void) | undefined;

  const ensureDaemonManager = (): DaemonManager | null => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      return null;
    }

    if (!daemonManager || daemonWorkspaceRoot !== ws.uri.fsPath) {
      daemonManager = new DaemonManager(ws.uri.fsPath, output);
      daemonWorkspaceRoot = ws.uri.fsPath;
      autoStartAttempted = false;
    }

    if (!statusBarItem) {
      statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
      statusBarItem.text = "$(sync~spin) Beads Daemon";
      statusBarItem.tooltip = "Checking daemon status...";
      statusBarItem.command = "beadsKanban.showDaemonActions";
      statusBarItem.show();
      context.subscriptions.push(statusBarItem);
    }

    if (!updateDaemonStatus) {
      updateDaemonStatus = async () => {
        if (!daemonManager || !statusBarItem) {
          return;
        }

        try {
          const status = await daemonManager.getStatus();
          if (status.running && status.healthy) {
            statusBarItem.text = "$(check) Beads Daemon";
            statusBarItem.tooltip = `Daemon running${status.pid ? ` (PID ${status.pid})` : ''}`;
            statusBarItem.backgroundColor = undefined;
            autoStartAttempted = false; // Reset on successful connection
          } else if (status.running && !status.healthy) {
            statusBarItem.text = "$(warning) Beads Daemon";
            statusBarItem.tooltip = "Daemon unhealthy";
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
          } else {
            // Daemon not running
            statusBarItem.text = "$(circle-slash) Beads Daemon";
            statusBarItem.tooltip = "Daemon not running";
            statusBarItem.backgroundColor = undefined;

            // Auto-start daemon if not running and haven't tried yet
            if (!autoStartAttempted) {
              autoStartAttempted = true;
              output.appendLine('[Extension] Daemon not running, attempting auto-start...');
              try {
                await daemonManager.start();
                output.appendLine('[Extension] Daemon started successfully');
                // Update status immediately after starting
                setTimeout(() => updateDaemonStatus && updateDaemonStatus(), 1000); // Give daemon time to initialize
              } catch (startError) {
                output.appendLine(`[Extension] Failed to auto-start daemon: ${sanitizeError(startError)}`);
                // Show notification with option to start manually
                vscode.window.showWarningMessage(
                  'Beads daemon is not running. The extension requires the daemon to be running.',
                  'Start Daemon'
                ).then(action => {
                  if (action === 'Start Daemon') {
                    vscode.commands.executeCommand('beadsKanban.showDaemonActions');
                  }
                });
              }
            }
          }
        } catch (e) {
          statusBarItem.text = "$(error) Beads Daemon";
          statusBarItem.tooltip = `Error: ${sanitizeError(e)}`;
          statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        }
      };
    }

    return daemonManager;
  };

  startDaemonPolling = () => {
    if (pollInterval || !updateDaemonStatus) return; // Already polling or not initialized
    updateDaemonStatus(); // Initial check
    pollInterval = setInterval(updateDaemonStatus, 10000);
  };

  stopDaemonPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  };

  context.subscriptions.push({ dispose: () => adapter?.dispose() });
  context.subscriptions.push({ dispose: stopDaemonPolling });

  context.subscriptions.push(
    vscode.commands.registerCommand("beadsKanban.showDaemonActions", async () => {
      const manager = ensureDaemonManager();
      if (!manager) {
        vscode.window.showErrorMessage('Beads Kanban requires an open workspace folder.');
        return;
      }

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

      if (!selected) return;

      try {
        switch (selected.action) {
          case "status": {
            const status = await manager.getStatus();
            const msg = status.running
              ? `Daemon is running${status.pid ? ` (PID ${status.pid})` : ''}`
              : `Daemon is not running${status.error ? `: ${status.error}` : ''}`;
            vscode.window.showInformationMessage(msg);
            break;
          }
          case "start": {
            await manager.start();
            vscode.window.showInformationMessage("Daemon started");
            updateDaemonStatus && updateDaemonStatus();
            break;
          }
          case "list": {
            const daemons = await manager.listAllDaemons();
            if (daemons.length === 0) {
              vscode.window.showInformationMessage("No daemons running");
            } else {
              const list = daemons.map(d => `${d.workspace} (PID ${d.pid}, v${d.version})`).join("\n");
              vscode.window.showInformationMessage(`Running daemons:\n${list}`);
            }
            break;
          }
          case "health": {
            const health = await manager.checkHealth();
            if (health.healthy) {
              vscode.window.showInformationMessage("Daemon is healthy");
            } else {
              vscode.window.showWarningMessage(`Daemon issues:\n${health.issues.join("\n")}`);
            }
            break;
          }
          case "restart": {
            await manager.restart();
            vscode.window.showInformationMessage("Daemon restarted");
            updateDaemonStatus && updateDaemonStatus();
            break;
          }
          case "stop": {
            await manager.stop();
            vscode.window.showInformationMessage("Daemon stopped");
            updateDaemonStatus && updateDaemonStatus();
            break;
          }
          case "logs": {
            const logs = await manager.getLogs(50);
            const doc = await vscode.workspace.openTextDocument({
              content: logs,
              language: "log"
            });
            await vscode.window.showTextDocument(doc);
            break;
          }
        }
      } catch (e) {
        vscode.window.showErrorMessage(`Daemon action failed: ${sanitizeError(e)}`);
      }
    })
  );

  if (vscode.workspace.workspaceFolders?.[0]) {
    ensureAdapter();
    ensureDaemonManager();
  }

  const openCmd = vscode.commands.registerCommand("beadsKanban.openBoard", async () => {
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      vscode.window.showErrorMessage('Beads Kanban requires an open workspace folder.');
      return;
    }

    const adapter = ensureAdapter();
    if (!adapter) {
      vscode.window.showErrorMessage('Beads Kanban requires an open workspace folder.');
      return;
    }

    ensureDaemonManager();
    try {
      output.appendLine('[Extension] === Opening Beads Kanban Board ===');
      output.appendLine('[Extension] Creating webview panel...');
    const panel = vscode.window.createWebviewPanel(
      "beadsKanban.board",
      "Beads Kanban",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    output.appendLine('[Extension] Webview panel created');

    // Track panel lifecycle for daemon polling optimization
    activePanelCount++;
    if (activePanelCount === 1 && startDaemonPolling) {
      startDaemonPolling(); // Start polling when first panel opens
    }

    const readOnly = vscode.workspace.getConfiguration().get<boolean>("beadsKanban.readOnly", false);

    // Track disposal state and initial load
    let isDisposed = false;
    let initialLoadSent = false;

    // Cancellation token for async operations to prevent posting after disposal
    // This prevents the race condition between checking isDisposed and calling postMessage
    const cancellationToken = { cancelled: false };

    // Track loaded ranges per column for incremental loading
    const loadedRanges = new Map<BoardColumnKey, Array<{ offset: number; limit: number }>>();
    // Initialize with empty arrays for each column
    loadedRanges.set('ready', []);
    loadedRanges.set('in_progress', []);
    loadedRanges.set('blocked', []);
    loadedRanges.set('closed', []);

    const post = (msg: ExtMsg) => {
      // Atomic check for disposal and cancellation to prevent TOCTOU race condition
      if (isDisposed || cancellationToken.cancelled) {
        output.appendLine(`[Extension] Attempted to post to disposed/cancelled webview: ${msg.type}`);
        return;
      }
      try {
        // Additional check for panel disposal to prevent race conditions
        if (!panel || !panel.webview) {
          output.appendLine(`[Extension] Panel disposed before posting ${msg.type}`);
          isDisposed = true;
          return;
        }
        panel.webview.postMessage(msg);
      } catch (e) {
        output.appendLine(`[Extension] Error posting message: ${sanitizeError(e)}`);
        isDisposed = true; // Mark as disposed if posting fails
      }
    };

    const sendBoard = async (requestId: string) => {
      if (isDisposed) {
        output.appendLine(`[Extension] Skipping sendBoard - webview is disposed`);
        return;
      }
      output.appendLine(`[Extension] sendBoard called with requestId: ${requestId}`);
      initialLoadSent = true; // Mark that we've sent board data
      try {
        // Read configuration settings
        const config = vscode.workspace.getConfiguration('beadsKanban');
        const initialLoadLimit = config.get<number>('initialLoadLimit', 100);

        // Phase 1-3: Prefer fast minimal loading if available
        const supportsFastLoading = typeof (adapter as any).getBoardMinimal === 'function';

        if (supportsFastLoading) {
          output.appendLine(`[Extension] Using fast loading path (getBoardMinimal) with limit: ${initialLoadLimit}`);
          const cards = await (adapter as any).getBoardMinimal(initialLoadLimit);
          output.appendLine(`[Extension] Loaded ${cards.length} minimal cards for refresh`);

          // Check cancellation before posting
          if (!cancellationToken.cancelled) {
            post({ type: "board.minimal", requestId, payload: { cards } });
          } else {
            output.appendLine(`[Extension] Skipped posting board.minimal - operation cancelled`);
          }
          return;
        }

        // Fallback: Use incremental loading
        const preloadClosedColumn = config.get<boolean>('preloadClosedColumn', false);

        output.appendLine(`[Extension] Using initialLoadLimit: ${initialLoadLimit}, preloadClosedColumn: ${preloadClosedColumn}`);

        // Check if adapter supports incremental loading
        const supportsIncremental = typeof adapter.getColumnData === 'function' && typeof adapter.getColumnCount === 'function';

        if (supportsIncremental) {
          // Use incremental loading approach
          output.appendLine(`[Extension] Using incremental loading for initial board data`);

          const columnsToPreload: BoardColumnKey[] = ['ready', 'in_progress', 'blocked'];
          if (preloadClosedColumn) {
            columnsToPreload.push('closed');
          }

          // Load initial data for each column using proper types
          // Initialize all columns to satisfy ColumnDataMap type
          const columnDataMap = {} as ColumnDataMap;

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

              const columnData: ColumnData = {
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
            } catch (columnError) {
              output.appendLine(`[Extension] Error loading column ${column}: ${sanitizeError(columnError)}`);
              // Initialize with empty data on error
              const emptyColumnData: ColumnData = {
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
            const closedColumnData: ColumnData = {
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
          data.readOnly = readOnly; // Propagate read-only mode to webview UI

          // Validate markdown content in column cards (defense-in-depth)
          // Note: data.cards is now empty array from getBoardMetadata, actual cards are in columnData
          // Also validate cards in columnData
          for (const column of Object.keys(columnDataMap)) {
            const columnCards = columnDataMap[column as BoardColumnKey]?.cards;
            if (columnCards && columnCards.length > 0) {
              await validateBoardCards(columnCards, output);
            }
          }

          output.appendLine(`[Extension] Sending incremental board data with columnData`);
          // Check cancellation before posting to prevent race with disposal
          if (!cancellationToken.cancelled) {
            post({ type: "board.data", requestId, payload: data });
          } else {
            output.appendLine(`[Extension] Skipped posting board.data - operation cancelled`);
          }
        } else {
          // Fallback to legacy full load
          output.appendLine(`[Extension] Adapter does not support incremental loading, using legacy getBoard()`);
          const data = await adapter.getBoard();
          data.readOnly = readOnly; // Propagate read-only mode to webview UI
          output.appendLine(`[Extension] Got board data: ${data.cards?.length || 0} cards`);

          // Validate markdown content in all cards (defense-in-depth)
          await validateBoardCards(data.cards || [], output);
          // Check cancellation before posting to prevent race with disposal
          if (!cancellationToken.cancelled) {
            post({ type: "board.data", requestId, payload: data });
          } else {
            output.appendLine(`[Extension] Skipped posting board.data - operation cancelled`);
          }
        }

        output.appendLine(`[Extension] Posted board.data message`);
      } catch (e) {
        output.appendLine(`[Extension] Error in sendBoard: ${sanitizeError(e)}`);
        // Check both disposal flag and cancellation token
        if (!isDisposed && !cancellationToken.cancelled) {
          post({ type: "mutation.error", requestId, error: sanitizeError(e) });
        }
      }
    };

    const handleLoadColumn = async (requestId: string, column: BoardColumnKey, offset: number, limit: number) => {
      if (isDisposed) {
        output.appendLine(`[Extension] Skipping handleLoadColumn - webview is disposed`);
        return;
      }
      output.appendLine(`[Extension] handleLoadColumn: column=${column}, offset=${offset}, limit=${limit}`);
      
      try {
        // Validate the request
        const validation = BoardLoadColumnSchema.safeParse({ column, offset, limit });
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
        } else {
          output.appendLine(`[Extension] Skipped posting board.columnData - operation cancelled`);
        }
      } catch (e) {
        output.appendLine(`[Extension] Error in handleLoadColumn: ${sanitizeError(e)}`);
        // Check both disposal flag and cancellation token
        if (!isDisposed && !cancellationToken.cancelled) {
          post({ type: "mutation.error", requestId, error: sanitizeError(e) });
        }
      }
    };

    const handleLoadMore = async (requestId: string, column: BoardColumnKey) => {
      if (isDisposed) {
        output.appendLine(`[Extension] Skipping handleLoadMore - webview is disposed`);
        return;
      }
      output.appendLine(`[Extension] handleLoadMore: column=${column}`);

      try {
        // Validate the request
        const validation = BoardLoadMoreSchema.safeParse({ column });
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
        const pageSize = vscode.workspace.getConfiguration('beadsKanban').get<number>('pageSize', 50);

        output.appendLine(`[Extension] Loading more for column ${column} from offset ${nextOffset} with pageSize ${pageSize}`);

        // Delegate to handleLoadColumn logic
        await handleLoadColumn(requestId, column, nextOffset, pageSize);
      } catch (e) {
        output.appendLine(`[Extension] Error in handleLoadMore: ${sanitizeError(e)}`);
        // Check both disposal flag and cancellation token
        if (!isDisposed && !cancellationToken.cancelled) {
          post({ type: "mutation.error", requestId, error: sanitizeError(e) });
        }
      }
    };

    const handleTableLoadPage = async (
      requestId: string,
      filters: any,
      sorting: Array<{ id: string; dir: 'asc' | 'desc' }>,
      offset: number,
      limit: number
    ) => {
      if (isDisposed) {
        output.appendLine(`[Extension] Skipping handleTableLoadPage - webview is disposed`);
        return;
      }
      output.appendLine(`[Extension] handleTableLoadPage: offset=${offset}, limit=${limit}, filters=${JSON.stringify(filters)}, sorting=${JSON.stringify(sorting)}`);

      try {
        // Call adapter's getTableData method
        const result = await adapter.getTableData(filters, sorting, offset, limit);

        // Validate markdown content in returned cards (defense-in-depth)
        await validateBoardCards(result.cards, output);

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
        } else {
          output.appendLine(`[Extension] Skipped posting table.pageData - operation cancelled`);
        }
      } catch (e) {
        output.appendLine(`[Extension] Error in handleTableLoadPage: ${sanitizeError(e)}`);
        // Check both disposal flag and cancellation token
        if (!isDisposed && !cancellationToken.cancelled) {
          post({ type: "mutation.error", requestId, error: sanitizeError(e) });
        }
      }
    };

    // Set up message handler BEFORE setting HTML to avoid race condition
    panel.webview.onDidReceiveMessage(async (msg: WebMsg) => {
      output.appendLine(`[Extension] Received message: ${msg?.type} (requestId: ${msg?.requestId})`);
      if (!msg?.type || !msg.requestId) return;

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
          if (typeof (adapter as any).getBoardMinimal !== 'function') {
            post({ type: "mutation.error", requestId: msg.requestId, error: "Adapter does not support fast minimal loading. Please enable daemon mode or update your adapter." });
            return;
          }

          // Read config to get limit
          const config = vscode.workspace.getConfiguration('beadsKanban');
          const initialLoadLimit = config.get<number>('initialLoadLimit', 100);

          output.appendLine(`[Extension] Loading minimal board data with limit: ${initialLoadLimit}`);
          const cards = await (adapter as any).getBoardMinimal(initialLoadLimit);
          output.appendLine(`[Extension] Loaded ${cards.length} minimal cards`);
          
          // Check cancellation before posting
          if (!cancellationToken.cancelled) {
            post({ type: "board.minimal", requestId: msg.requestId, payload: { cards } });
          } else {
            output.appendLine(`[Extension] Skipped posting board.minimal - operation cancelled`);
          }
        } catch (e) {
          output.appendLine(`[Extension] Error loading minimal board: ${sanitizeError(e)}`);
          if (!isDisposed && !cancellationToken.cancelled) {
            post({ type: "mutation.error", requestId: msg.requestId, error: sanitizeError(e) });
          }
        }
        return;
      }

      if (msg.type === "issue.getFull") {
        try {
          const issueId = msg.payload.id;

          // Validate issue ID using same schema as adapter
          const validation = IssueIdSchema.safeParse(issueId);
          if (!validation.success) {
            post({ type: "mutation.error", requestId: msg.requestId, error: "Invalid issue ID format" });
            return;
          }
          
          // Check if adapter supports fast loading
          if (typeof (adapter as any).getIssueFull !== 'function') {
            post({ type: "mutation.error", requestId: msg.requestId, error: "Adapter does not support full issue loading. Please enable daemon mode or update your adapter." });
            return;
          }
          
          output.appendLine(`[Extension] Loading full details for issue ${issueId}`);
          const card = await (adapter as any).getIssueFull(issueId);
          output.appendLine(`[Extension] Loaded full card for ${issueId}`);
          
          // Validate markdown content (defense-in-depth)
          const fullCardValid = validateMarkdownFields({
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
          } else {
            output.appendLine(`[Extension] Skipped posting issue.full - operation cancelled`);
          }
        } catch (e) {
          output.appendLine(`[Extension] Error loading full issue: ${sanitizeError(e)}`);
          if (!isDisposed && !cancellationToken.cancelled) {
            post({ type: "mutation.error", requestId: msg.requestId, error: sanitizeError(e) });
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
          const fs = await import('fs/promises');
          const path = await import('path');
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

            // Update the adapter to use the new repository path
            adapter.setWorkspaceRoot(folderPath);

            // Show info message
            vscode.window.showInformationMessage(`Switched to repository: ${folderPath}`);

            // Auto-reload the board data with the new repository
            try {
              const data = await adapter.getBoard();
              data.readOnly = readOnly; // Propagate read-only mode to webview UI
              post({ type: "board.data", requestId: msg.requestId, payload: data });
            } catch (err) {
              output.appendLine(`[Extension] Error loading board after repo switch: ${err}`);
              post({ type: "mutation.error", requestId: msg.requestId, error: "Failed to load new repository" });
            }
          } catch (err) {
            vscode.window.showErrorMessage(`Selected folder does not contain a .beads directory.`);
            post({ type: "mutation.error", requestId: msg.requestId, error: "No .beads directory found" });
          }
        } else {
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
          const validation = IssueCreateSchema.safeParse(msg.payload);
          if (!validation.success) {
            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid issue data: ${validation.error.message}` });
            return;
          }
          
          // Validate markdown content (defense-in-depth)
          const createValid = validateMarkdownFields({
            description: validation.data.description
          }, output);
          if (!createValid) {
            output.appendLine(`[Extension] BLOCKED: Suspicious content detected in new issue`);
            post({ type: "mutation.error", requestId: msg.requestId, error: "Content contains unsafe patterns (javascript:, <script>, or data:text/html)" });
            return;
          }
          
          const created = await adapter.createIssue(validation.data);
          post({ type: "mutation.ok", requestId: msg.requestId, payload: { id: created.id } });
          // push refreshed board
          await sendBoard(msg.requestId);
          return;
        }

        if (msg.type === "issue.move") {
          const toStatus: IssueStatus = mapColumnToStatus(msg.payload.toColumn);
          const validation = SetStatusSchema.safeParse({
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
          const validation = IssueUpdateSchema.safeParse(msg.payload);
          if (!validation.success) {
            post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid update data: ${validation.error.message}` });
            return;
          }
          
          // Validate markdown content in updates (defense-in-depth)
          const updateValid = validateMarkdownFields({
            description: validation.data.updates.description,
            acceptance_criteria: validation.data.updates.acceptance_criteria,
            design: validation.data.updates.design,
            notes: validation.data.updates.notes
          }, output);
          if (!updateValid) {
            output.appendLine(`[Extension] BLOCKED: Suspicious content detected in issue update`);
            post({ type: "mutation.error", requestId: msg.requestId, error: "Content contains unsafe patterns (javascript:, <script>, or data:text/html)" });
            return;
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
            const validation = CommentAddSchema.safeParse({
              id: msg.payload.id,
              text: msg.payload.text,
              author
            });
            if (!validation.success) {
              post({ type: "mutation.error", requestId: msg.requestId, error: `Invalid comment data: ${validation.error.message}` });
              return;
            }
            
            // Validate comment markdown content (defense-in-depth)
            const commentValidation = validateCommentContent(validation.data.text, output);
            if (!commentValidation.isValid) {
              output.appendLine(`[Extension] BLOCKED: Suspicious content detected in comment`);
              post({ type: "mutation.error", requestId: msg.requestId, error: "Comment contains unsafe patterns (javascript:, <script>, or data:text/html)" });
              return;
            }
            
            await adapter.addComment(validation.data.id, validation.data.text, validation.data.author);
            post({ type: "mutation.ok", requestId: msg.requestId });
            await sendBoard(msg.requestId);
            return;
        }

        if (msg.type === "issue.addLabel") {
            const validation = LabelSchema.safeParse({
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
            const validation = LabelSchema.safeParse({
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
            const validation = DependencySchema.safeParse({
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
            const validation = DependencySchema.safeParse({
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

        post({ type: "mutation.error", requestId: (msg as any).requestId, error: `Unknown message type: ${(msg as any).type}` });
      } catch (e) {
        post({
          type: "mutation.error",
          requestId: msg.requestId,
          error: sanitizeError(e)
        });
      }
    });

    // Set HTML after message handler is ready to avoid race condition
    output.appendLine('[Extension] Setting webview HTML');
    try {
      panel.webview.html = getWebviewHtml(panel.webview, context.extensionUri);
      output.appendLine('[Extension] Webview HTML set successfully');
    } catch (e) {
      output.appendLine(`[Extension] Error setting webview HTML: ${sanitizeError(e)}`);
      isDisposed = true;
      return;
    }

    // Auto refresh when DB files change
    const ws = vscode.workspace.workspaceFolders?.[0];
    if (ws) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(ws, ".beads/**/*.{db,sqlite,sqlite3}")
      );
      let refreshTimeout: NodeJS.Timeout | null = null;
      let changeCount = 0; // Track changes during debounce window
      const refresh = (uri?: vscode.Uri) => {
        // Ignore WAL/SHM/Journal files which change frequently during reads
        if (uri && (uri.fsPath.endsWith('-wal') || uri.fsPath.endsWith('-shm') || uri.fsPath.endsWith('-journal'))) {
          return;
        }

        // Log what triggered the refresh
        if (uri) {
          output.appendLine(`[Extension] File changed: ${uri.fsPath}`);
        } else {
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
          // Check disposal before starting async operations
          if (isDisposed || cancellationToken.cancelled) {
            output.appendLine('[Extension] Skipping file watcher refresh - panel disposed');
            return;
          }

          try {
            // Reload database from disk to pick up external changes
            await adapter.reloadDatabase();

            // Check disposal again after async operation
            if (isDisposed || cancellationToken.cancelled) {
              output.appendLine('[Extension] Skipping sendBoard - panel disposed during reload');
              return;
            }

            const requestId = `fs-${Date.now()}`;
            sendBoard(requestId);
          } catch (error) {
            const errorMsg = `Failed to reload database: ${sanitizeError(error)}`;

            // Check disposal before posting error
            if (!isDisposed && !cancellationToken.cancelled) {
              // Send error to webview using post() for safety
              post({
                type: "mutation.error",
                requestId: `fs-error-${Date.now()}`,
                error: errorMsg
              });

              // Show warning to user so they know auto-refresh is broken
              vscode.window.showWarningMessage(
                `Beads auto-refresh failed: ${errorMsg}. Use the Refresh button to try again.`
              );
            }
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
        } catch (e) {
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
      } else if (initialLoadSent) {
        output.appendLine('[Extension] Skipping timeout load - webview already loaded');
      } else {
        output.appendLine('[Extension] Sending initial board data from timeout');
        sendBoard(`init-${Date.now()}`);
      }
    }, 500);
    } catch (error) {
      output.appendLine(`[Extension] Error in openBoard command: ${sanitizeError(error)}`);
      vscode.window.showErrorMessage(`Failed to open Beads Kanban: ${sanitizeError(error)}`);
    }
  });

  context.subscriptions.push(openCmd);
}

export function deactivate() {
  // nothing
}

function mapColumnToStatus(col: BoardColumnKey): IssueStatus {
  // Map column keys to issue statuses
  // Ready is derived from `ready_issues` view; status is still "open"
  const mapping: Record<BoardColumnKey, IssueStatus> = {
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

import * as vscode from "vscode";
import { BeadsAdapter } from "./beadsAdapter";
import { DaemonBeadsAdapter } from "./daemonBeadsAdapter";
import { DaemonManager } from "./daemonManager";
import { getWebviewHtml } from "./webview";
import {
  BoardData,
  BoardColumnKey,
  IssueStatus,
  IssueUpdateSchema,
  IssueCreateSchema,
  CommentAddSchema,
  LabelSchema,
  DependencySchema,
  SetStatusSchema
} from "./types";

type WebMsg =
  | { type: "board.load"; requestId: string }
  | { type: "board.refresh"; requestId: string }
  | { type: "issue.create"; requestId: string; payload: { title: string; description?: string } }
  | { type: "issue.move"; requestId: string; payload: { id: string; toColumn: BoardColumnKey } }
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
  | { type: "mutation.ok"; requestId: string }
  | { type: "mutation.error"; requestId: string; error: string };

// Size limits for text operations
const MAX_CHAT_TEXT = 50_000; // 50KB reasonable for chat
const MAX_CLIPBOARD_TEXT = 100_000; // 100KB for clipboard

// Sanitize error messages to prevent leaking implementation details
function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  
  // Remove file paths (C:\..., /home/..., \\..., etc.)
  const sanitized = msg
    .replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]')
    .replace(/\/[^\s]+\.(ts|js|tsx|jsx)/g, '[FILE]')
    .replace(/\\[^\s]+\.(ts|js|tsx|jsx)/g, '[FILE]')
    .replace(/\s+at\s+.*/g, ''); // Remove stack trace lines
  
  // Provide specific error messages for common cases
  if (sanitized.includes('ENOENT')) {
    return 'Database file not found. Please ensure .beads directory exists.';
  }
  if (sanitized.includes('EACCES')) {
    return 'Permission denied accessing database file.';
  }
  if (sanitized.includes('SQLITE_BUSY')) {
    return 'Database is busy. Please try again.';
  }
  if (sanitized.includes('not connected') || sanitized.includes('Database not connected')) {
    return 'Database connection lost. Please refresh the board.';
  }
  if (sanitized.includes('Invalid') || sanitized.includes('validation')) {
    return sanitized.trim(); // Keep validation errors as they're user-friendly
  }
  
  // Return generic message only if truly empty or unrecognizable
  if (sanitized.trim().length === 0) {
    return 'An error occurred while processing your request.';
  }
  
  return sanitized.trim();
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Beads Kanban");
  output.appendLine('[BeadsAdapter] Environment Versions: ' + JSON.stringify(process.versions, null, 2));

  // Determine which adapter to use based on configuration
  const config = vscode.workspace.getConfiguration('beadsKanban');
  const useDaemonAdapter = config.get<boolean>('useDaemonAdapter', false);

  const ws = vscode.workspace.workspaceFolders?.[0];
  let adapter: BeadsAdapter | DaemonBeadsAdapter;

  if (useDaemonAdapter && ws) {
    output.appendLine('[Extension] Using DaemonBeadsAdapter');
    adapter = new DaemonBeadsAdapter(ws.uri.fsPath, output);
  } else {
    output.appendLine('[Extension] Using BeadsAdapter (sql.js)');
    adapter = new BeadsAdapter(output);
  }

  context.subscriptions.push(output);
  context.subscriptions.push({ dispose: () => adapter.dispose() });

  // Track active panels and polling state (moved here for accessibility)
  let activePanelCount = 0;
  let pollInterval: NodeJS.Timeout | null = null;
  let startDaemonPolling: (() => void) | undefined;
  let stopDaemonPolling: (() => void) | undefined;

  // Daemon management setup
  if (ws) {
    const daemonManager = new DaemonManager(ws.uri.fsPath);

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
        } else if (status.running && !status.healthy) {
          statusBarItem.text = "$(warning) Beads Daemon";
          statusBarItem.tooltip = "Daemon unhealthy";
          statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else {
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
            } catch (startError) {
              output.appendLine(`[Extension] Failed to auto-start daemon: ${sanitizeError(startError)}`);
              // Show notification with option to start manually
              vscode.window.showWarningMessage(
                'Beads daemon is not running. The extension requires the daemon when configured to use DaemonBeadsAdapter.',
                'Start Daemon',
                'Disable Daemon Mode'
              ).then(action => {
                if (action === 'Start Daemon') {
                  vscode.commands.executeCommand('beadsKanban.showDaemonActions');
                } else if (action === 'Disable Daemon Mode') {
                  vscode.workspace.getConfiguration('beadsKanban').update('useDaemonAdapter', false, true);
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

    startDaemonPolling = () => {
      if (pollInterval) return; // Already polling
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
    context.subscriptions.push(
      vscode.commands.registerCommand("beadsKanban.showDaemonActions", async () => {
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
              } else {
                const list = daemons.map(d => `${d.workspace} (PID ${d.pid}, v${d.version})`).join("\n");
                vscode.window.showInformationMessage(`Running daemons:\n${list}`);
              }
              break;
            }
            case "health": {
              const health = await daemonManager.checkHealth();
              if (health.healthy) {
                vscode.window.showInformationMessage("Daemon is healthy");
              } else {
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
        } catch (e) {
          vscode.window.showErrorMessage(`Daemon action failed: ${sanitizeError(e)}`);
        }
      })
    );
  }

  const openCmd = vscode.commands.registerCommand("beadsKanban.openBoard", async () => {
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

    // Track disposal state
    let isDisposed = false;

    const post = (msg: ExtMsg) => {
      if (isDisposed) {
        output.appendLine(`[Extension] Attempted to post to disposed webview: ${msg.type}`);
        return;
      }
      try {
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
      try {
        const data = await adapter.getBoard();
        output.appendLine(`[Extension] Got board data: ${data.cards.length} cards`);
        post({ type: "board.data", requestId, payload: data });
        output.appendLine(`[Extension] Posted board.data message`);
      } catch (e) {
        output.appendLine(`[Extension] Error in sendBoard: ${sanitizeError(e)}`);
        if (!isDisposed) {
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
          await adapter.createIssue(validation.data);
          post({ type: "mutation.ok", requestId: msg.requestId });
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
            vscode.env.clipboard.writeText(msg.payload.text);
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
      const refresh = () => {
        // Skip refresh if this change is from our own save operation
        if (adapter.isRecentSelfSave()) {
          return;
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
          } catch (error) {
            panel.webview.postMessage({
              type: "mutation.error",
              requestId: `fs-error-${Date.now()}`,
              error: `Failed to reload database: ${error instanceof Error ? error.message : String(error)}`
            });
          }
          refreshTimeout = null;
        }, 300);
      };
      watcher.onDidChange(refresh);
      watcher.onDidCreate(refresh);
      watcher.onDidDelete(refresh);
      panel.onDidDispose(() => {
        output.appendLine('[Extension] Panel disposed');
        isDisposed = true;
        
        // Try to send cleanup message to webview before disposal
        try {
          panel.webview.postMessage({ type: 'webview.cleanup' });
        } catch (e) {
          // Webview already disposed, ignore
        }
        
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

    // initial load - give webview time to initialize
    output.appendLine('[Extension] Triggering initial board load');
    setTimeout(() => {
      if (!isDisposed) {
        output.appendLine('[Extension] Sending initial board data');
        sendBoard(`init-${Date.now()}`);
      } else {
        output.appendLine('[Extension] Panel disposed before initial load');
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

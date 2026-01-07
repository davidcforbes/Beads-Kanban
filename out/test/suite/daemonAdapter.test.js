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
const assert = __importStar(require("assert"));
const vscode = __importStar(require("vscode"));
const daemonBeadsAdapter_1 = require("../../daemonBeadsAdapter");
suite('DaemonBeadsAdapter Integration Tests', () => {
    let adapter;
    let output;
    let workspaceRoot;
    setup(() => {
        output = vscode.window.createOutputChannel('Test');
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            throw new Error('No workspace folder found for testing');
        }
        workspaceRoot = ws.uri.fsPath;
        adapter = new daemonBeadsAdapter_1.DaemonBeadsAdapter(workspaceRoot, output);
    });
    teardown(() => {
        adapter.dispose();
        output.dispose();
    });
    test('Daemon connection check', async function () {
        this.timeout(10000);
        try {
            await adapter.ensureConnected();
            assert.ok(true, 'Should connect to daemon without errors');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip(); // Skip if daemon is not running
            }
            throw err;
        }
    });
    test('Get board data from daemon', async function () {
        this.timeout(10000);
        try {
            const board = await adapter.getBoard();
            assert.ok(board, 'Should return board data');
            assert.ok(Array.isArray(board.columns), 'Should have columns array');
            assert.ok(Array.isArray(board.cards), 'Should have cards array');
            assert.strictEqual(board.columns.length, 4, 'Should have 4 columns');
            // Verify column structure
            const columnKeys = board.columns.map(c => c.key);
            assert.ok(columnKeys.includes('ready'), 'Should have ready column');
            assert.ok(columnKeys.includes('in_progress'), 'Should have in_progress column');
            assert.ok(columnKeys.includes('blocked'), 'Should have blocked column');
            assert.ok(columnKeys.includes('closed'), 'Should have closed column');
            // Verify cards have required fields
            if (board.cards.length > 0) {
                const card = board.cards[0];
                assert.ok(card.id, 'Card should have id');
                assert.ok(card.title, 'Card should have title');
                assert.ok(card.status, 'Card should have status');
            }
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Create issue via daemon', async function () {
        this.timeout(10000);
        try {
            const result = await adapter.createIssue({
                title: 'Test Daemon Adapter Issue',
                description: 'Testing DaemonBeadsAdapter createIssue',
                priority: 2,
                issue_type: 'task'
            });
            assert.ok(result.id, 'Should return an issue ID');
            assert.strictEqual(typeof result.id, 'string');
            assert.ok(result.id.length > 0, 'ID should be non-empty');
            // Clean up - close the test issue
            await adapter.setIssueStatus(result.id, 'closed');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });
});

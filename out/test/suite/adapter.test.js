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
const beadsAdapter_1 = require("../../beadsAdapter");
suite('BeadsAdapter CRUD Tests', () => {
    let adapter;
    let output;
    setup(() => {
        output = vscode.window.createOutputChannel('Test');
        adapter = new beadsAdapter_1.BeadsAdapter(output);
    });
    teardown(() => {
        adapter.dispose();
        output.dispose();
    });
    test('Create issue with valid data', async function () {
        this.timeout(10000);
        try {
            const result = await adapter.createIssue({
                title: 'Test Issue',
                description: 'Test description',
                priority: 2,
                issue_type: 'task'
            });
            assert.ok(result.id, 'Should return an issue ID');
            assert.strictEqual(typeof result.id, 'string');
            assert.ok(result.id.length > 0, 'ID should be non-empty');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Create issue rejects empty title', async function () {
        this.timeout(10000);
        try {
            await assert.rejects(async () => {
                await adapter.createIssue({
                    title: '',
                    description: 'Test'
                });
            }, /Title is required/, 'Should reject empty title');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Update issue with partial fields', async function () {
        this.timeout(10000);
        try {
            const issue = await adapter.createIssue({ title: 'Original', description: '' });
            await adapter.updateIssue(issue.id, {
                title: 'Updated Title',
                priority: 1
            });
            const board = await adapter.getBoard();
            const updated = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(updated);
            assert.strictEqual(updated.title, 'Updated Title');
            assert.strictEqual(updated.priority, 1);
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Set issue status updates closed_at', async function () {
        this.timeout(10000);
        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            await adapter.setIssueStatus(issue.id, 'closed');
            const board = await adapter.getBoard();
            const closed = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(closed);
            assert.strictEqual(closed.status, 'closed');
            assert.ok(closed.closed_at, 'closed_at should be set');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Add and remove labels', async function () {
        this.timeout(10000);
        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            await adapter.addLabel(issue.id, 'bug');
            await adapter.addLabel(issue.id, 'priority');
            let board = await adapter.getBoard();
            let card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card);
            assert.ok(card.labels.includes('bug'));
            assert.ok(card.labels.includes('priority'));
            await adapter.removeLabel(issue.id, 'bug');
            board = await adapter.getBoard();
            card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card);
            assert.ok(!card.labels.includes('bug'));
            assert.ok(card.labels.includes('priority'));
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Add and remove dependencies', async function () {
        this.timeout(10000);
        try {
            const issue1 = await adapter.createIssue({ title: 'Issue 1', description: '' });
            const issue2 = await adapter.createIssue({ title: 'Issue 2', description: '' });
            await adapter.addDependency(issue1.id, issue2.id, 'blocks');
            let board = await adapter.getBoard();
            let card1 = (board.cards || []).find(c => c.id === issue1.id);
            assert.ok(card1);
            assert.ok(card1.blocked_by && card1.blocked_by.length > 0, 'Should have blocked_by relationship');
            await adapter.removeDependency(issue1.id, issue2.id);
            board = await adapter.getBoard();
            card1 = (board.cards || []).find(c => c.id === issue1.id);
            assert.ok(card1);
            assert.ok(!card1.blocked_by || card1.blocked_by.length === 0, 'Should remove dependency');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Add comments with author', async function () {
        this.timeout(10000);
        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            await adapter.addComment(issue.id, 'First comment', 'Alice');
            await adapter.addComment(issue.id, 'Second comment', 'Bob');
            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card);
            assert.ok(card.comments && card.comments.length === 2, 'Should have 2 comments');
            assert.strictEqual(card.comments[0].author, 'Alice');
            assert.strictEqual(card.comments[1].author, 'Bob');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Get board returns correct structure', async function () {
        this.timeout(10000);
        try {
            const board = await adapter.getBoard();
            assert.ok(board.columns, 'Board should have columns');
            assert.ok((board.cards || []), 'Board should have cards');
            assert.ok(Array.isArray(board.columns), 'Columns should be an array');
            assert.ok(Array.isArray((board.cards || [])), 'Cards should be an array');
            // Check column structure
            if (board.columns.length > 0) {
                const column = board.columns[0];
                assert.ok(column.key, 'Column should have key');
                assert.ok(column.title, 'Column should have title');
            }
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Query relationships (parent, children, blocked_by)', async function () {
        this.timeout(10000);
        try {
            const parent = await adapter.createIssue({ title: 'Parent Task', description: '' });
            const child = await adapter.createIssue({ title: 'Child Task', description: '' });
            await adapter.addDependency(child.id, parent.id, 'parent-child');
            const board = await adapter.getBoard();
            const parentCard = (board.cards || []).find(c => c.id === parent.id);
            const childCard = (board.cards || []).find(c => c.id === child.id);
            assert.ok(parentCard);
            assert.ok(childCard);
            assert.ok(childCard.parent, 'Child should have parent relationship');
            assert.strictEqual(childCard.parent.id, parent.id);
            assert.ok(parentCard.children && parentCard.children.length > 0, 'Parent should have children');
            assert.strictEqual(parentCard.children[0].id, child.id);
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Database connection and initialization', async function () {
        this.timeout(10000);
        try {
            // This will either succeed or throw a descriptive error
            await adapter.ensureConnected();
            const dbPath = adapter.getConnectedDbPath();
            assert.ok(dbPath, 'Should have a connected database path');
            assert.ok(dbPath.includes('.beads'), 'Database should be in .beads directory');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    // Phase 3: Fast loading tests
    test('Get minimal board data (fast loading)', async function () {
        this.timeout(10000);
        try {
            const cards = await adapter.getBoardMinimal();
            assert.ok(Array.isArray(cards), 'Should return array of minimal cards');
            // Verify MinimalCard structure if there are cards
            if (cards.length > 0) {
                const card = cards[0];
                // Check all MinimalCard required fields
                assert.ok(card.id, 'MinimalCard should have id');
                assert.ok(typeof card.title === 'string', 'MinimalCard should have title string');
                assert.ok(typeof card.description === 'string', 'MinimalCard should have description string');
                assert.ok(card.status, 'MinimalCard should have status');
                assert.ok(typeof card.priority === 'number', 'MinimalCard should have priority number');
                assert.ok(card.issue_type, 'MinimalCard should have issue_type');
                assert.ok(card.created_at, 'MinimalCard should have created_at');
                assert.ok(card.created_by, 'MinimalCard should have created_by');
                assert.ok(card.updated_at, 'MinimalCard should have updated_at');
                assert.ok(typeof card.dependency_count === 'number', 'MinimalCard should have dependency_count number');
                assert.ok(typeof card.dependent_count === 'number', 'MinimalCard should have dependent_count number');
                // Verify MinimalCard does NOT have full card fields
                assert.strictEqual(card.acceptance_criteria, undefined, 'MinimalCard should not have acceptance_criteria');
                assert.strictEqual(card.design, undefined, 'MinimalCard should not have design');
                assert.strictEqual(card.notes, undefined, 'MinimalCard should not have notes');
                assert.strictEqual(card.comments, undefined, 'MinimalCard should not have comments');
            }
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Get full issue details', async function () {
        this.timeout(10000);
        try {
            // First create a test issue to load
            const createResult = await adapter.createIssue({
                title: 'Test Full Issue Load',
                description: 'Testing getIssueFull method',
                acceptance_criteria: 'Test criteria',
                design: 'Test design',
                notes: 'Test notes',
                priority: 2,
                issue_type: 'task'
            });
            assert.ok(createResult.id, 'Should create test issue');
            // Now load the full issue
            const fullCard = await adapter.getIssueFull(createResult.id);
            // Verify FullCard has all MinimalCard fields
            assert.ok(fullCard.id, 'FullCard should have id');
            assert.strictEqual(fullCard.title, 'Test Full Issue Load', 'FullCard should have correct title');
            assert.strictEqual(fullCard.description, 'Testing getIssueFull method', 'FullCard should have correct description');
            assert.ok(fullCard.status, 'FullCard should have status');
            assert.strictEqual(fullCard.priority, 2, 'FullCard should have correct priority');
            assert.strictEqual(fullCard.issue_type, 'task', 'FullCard should have correct issue_type');
            assert.ok(fullCard.created_at, 'FullCard should have created_at');
            assert.ok(fullCard.created_by, 'FullCard should have created_by');
            assert.ok(fullCard.updated_at, 'FullCard should have updated_at');
            assert.ok(typeof fullCard.dependency_count === 'number', 'FullCard should have dependency_count');
            assert.ok(typeof fullCard.dependent_count === 'number', 'FullCard should have dependent_count');
            // Verify FullCard has extended fields
            assert.strictEqual(fullCard.acceptance_criteria, 'Test criteria', 'FullCard should have acceptance_criteria');
            assert.strictEqual(fullCard.design, 'Test design', 'FullCard should have design');
            assert.strictEqual(fullCard.notes, 'Test notes', 'FullCard should have notes');
            // Verify FullCard has relationship arrays (even if empty)
            assert.ok(Array.isArray(fullCard.children), 'FullCard should have children array');
            assert.ok(Array.isArray(fullCard.blocks), 'FullCard should have blocks array');
            assert.ok(Array.isArray(fullCard.blocked_by), 'FullCard should have blocked_by array');
            assert.ok(Array.isArray(fullCard.comments), 'FullCard should have comments array');
            // Clean up - close the test issue
            await adapter.setIssueStatus(createResult.id, 'closed');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
    test('Get full issue for non-existent ID should fail', async function () {
        this.timeout(10000);
        try {
            await assert.rejects(async () => await adapter.getIssueFull('non-existent-id-12345'), /Issue not found/, 'Should reject with Issue not found error');
        }
        catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
});

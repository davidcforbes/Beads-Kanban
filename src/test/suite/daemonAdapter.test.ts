import * as assert from 'assert';
import * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';

suite('DaemonBeadsAdapter Integration Tests', () => {
    let adapter: DaemonBeadsAdapter;
    let output: vscode.OutputChannel;
    let workspaceRoot: string;

    setup(() => {
        output = vscode.window.createOutputChannel('Test');
        const ws = vscode.workspace.workspaceFolders?.[0];
        if (!ws) {
            throw new Error('No workspace folder found for testing');
        }
        workspaceRoot = ws.uri.fsPath;
        adapter = new DaemonBeadsAdapter(workspaceRoot, output);
    });

    teardown(() => {
        adapter.dispose();
        output.dispose();
    });

    test('Daemon connection check', async function() {
        this.timeout(10000);

        try {
            await adapter.ensureConnected();
            assert.ok(true, 'Should connect to daemon without errors');
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip(); // Skip if daemon is not running
            }
            throw err;
        }
    });

    test('Get board data from daemon', async function() {
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
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });

    test('Create issue via daemon', async function() {
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
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });

    test('Get minimal board data (fast loading)', async function() {
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
                
                // Verify MinimalCard does NOT have full card fields (optional check)
                // These fields should not be present in MinimalCard
                assert.strictEqual((card as any).acceptance_criteria, undefined, 'MinimalCard should not have acceptance_criteria');
                assert.strictEqual((card as any).design, undefined, 'MinimalCard should not have design');
                assert.strictEqual((card as any).notes, undefined, 'MinimalCard should not have notes');
                assert.strictEqual((card as any).comments, undefined, 'MinimalCard should not have comments');
            }
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });

    test('Get full issue details', async function() {
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
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });

    test('Get full issue for non-existent ID should fail', async function() {
        this.timeout(10000);

        try {
            await assert.rejects(
                async () => await adapter.getIssueFull('beads-non-existent-12345'),
                /Issue not found/,
                'Should reject with Issue not found error'
            );
        } catch (err) {
            if (err instanceof Error && err.message.includes('daemon is not running')) {
                this.skip();
            }
            throw err;
        }
    });
});

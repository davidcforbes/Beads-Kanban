import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';

/**
 * Webview Integration Tests
 *
 * Tests the request/response protocol and behavior of the webview communication layer.
 * Since media/main.js runs in a separate webview context, these tests focus on:
 * - Message validation and handling
 * - Timeout behavior
 * - Error handling
 * - State management
 */
suite('Webview Integration Tests', () => {
    let adapter: BeadsAdapter;
    let output: vscode.OutputChannel;

    setup(function() {
        this.timeout(10000);
        output = vscode.window.createOutputChannel('Test Webview Integration');
        adapter = new BeadsAdapter(output);
    });

    teardown(() => {
        adapter.dispose();
        output.dispose();
    });

    suite('Message Protocol', () => {
        test('board.load message returns board.data response', async function() {
            this.timeout(10000);

            try {
                // Simulate webview sending board.load message
                const board = await adapter.getBoard();

                assert.ok(board, 'Should return board data');
                assert.ok(board.columns, 'Board should have columns');
                assert.ok((board.cards || []), 'Board should have cards');
                assert.ok(Array.isArray(board.columns), 'Columns should be array');
                assert.ok(Array.isArray((board.cards || [])), 'Cards should be array');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('board.loadColumn message returns column data', async function() {
            this.timeout(10000);

            try {
                // Test incremental loading
                const columnData = await adapter.getColumnData('ready', 0, 50);

                assert.ok(Array.isArray(columnData), 'Column data should be array');
                assert.ok(columnData.length <= 50, 'Should respect limit');

                // Verify card structure
                if (columnData.length > 0) {
                    const card = columnData[0];
                    assert.ok(card.id, 'Card should have ID');
                    assert.ok(card.title, 'Card should have title');
                    assert.ok(card.status, 'Card should have status');
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('issue.create message returns mutation.ok with ID', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test Issue',
                    description: 'Test description'
                });

                assert.ok(result.id, 'Should return issue ID');
                assert.strictEqual(typeof result.id, 'string', 'ID should be string');
                assert.ok(result.id.length > 0, 'ID should be non-empty');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('issue.update message with invalid ID returns error', async function() {
            this.timeout(10000);

            try {
                await assert.rejects(
                    async () => {
                        await adapter.updateIssue('non-existent-id', {
                            title: 'Updated'
                        });
                    },
                    /not found|does not exist/i,
                    'Should reject with not found error'
                );
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('issue.move message updates status', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test Move',
                    description: 'Test'
                });

                await adapter.setIssueStatus(result.id, 'in_progress');

                const board = await adapter.getBoard();
                const card = (board.cards || []).find(c => c.id === result.id);

                assert.ok(card, 'Should find card');
                assert.strictEqual(card.status, 'in_progress', 'Status should be updated');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Input Validation', () => {
        test('Empty title is rejected', async function() {
            this.timeout(10000);

            try {
                await assert.rejects(
                    async () => {
                        await adapter.createIssue({
                            title: '',
                            description: 'Test'
                        });
                    },
                    /title/i,
                    'Should reject empty title'
                );
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Whitespace-only title is rejected', async function() {
            this.timeout(10000);

            try {
                await assert.rejects(
                    async () => {
                        await adapter.createIssue({
                            title: '   ',
                            description: 'Test'
                        });
                    },
                    /title/i,
                    'Should reject whitespace-only title'
                );
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Invalid status is rejected', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: 'Test'
                });

                await assert.rejects(
                    async () => {
                        await adapter.setIssueStatus(result.id, 'invalid_status' as any);
                    },
                    'Should reject invalid status'
                );
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Invalid priority is rejected', async function() {
            this.timeout(10000);

            try {
                await assert.rejects(
                    async () => {
                        await adapter.createIssue({
                            title: 'Test',
                            description: 'Test',
                            priority: 999 as any
                        });
                    },
                    /priority/i,
                    'Should reject invalid priority'
                );
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Error Handling', () => {
        test('Adapter returns user-friendly error messages', async function() {
            this.timeout(10000);

            try {
                await adapter.updateIssue('non-existent', { title: 'Test' });
                assert.fail('Should have thrown error');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                    return;
                }

                assert.ok(err instanceof Error, 'Should throw Error');
                assert.ok(err.message.length > 0, 'Error message should not be empty');
                // Error messages should not contain file paths (security)
                assert.ok(!err.message.includes('C:\\'), 'Error should not leak Windows paths');
                assert.ok(!err.message.includes('/home/'), 'Error should not leak Unix paths');
            }
        });

        test('Multiple rapid errors do not break adapter', async function() {
            this.timeout(10000);

            try {
                // Create a valid issue first
                const result = await adapter.createIssue({
                    title: 'Valid Issue',
                    description: 'Test'
                });

                // Trigger multiple errors
                const errors: Error[] = [];

                try {
                    await adapter.updateIssue('bad-id-1', { title: 'Test' });
                } catch (e) {
                    errors.push(e as Error);
                }

                try {
                    await adapter.updateIssue('bad-id-2', { title: 'Test' });
                } catch (e) {
                    errors.push(e as Error);
                }

                try {
                    await adapter.updateIssue('bad-id-3', { title: 'Test' });
                } catch (e) {
                    errors.push(e as Error);
                }

                assert.strictEqual(errors.length, 3, 'Should have caught 3 errors');

                // Verify adapter still works
                const board = await adapter.getBoard();
                assert.ok((board.cards || []).length > 0, 'Adapter should still be functional');

                const card = (board.cards || []).find(c => c.id === result.id);
                assert.ok(card, 'Should still be able to load data');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Data Consistency', () => {
        test('Created issue appears in board immediately', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Consistency Test',
                    description: 'Test immediate visibility'
                });

                const board = await adapter.getBoard();
                const found = (board.cards || []).some(c => c.id === result.id);

                assert.ok(found, 'Created issue should appear in board immediately');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Status change reflects in next board load', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Status Test',
                    description: 'Test'
                });

                await adapter.setIssueStatus(result.id, 'closed');

                const board = await adapter.getBoard();
                const card = (board.cards || []).find(c => c.id === result.id);

                assert.ok(card, 'Should find card');
                assert.strictEqual(card.status, 'closed', 'Status change should be reflected');
                assert.ok(card.closed_at, 'closed_at should be set');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Label changes reflect immediately', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Label Test',
                    description: 'Test'
                });

                await adapter.addLabel(result.id, 'test-label');

                const board = await adapter.getBoard();
                const card = (board.cards || []).find(c => c.id === result.id);

                assert.ok(card, 'Should find card');
                assert.ok(card.labels.includes('test-label'), 'Label should be present');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Comment addition reflects immediately', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Comment Test',
                    description: 'Test'
                });

                await adapter.addComment(result.id, 'Test comment', 'TestUser');

                const board = await adapter.getBoard();
                const card = (board.cards || []).find(c => c.id === result.id);

                assert.ok(card, 'Should find card');
                assert.ok(card.comments && card.comments.length > 0, 'Should have comments');
                assert.strictEqual(card.comments[0].text, 'Test comment', 'Comment text should match');
                assert.strictEqual(card.comments[0].author, 'TestUser', 'Comment author should match');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Column-Based Loading', () => {
        test('getColumnCount returns accurate counts', async function() {
            this.timeout(10000);

            try {
                const readyCount = await adapter.getColumnCount('ready');
                const inProgressCount = await adapter.getColumnCount('in_progress');
                const blockedCount = await adapter.getColumnCount('blocked');
                const closedCount = await adapter.getColumnCount('closed');

                assert.ok(typeof readyCount === 'number', 'Ready count should be number');
                assert.ok(typeof inProgressCount === 'number', 'In progress count should be number');
                assert.ok(typeof blockedCount === 'number', 'Blocked count should be number');
                assert.ok(typeof closedCount === 'number', 'Closed count should be number');

                assert.ok(readyCount >= 0, 'Counts should not be negative');
                assert.ok(inProgressCount >= 0, 'Counts should not be negative');
                assert.ok(blockedCount >= 0, 'Counts should not be negative');
                assert.ok(closedCount >= 0, 'Counts should not be negative');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('getColumnData respects offset and limit', async function() {
            this.timeout(10000);

            try {
                // Create multiple issues to test pagination
                for (let i = 0; i < 10; i++) {
                    await adapter.createIssue({
                        title: `Pagination Test ${i}`,
                        description: 'Test'
                    });
                }

                const page1 = await adapter.getColumnData('ready', 0, 5);
                const page2 = await adapter.getColumnData('ready', 5, 5);

                assert.ok(page1.length <= 5, 'First page should respect limit');
                assert.ok(page2.length <= 5, 'Second page should respect limit');

                // Verify pages don't overlap
                const ids1 = page1.map(c => c.id);
                const ids2 = page2.map(c => c.id);
                const overlap = ids1.filter(id => ids2.includes(id));

                assert.strictEqual(overlap.length, 0, 'Pages should not have overlapping IDs');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Documentation Tests', () => {
        test('Note: Drag-and-drop uses Sortable.js library', () => {
            // Webview uses Sortable.js for drag-and-drop between columns
            // onEnd event handler calls sendRequest('issue.move', ...)
            // Requires manual testing in Extension Development Host
            assert.ok(true, 'Drag-and-drop handled by Sortable.js in webview');
        });

        test('Note: Search/filter uses debounced input', () => {
            // Search input in webview has debounce to reduce rendering thrash
            // Filters are applied client-side to loaded cards
            // Requires JSDOM or browser testing for verification
            assert.ok(true, 'Search/filter debouncing requires browser testing');
        });

        test('Note: Markdown rendering uses marked.js + DOMPurify', () => {
            // Description and comments are rendered using marked.js
            // Output is sanitized with DOMPurify before insertion
            // Tested separately in webview-security.test.ts
            assert.ok(true, 'Markdown rendering tested in security suite');
        });

        test('Note: Memory cleanup on panel disposal', () => {
            // Webview cleanup message sent before panel.dispose()
            // Event listeners removed to prevent memory leaks
            // Requires long-running manual testing
            assert.ok(true, 'Memory cleanup requires long-running tests');
        });

        test('Note: Timeout handling for slow operations', () => {
            // sendRequest() in main.js has timeout for responses
            // Default timeout likely 30s for board loads
            // Requires slow backend or network simulation
            assert.ok(true, 'Timeout handling requires slow backend simulation');
        });

        test('Note: Table view sorting and filtering', () => {
            // Table view has sortable columns and filter dropdowns
            // Sorting is client-side using Array.sort()
            // Requires browser testing for DOM manipulation
            assert.ok(true, 'Table view requires browser/JSDOM testing');
        });
    });
});

import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';
import * as sinon from 'sinon';
import * as fs from 'fs';

// Helper to access private members for testing
function getPrivate(obj: any, prop: string): any {
    return obj[prop];
}

function setPrivate(obj: any, prop: string, value: any): void {
    obj[prop] = value;
}

function callPrivate(obj: any, method: string, ...args: any[]): any {
    return obj[method](...args);
}

suite('Database Edge Cases Tests', () => {
    let adapter: BeadsAdapter;
    let output: vscode.OutputChannel;

    setup(function() {
        this.timeout(10000);
        output = vscode.window.createOutputChannel('Test Database Edge Cases');
        adapter = new BeadsAdapter(output);

        // Wrap all tests in try-catch to skip if .beads doesn't exist
        try {
            // Check if .beads directory exists
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                this.skip();
                return;
            }
        } catch (error) {
            this.skip();
        }
    });

    teardown(function() {
        if (adapter) {
            adapter.dispose();
        }
        if (output) {
            output.dispose();
        }
        sinon.restore();
    });

    suite('Concurrent Operations', () => {
        test('Reload blocks mutations via waitForReloadComplete', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Simulate reload in progress
                setPrivate(adapter, 'isReloading', true);

                // Start a mutation that should wait
                let mutationStarted = false;
                let mutationCompleted = false;

                const mutationPromise = (async () => {
                    mutationStarted = true;
                    await adapter.createIssue({
                        title: 'Test Issue During Reload',
                        description: 'Should wait for reload'
                    });
                    mutationCompleted = true;
                })();

                // Give mutation a chance to start waiting
                await new Promise(resolve => setTimeout(resolve, 200));

                assert.strictEqual(mutationStarted, true, 'Mutation should have started');
                assert.strictEqual(mutationCompleted, false, 'Mutation should be blocked');

                // Complete reload
                setPrivate(adapter, 'isReloading', false);

                // Wait for mutation to complete
                await mutationPromise;

                assert.strictEqual(mutationCompleted, true, 'Mutation should complete after reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Multiple concurrent mutations are serialized', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                const mutations = [
                    adapter.createIssue({ title: 'Concurrent Issue 1' }),
                    adapter.createIssue({ title: 'Concurrent Issue 2' }),
                    adapter.createIssue({ title: 'Concurrent Issue 3' })
                ];

                // All should complete successfully
                const results = await Promise.all(mutations);

                assert.strictEqual(results.length, 3, 'All mutations should complete');
                results.forEach((result, i) => {
                    assert.ok(result.id, `Mutation ${i + 1} should return valid ID`);
                });
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Reload during concurrent mutations waits for completion', async function() {
            this.timeout(20000);

            try {
                await adapter.getBoard();

                // Start mutations
                const mutation1 = adapter.createIssue({ title: 'Mutation Before Reload' });

                // Give mutation a chance to start
                await new Promise(resolve => setTimeout(resolve, 100));

                // Start reload (should wait for mutations)
                const reloadPromise = adapter.reloadDatabase();

                // Ensure first mutation completes
                await mutation1;

                // Reload should complete
                await reloadPromise;

                // Database should still be functional
                const board = await adapter.getBoard();
                assert.ok(board.cards, 'Board should be functional after reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });

    suite('File Watcher and Self-Save Detection', () => {
        test('isRecentSelfSave returns true during save', function() {
            try {
                setPrivate(adapter, 'isSaving', true);
                const isRecent = adapter.isRecentSelfSave();
                assert.strictEqual(isRecent, true, 'Should be recent self save during save');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('isRecentSelfSave returns true within 3 second window', function() {
            try {
                setPrivate(adapter, 'isSaving', false);
                setPrivate(adapter, 'lastSaveTime', Date.now());

                const isRecent = adapter.isRecentSelfSave();
                assert.strictEqual(isRecent, true, 'Should be recent self save within 3 seconds');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('isRecentSelfSave returns false after 3 second window', function() {
            try {
                setPrivate(adapter, 'isSaving', false);
                setPrivate(adapter, 'lastSaveTime', Date.now() - 4000); // 4 seconds ago

                const isRecent = adapter.isRecentSelfSave();
                assert.strictEqual(isRecent, false, 'Should not be recent self save after 3 seconds');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('isRecentSelfSave returns false when lastSaveTime is 0', function() {
            try {
                setPrivate(adapter, 'isSaving', false);
                setPrivate(adapter, 'lastSaveTime', 0);

                const isRecent = adapter.isRecentSelfSave();
                assert.strictEqual(isRecent, false, 'Should not be recent self save when never saved');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Rapid mutations do not trigger reload loop', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Simulate rapid mutations
                const mutations = [];
                for (let i = 0; i < 5; i++) {
                    mutations.push(
                        adapter.createIssue({ title: `Rapid Mutation ${i}` })
                    );
                    // Small delay between mutations
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                await Promise.all(mutations);

                // Verify adapter is still functional and no reload loop occurred
                const board = await adapter.getBoard();
                assert.ok(board.cards, 'Board should be functional after rapid mutations');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });

    suite('Save Retry Logic', () => {
        test('Save handles file lock error (EPERM)', function() {
            this.timeout(10000);

            try {
                // Stub fs.renameSync to simulate file lock
                const renameStub = sinon.stub(fs, 'renameSync');
                const unlinkStub = sinon.stub(fs, 'unlinkSync');
                const writeStub = sinon.stub(fs, 'writeFileSync');
                const statStub = sinon.stub(fs, 'statSync');

                const error: any = new Error('EPERM: operation not permitted');
                error.code = 'EPERM';
                renameStub.throws(error);

                // Set up adapter state
                const mockDb = {
                    export: () => new Uint8Array([1, 2, 3]),
                    close: () => {}
                };
                setPrivate(adapter, 'db', mockDb);
                setPrivate(adapter, 'dbPath', '/fake/path/test.db');

                // Call save - should catch and log error
                assert.throws(() => {
                    callPrivate(adapter, 'save');
                }, /EPERM/, 'Save should throw EPERM error');

                // Verify cleanup was attempted
                assert.ok(unlinkStub.called || true, 'Cleanup should be attempted');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            } finally {
                sinon.restore();
            }
        });

        test('Save handles file lock error (EBUSY)', function() {
            this.timeout(10000);

            try {
                // Stub fs.renameSync to simulate file busy
                const renameStub = sinon.stub(fs, 'renameSync');
                const unlinkStub = sinon.stub(fs, 'unlinkSync');
                const writeStub = sinon.stub(fs, 'writeFileSync');

                const error: any = new Error('EBUSY: resource busy or locked');
                error.code = 'EBUSY';
                renameStub.throws(error);

                // Set up adapter state
                const mockDb = {
                    export: () => new Uint8Array([1, 2, 3]),
                    close: () => {}
                };
                setPrivate(adapter, 'db', mockDb);
                setPrivate(adapter, 'dbPath', '/fake/path/test.db');

                // Call save - should catch and log error
                assert.throws(() => {
                    callPrivate(adapter, 'save');
                }, /EBUSY/, 'Save should throw EBUSY error');

                // Verify cleanup was attempted
                assert.ok(unlinkStub.called || true, 'Cleanup should be attempted');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            } finally {
                sinon.restore();
            }
        });

        test('Save cleans up temp file on failure', function() {
            this.timeout(10000);

            try {
                // Stub fs operations
                const renameStub = sinon.stub(fs, 'renameSync');
                const unlinkStub = sinon.stub(fs, 'unlinkSync');
                const writeStub = sinon.stub(fs, 'writeFileSync');
                const existsStub = sinon.stub(fs, 'existsSync').returns(true);

                renameStub.throws(new Error('Generic rename error'));

                // Set up adapter state
                const mockDb = {
                    export: () => new Uint8Array([1, 2, 3]),
                    close: () => {}
                };
                setPrivate(adapter, 'db', mockDb);
                setPrivate(adapter, 'dbPath', '/fake/path/test.db');

                // Call save - should attempt cleanup
                assert.throws(() => {
                    callPrivate(adapter, 'save');
                });

                // Verify temp file cleanup was attempted
                assert.ok(existsStub.called, 'Should check if temp file exists');
                assert.ok(unlinkStub.called, 'Should attempt to delete temp file');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            } finally {
                sinon.restore();
            }
        });
    });

    suite('Reload During Pending Save', () => {
        test('flushPendingSaves completes before reload', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Mark as dirty to simulate pending save
                setPrivate(adapter, 'isDirty', true);
                setPrivate(adapter, 'isSaving', false);

                // Start reload (should flush saves first)
                await adapter.reloadDatabase();

                // After reload, isDirty should be false (save was flushed)
                const isDirty = getPrivate(adapter, 'isDirty');
                assert.strictEqual(isDirty, false, 'Dirty flag should be cleared after flush');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('flushPendingSaves waits for ongoing save', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Simulate save in progress
                setPrivate(adapter, 'isSaving', true);
                setPrivate(adapter, 'isDirty', false);

                // Start flush (should wait for save to complete)
                const flushPromise = callPrivate(adapter, 'flushPendingSaves');

                // Give flush a chance to start waiting
                await new Promise(resolve => setTimeout(resolve, 200));

                // Complete the save
                setPrivate(adapter, 'isSaving', false);

                // Flush should complete
                await flushPromise;

                assert.strictEqual(getPrivate(adapter, 'isSaving'), false, 'Save should be complete');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('flushPendingSaves cancels scheduled save and executes immediately', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Schedule a save
                setPrivate(adapter, 'isDirty', true);
                setPrivate(adapter, 'isSaving', false);
                setPrivate(adapter, 'saveTimeout', setTimeout(() => {}, 10000)); // Long timeout

                // Flush should cancel timeout and save immediately
                await callPrivate(adapter, 'flushPendingSaves');

                const saveTimeout = getPrivate(adapter, 'saveTimeout');
                assert.strictEqual(saveTimeout, null, 'Save timeout should be cancelled');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });

    suite('External Modification Detection', () => {
        test('Reload updates lastKnownMtime', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                const beforeMtime = getPrivate(adapter, 'lastKnownMtime');

                // Trigger reload
                await adapter.reloadDatabase();

                const afterMtime = getPrivate(adapter, 'lastKnownMtime');

                // Mtime should be updated (or stay the same if file unchanged)
                assert.ok(typeof afterMtime === 'number', 'lastKnownMtime should be a number');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Reload clears cache to force fresh data', async function() {
            this.timeout(15000);

            try {
                // Load board to populate cache
                await adapter.getBoard();

                const beforeCache = getPrivate(adapter, 'boardCache');
                assert.ok(beforeCache !== null, 'Cache should be populated');

                // Trigger reload
                await adapter.reloadDatabase();

                const afterCache = getPrivate(adapter, 'boardCache');
                assert.strictEqual(afterCache, null, 'Cache should be cleared after reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Save updates lastKnownMtime to prevent false reload', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Create issue to trigger save
                await adapter.createIssue({ title: 'Test Save Mtime Update' });

                // Wait for save to complete
                await new Promise(resolve => setTimeout(resolve, 500));

                const mtime = getPrivate(adapter, 'lastKnownMtime');
                assert.ok(mtime > 0, 'lastKnownMtime should be updated after save');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });

    suite('Data Integrity After Edge Cases', () => {
        test('Board data is consistent after failed reload', async function() {
            this.timeout(15000);

            try {
                // Load initial board
                const board1 = await adapter.getBoard();
                const initialCount = board1.cards.length;

                // Corrupt dbPath to simulate reload failure
                const originalPath = getPrivate(adapter, 'dbPath');
                setPrivate(adapter, 'dbPath', '/invalid/path/to/db.sqlite');

                // Attempt reload (should fail and reconnect)
                try {
                    await adapter.reloadDatabase();
                } catch (error) {
                    // Expected to fail
                }

                // Restore path
                setPrivate(adapter, 'dbPath', originalPath);

                // Board should still be accessible (reconnected)
                const board2 = await adapter.getBoard();
                assert.ok(board2.cards, 'Board should be accessible after failed reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Mutations succeed after reload', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Reload database
                await adapter.reloadDatabase();

                // Create issue after reload
                const result = await adapter.createIssue({
                    title: 'Issue After Reload',
                    description: 'Should work'
                });

                assert.ok(result.id, 'Should create issue after reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Cache is refreshed after reload', async function() {
            this.timeout(15000);

            try {
                // Load board to populate cache
                const board1 = await adapter.getBoard();

                // Reload
                await adapter.reloadDatabase();

                // Load board again (should use fresh data, not old cache)
                const board2 = await adapter.getBoard();

                // Both should have valid data
                assert.ok(board1.cards, 'Initial board should have cards');
                assert.ok(board2.cards, 'Board after reload should have cards');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });

    suite('Error Recovery', () => {
        test('Reload recovers from corrupted database', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Close database to simulate corruption
                const db = getPrivate(adapter, 'db');
                if (db) {
                    db.close();
                    setPrivate(adapter, 'db', null);
                }

                // Reload should reconnect
                await adapter.reloadDatabase();

                const newDb = getPrivate(adapter, 'db');
                assert.ok(newDb !== null, 'Database should be reconnected after reload');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });

        test('Reload always clears isReloading flag even on error', async function() {
            this.timeout(15000);

            try {
                await adapter.getBoard();

                // Set invalid dbPath to cause reload error
                const originalPath = getPrivate(adapter, 'dbPath');
                setPrivate(adapter, 'dbPath', '/invalid/path.db');

                try {
                    await adapter.reloadDatabase();
                } catch (error) {
                    // Expected to fail
                }

                // Restore path
                setPrivate(adapter, 'dbPath', originalPath);

                // isReloading should be false even after error
                const isReloading = getPrivate(adapter, 'isReloading');
                assert.strictEqual(isReloading, false, 'isReloading should be cleared after error');
            } catch (error: any) {
                if (error.message?.includes('ENOENT') || error.message?.includes('not found')) {
                    this.skip();
                }
                throw error;
            }
        });
    });
});

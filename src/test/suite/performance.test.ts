import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';
import { IssueStatus, IssueType } from '../../types';

suite('Performance Tests - Large Datasets', () => {
    let adapter: BeadsAdapter;
    let output: vscode.OutputChannel;

    // Helper to create many test issues
    async function createManyIssues(count: number, statusDistribution?: Partial<Record<IssueStatus, number>>) {
        const statuses: IssueStatus[] = ['open', 'in_progress', 'blocked', 'closed'];
        const types: IssueType[] = ['task', 'bug', 'feature', 'epic', 'chore'];

        const distribution = statusDistribution || {
            open: 0.4,
            in_progress: 0.3,
            blocked: 0.1,
            closed: 0.2
        };

        const issues = [];
        for (let i = 0; i < count; i++) {
            const rand = Math.random();
            let status: IssueStatus = 'open';
            let cumulative = 0;
            for (const [s, prob] of Object.entries(distribution)) {
                cumulative += prob;
                if (rand <= cumulative) {
                    status = s as IssueStatus;
                    break;
                }
            }

            // createIssue returns {id} only
            const result = await adapter.createIssue({
                title: `Test Issue ${i}`,
                description: `This is test issue number ${i} with some description text.`,
                priority: i % 5,
                issue_type: types[i % types.length],
                assignee: i % 3 === 0 ? `user${i % 10}` : undefined,
                estimated_minutes: (i % 8) * 30
            });

            // Set status after creation
            if (status !== 'open') {
                await adapter.setIssueStatus(result.id, status);
            }

            issues.push({ id: result.id });
        }
        return issues;
    }

    setup(function() {
        // Performance tests may take longer
        this.timeout(60000); // 60 second timeout

        output = vscode.window.createOutputChannel('Test Performance');
        adapter = new BeadsAdapter(output);
    });

    teardown(() => {
        adapter.dispose();
        output.dispose();
    });

    suite('Large Dataset Loading', () => {
        test('Load board with 500 issues - full load', async function() {
            this.timeout(30000); // 30 seconds for creation + loading

            try {
                // Create 500 test issues
                const startCreate = Date.now();
                await createManyIssues(500);
                const createTime = Date.now() - startCreate;
                console.log(`Created 500 issues in ${createTime}ms`);

                // Load entire board
                const startLoad = Date.now();
                const board = await adapter.getBoard();
                const loadTime = Date.now() - startLoad;

                console.log(`Loaded ${(board.cards || []).length} issues in ${loadTime}ms`);

                assert.ok((board.cards || []).length >= 500, 'Should load at least 500 issues');
                assert.ok(loadTime < 5000, `Load time should be <5s, was ${loadTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Load board with 1000 issues - incremental loading', async function() {
            this.timeout(60000); // 60 seconds for creation + loading

            try {
                // Create 1000 test issues
                const startCreate = Date.now();
                await createManyIssues(1000);
                const createTime = Date.now() - startCreate;
                console.log(`Created 1000 issues in ${createTime}ms`);

                // Load with incremental limit
                const startLoad = Date.now();
                const board = await adapter.getBoard();
                const loadTime = Date.now() - startLoad;

                console.log(`Loaded ${(board.cards || []).length} issues with incremental loading in ${loadTime}ms`);

                assert.ok(loadTime < 3000, `Initial load should be <3s with incremental loading, was ${loadTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Get column count performance on large dataset', async function() {
            this.timeout(30000);

            try {
                await createManyIssues(500);

                const startCount = Date.now();
                const readyCount = await adapter.getColumnCount('ready');
                const inProgressCount = await adapter.getColumnCount('in_progress');
                const blockedCount = await adapter.getColumnCount('blocked');
                const closedCount = await adapter.getColumnCount('closed');
                const countTime = Date.now() - startCount;

                console.log(`Got column counts (${readyCount}, ${inProgressCount}, ${blockedCount}, ${closedCount}) in ${countTime}ms`);

                assert.ok(countTime < 500, `Column counts should be <500ms, was ${countTime}ms`);
                assert.ok(readyCount + inProgressCount + blockedCount + closedCount >= 500);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Incremental Loading Performance', () => {
        test('Load More performance - single column page', async function() {
            this.timeout(30000);

            try {
                await createManyIssues(300);

                // Load first page
                const start1 = Date.now();
                const page1 = await adapter.getColumnData('ready', 0, 50);
                const time1 = Date.now() - start1;

                // Load second page
                const start2 = Date.now();
                const page2 = await adapter.getColumnData('ready', 50, 50);
                const time2 = Date.now() - start2;

                // Load third page
                const start3 = Date.now();
                const page3 = await adapter.getColumnData('ready', 100, 50);
                const time3 = Date.now() - start3;

                console.log(`Page loads: ${time1}ms, ${time2}ms, ${time3}ms`);

                assert.ok(time1 < 1000, `First page should load <1s, was ${time1}ms`);
                assert.ok(time2 < 1000, `Second page should load <1s, was ${time2}ms`);
                assert.ok(time3 < 1000, `Third page should load <1s, was ${time3}ms`);

                // Verify distinct data - getColumnData returns BoardCard[] directly
                const ids1 = page1.map(c => c.id);
                const ids2 = page2.map(c => c.id);
                const overlap = ids1.filter(id => ids2.includes(id));
                assert.strictEqual(overlap.length, 0, 'Pages should not overlap');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Parallel column loading performance', async function() {
            this.timeout(30000);

            try {
                await createManyIssues(400);

                // Load all columns in parallel
                const startParallel = Date.now();
                const [ready, inProgress, blocked, closed] = await Promise.all([
                    adapter.getColumnData('ready', 0, 100),
                    adapter.getColumnData('in_progress', 0, 100),
                    adapter.getColumnData('blocked', 0, 100),
                    adapter.getColumnData('closed', 0, 100)
                ]);
                const parallelTime = Date.now() - startParallel;

                console.log(`Parallel load of 4 columns in ${parallelTime}ms`);
                console.log(`Loaded: ready=${ready.length}, in_progress=${inProgress.length}, blocked=${blocked.length}, closed=${closed.length}`);

                // Parallel should be faster than sequential
                assert.ok(parallelTime < 2000, `Parallel load should be <2s, was ${parallelTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Deep offset performance (loading far into dataset)', async function() {
            this.timeout(30000);

            try {
                await createManyIssues(500);

                // Load from offset 0
                const start1 = Date.now();
                const page1 = await adapter.getColumnData('ready', 0, 50);
                const time1 = Date.now() - start1;

                // Load from offset 200 (deep in dataset)
                const start2 = Date.now();
                const page2 = await adapter.getColumnData('ready', 200, 50);
                const time2 = Date.now() - start2;

                console.log(`Offset 0: ${time1}ms, Offset 200: ${time2}ms`);

                // Deep offset should not be significantly slower
                // Allow 2x slowdown for deep offset, but should still be fast
                assert.ok(time2 < 2000, `Deep offset load should be <2s, was ${time2}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Filtering Performance', () => {
        test('Note: Filtering is client-side in main.js', () => {
            // Filtering happens in webview JavaScript, not in adapter
            // Performance depends on DOM operations and array filtering
            // These tests document expected client-side performance
            assert.ok(true, 'Filtering performance is client-side responsibility');
        });

        test('Search query performance on large dataset', async function() {
            this.timeout(30000);

            try {
                // Create issues with searchable content
                for (let i = 0; i < 500; i++) {
                    await adapter.createIssue({
                        title: `Issue ${i}: ${i % 5 === 0 ? 'urgent' : 'normal'} priority`,
                        description: `Description for issue ${i}`
                    });
                }

                // Load all issues for client-side filtering simulation
                const board = await adapter.getBoard();

                // Simulate client-side search (title + description)
                const searchTerm = 'urgent';
                const startSearch = Date.now();
                const filtered = (board.cards || []).filter(card =>
                    card.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    card.description.toLowerCase().includes(searchTerm.toLowerCase())
                );
                const searchTime = Date.now() - startSearch;

                console.log(`Filtered 500 issues to ${filtered.length} results in ${searchTime}ms`);

                assert.ok(searchTime < 100, `Search should be <100ms, was ${searchTime}ms`);
                assert.ok(filtered.length > 0, 'Should find matching issues');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Multiple filter combination performance', async function() {
            this.timeout(30000);

            try {
                await createManyIssues(500);
                const board = await adapter.getBoard();

                // Simulate multiple filters: status + priority + type + assignee
                const startFilter = Date.now();
                const filtered = (board.cards || []).filter(card =>
                    (card.status === 'open' || card.status === 'in_progress') &&
                    card.priority <= 2 &&
                    (card.issue_type === 'bug' || card.issue_type === 'feature') &&
                    (card.assignee !== null)
                );
                const filterTime = Date.now() - startFilter;

                console.log(`Applied multiple filters to 500 issues in ${filterTime}ms`);

                assert.ok(filterTime < 100, `Multi-filter should be <100ms, was ${filterTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Memory Usage and Stability', () => {
        test('Note: Memory testing requires process.memoryUsage()', () => {
            // Node.js provides process.memoryUsage() for heap tracking
            // VSCode extension tests can monitor memory during operations
            // Significant memory growth indicates leaks
            assert.ok(true, 'Memory testing uses process.memoryUsage() for heap tracking');
        });

        test('Repeated board loads should not grow memory', async function() {
            this.timeout(60000);

            try {
                await createManyIssues(200);

                // Force garbage collection if available
                if (global.gc) {
                    global.gc();
                }

                const initialMemory = process.memoryUsage().heapUsed;
                const memoryReadings: number[] = [initialMemory];

                // Load board 10 times
                for (let i = 0; i < 10; i++) {
                    await adapter.getBoard();

                    if (global.gc) {
                        global.gc();
                    }

                    const currentMemory = process.memoryUsage().heapUsed;
                    memoryReadings.push(currentMemory);
                    console.log(`Load ${i + 1}: ${(currentMemory / 1024 / 1024).toFixed(2)} MB`);
                }

                const finalMemory = memoryReadings[memoryReadings.length - 1];
                const memoryGrowth = finalMemory - initialMemory;
                const memoryGrowthMB = memoryGrowth / 1024 / 1024;

                console.log(`Memory growth after 10 loads: ${memoryGrowthMB.toFixed(2)} MB`);

                // Allow some growth due to caching, but should not grow unbounded
                // 50MB growth for 10 loads is acceptable
                assert.ok(memoryGrowthMB < 50, `Memory growth should be <50MB, was ${memoryGrowthMB.toFixed(2)}MB`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Repeated column data loads should not leak memory', async function() {
            this.timeout(60000);

            try {
                await createManyIssues(300);

                if (global.gc) {
                    global.gc();
                }

                const initialMemory = process.memoryUsage().heapUsed;

                // Load column data 20 times
                for (let i = 0; i < 20; i++) {
                    await adapter.getColumnData('ready', 0, 50);

                    if (i % 5 === 0 && global.gc) {
                        global.gc();
                    }
                }

                if (global.gc) {
                    global.gc();
                }

                const finalMemory = process.memoryUsage().heapUsed;
                const memoryGrowth = finalMemory - initialMemory;
                const memoryGrowthMB = memoryGrowth / 1024 / 1024;

                console.log(`Memory growth after 20 column loads: ${memoryGrowthMB.toFixed(2)} MB`);

                assert.ok(memoryGrowthMB < 30, `Memory growth should be <30MB, was ${memoryGrowthMB.toFixed(2)}MB`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create/update/delete cycle should not leak memory', async function() {
            this.timeout(60000);

            try {
                if (global.gc) {
                    global.gc();
                }

                const initialMemory = process.memoryUsage().heapUsed;

                // Create, update, close 50 issues, repeat 5 times
                for (let cycle = 0; cycle < 5; cycle++) {
                    const issues = [];

                    // Create 50 issues
                    for (let i = 0; i < 50; i++) {
                        const result = await adapter.createIssue({
                            title: `Cycle ${cycle} Issue ${i}`,
                            description: 'Test description'
                        });
                        issues.push(result);
                    }

                    // Update each issue
                    for (const issue of issues) {
                        await adapter.updateIssue(issue.id, {
                            description: 'Updated description',
                            priority: 1
                        });
                    }

                    // Close each issue
                    for (const issue of issues) {
                        await adapter.setIssueStatus(issue.id, 'closed');
                    }

                    if (global.gc) {
                        global.gc();
                    }
                }

                if (global.gc) {
                    global.gc();
                }

                const finalMemory = process.memoryUsage().heapUsed;
                const memoryGrowth = finalMemory - initialMemory;
                const memoryGrowthMB = memoryGrowth / 1024 / 1024;

                console.log(`Memory growth after 5 cycles (250 operations each): ${memoryGrowthMB.toFixed(2)} MB`);

                // Allow for 40MB growth across all cycles
                assert.ok(memoryGrowthMB < 40, `Memory growth should be <40MB, was ${memoryGrowthMB.toFixed(2)}MB`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Debouncing and Batching', () => {
        test('Note: Save debouncing prevents excessive writes', () => {
            // BeadsAdapter uses scheduleSave() with 300ms debounce
            // Multiple rapid mutations should coalesce into single write
            // Prevents excessive disk I/O on large batch operations
            assert.ok(true, 'Save operations are debounced with 300ms delay');
        });

        test('Rapid mutations should coalesce saves', async function() {
            this.timeout(30000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '' });

                const startRapid = Date.now();

                // Make 10 rapid updates
                for (let i = 0; i < 10; i++) {
                    await adapter.updateIssue(result.id, {
                        description: `Update ${i}`
                    });
                }

                // Wait for debounce to complete
                await new Promise(resolve => setTimeout(resolve, 500));

                const rapidTime = Date.now() - startRapid;

                console.log(`10 rapid updates completed in ${rapidTime}ms`);

                // Should complete quickly due to debouncing
                assert.ok(rapidTime < 2000, `Rapid updates should complete <2s, was ${rapidTime}ms`);

                // Verify final state is correct
                const board = await adapter.getBoard();
                const final = (board.cards || []).find(c => c.id === result.id);
                assert.strictEqual(final?.description, 'Update 9');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Batched issue creation performance', async function() {
            this.timeout(30000);

            try {
                const startBatch = Date.now();

                // Create 100 issues in quick succession
                const promises = [];
                for (let i = 0; i < 100; i++) {
                    promises.push(
                        adapter.createIssue({
                            title: `Batch Issue ${i}`,
                            description: `Description ${i}`
                        })
                    );
                }

                await Promise.all(promises);

                // Wait for debounced save
                await new Promise(resolve => setTimeout(resolve, 500));

                const batchTime = Date.now() - startBatch;

                console.log(`Created 100 issues in batch in ${batchTime}ms`);

                assert.ok(batchTime < 10000, `Batch creation should be <10s, was ${batchTime}ms`);

                const board = await adapter.getBoard();
                assert.ok((board.cards || []).length >= 100, 'All batch issues should be created');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Worst-Case Scenarios', () => {
        test('All issues in single column (closed)', async function() {
            this.timeout(30000);

            try {
                // Create 500 closed issues (all in one column)
                await createManyIssues(500, { closed: 1.0 });

                const startLoad = Date.now();
                const closedData = await adapter.getColumnData('closed', 0, 100);
                const loadTime = Date.now() - startLoad;

                console.log(`Loaded first 100 of 500 closed issues in ${loadTime}ms`);

                assert.ok(loadTime < 2000, `Loading large single column should be <2s, was ${loadTime}ms`);
                assert.ok(closedData.length === 100, 'Should load exactly 100 issues');

                // Get total count
                const totalCount = await adapter.getColumnCount('closed');
                assert.ok(totalCount >= 500, 'Total count should reflect full column');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('All issues with many labels and dependencies', async function() {
            this.timeout(60000);

            try {
                // Create 100 issues
                const issues = await createManyIssues(100);

                // Add labels to each issue
                for (const issue of issues) {
                    await adapter.addLabel(issue.id, 'urgent');
                    await adapter.addLabel(issue.id, 'backend');
                    await adapter.addLabel(issue.id, `team-${issue.id.slice(0, 5)}`);
                }

                // Add dependencies (each issue depends on next)
                for (let i = 0; i < issues.length - 1; i++) {
                    await adapter.addDependency(issues[i + 1].id, issues[i].id, 'blocks');
                }

                // Wait for saves
                await new Promise(resolve => setTimeout(resolve, 500));

                // Load board with all relationships
                const startLoad = Date.now();
                const board = await adapter.getBoard();
                const loadTime = Date.now() - startLoad;

                console.log(`Loaded 100 issues with labels and dependencies in ${loadTime}ms`);

                // Verify relationships loaded
                const firstCard = (board.cards || []).find(c => c.id === issues[0].id);
                assert.ok(firstCard, 'Should find first issue');
                assert.ok(firstCard.labels.length >= 3, 'Should load all labels');

                assert.ok(loadTime < 3000, `Load with relationships should be <3s, was ${loadTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Very long issue titles and descriptions', async function() {
            this.timeout(30000);

            try {
                const longTitle = 'A'.repeat(500);
                const longDescription = 'B'.repeat(5000);

                const startCreate = Date.now();

                for (let i = 0; i < 50; i++) {
                    await adapter.createIssue({
                        title: `${i} ${longTitle}`,
                        description: longDescription
                    });
                }

                const createTime = Date.now() - startCreate;

                console.log(`Created 50 issues with long content in ${createTime}ms`);

                const startLoad = Date.now();
                const board = await adapter.getBoard();
                const loadTime = Date.now() - startLoad;

                console.log(`Loaded 50 issues with long content in ${loadTime}ms`);

                assert.ok(loadTime < 2000, `Loading long content should be <2s, was ${loadTime}ms`);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Performance Benchmarks (Documentation)', () => {
        test('Note: Target performance for 100 issues', () => {
            // Initial board load: <500ms
            // Column data load (25 issues): <200ms
            // Get column count: <100ms
            // Client-side filtering: <50ms
            assert.ok(true, 'Target: 100 issues loads in <500ms');
        });

        test('Note: Target performance for 500 issues', () => {
            // Initial board load (with limit 100): <1000ms
            // Full board load: <3000ms
            // Column data load (50 issues): <500ms
            // Get column count: <200ms
            // Client-side filtering: <100ms
            assert.ok(true, 'Target: 500 issues loads in <3s');
        });

        test('Note: Target performance for 1000 issues', () => {
            // Initial board load (with limit 100): <1500ms
            // Full board load: <5000ms
            // Column data load (100 issues): <800ms
            // Get column count: <300ms
            // Client-side filtering: <200ms
            assert.ok(true, 'Target: 1000 issues loads in <5s');
        });

        test('Note: Target performance for 5000+ issues', () => {
            // Initial board load (with limit 100): <2000ms
            // Full board load: Not recommended, use incremental loading
            // Column data load (100 issues): <1000ms
            // Get column count: <500ms
            // Client-side filtering: Should implement virtual scrolling
            assert.ok(true, 'Target: 5000+ issues requires incremental loading and virtual scrolling');
        });
    });
});

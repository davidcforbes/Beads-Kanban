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
suite('Incremental Loading Tests - Edge Cases', () => {
    let adapter;
    let output;
    // Helper to create many test issues with specific status distribution
    async function createManyIssues(count, statusDistribution) {
        const statuses = ['open', 'in_progress', 'blocked', 'closed'];
        const types = ['task', 'bug', 'feature', 'epic', 'chore'];
        const distribution = statusDistribution || {
            open: 0.4,
            in_progress: 0.3,
            blocked: 0.1,
            closed: 0.2
        };
        const issues = [];
        for (let i = 0; i < count; i++) {
            const rand = Math.random();
            let status = 'open';
            let cumulative = 0;
            for (const [s, prob] of Object.entries(distribution)) {
                cumulative += prob;
                if (rand <= cumulative) {
                    status = s;
                    break;
                }
            }
            const issue = await adapter.createIssue({
                title: `Test Issue ${i}`,
                description: `This is test issue number ${i} with some description text.`,
                status,
                priority: i % 5,
                issue_type: types[i % types.length],
                assignee: i % 3 === 0 ? `user${i % 10}` : null,
                estimated_minutes: (i % 8) * 30
            });
            issues.push(issue);
        }
        return issues;
    }
    setup(function () {
        this.timeout(10000);
        output = vscode.window.createOutputChannel('Test Incremental Loading');
        adapter = new beadsAdapter_1.BeadsAdapter(output);
    });
    teardown(function () {
        if (adapter) {
            adapter.dispose();
        }
        if (output) {
            output.dispose();
        }
    });
    suite('Column-Based Pagination Correctness', () => {
        test('Ready column pagination - all pages distinct', async function () {
            this.timeout(30000);
            try {
                // Create 150 open issues (should all be ready since no dependencies)
                await createManyIssues(150, { open: 1.0 });
                const readyCount = await adapter.getColumnCount('ready');
                assert.ok(readyCount >= 150, `Should have at least 150 ready issues, got ${readyCount}`);
                // Load 3 pages of 50 each
                const page1 = await adapter.getColumnData('ready', 0, 50);
                const page2 = await adapter.getColumnData('ready', 50, 50);
                const page3 = await adapter.getColumnData('ready', 100, 50);
                assert.strictEqual(page1.length, 50, 'Page 1 should have 50 issues');
                assert.strictEqual(page2.length, 50, 'Page 2 should have 50 issues');
                assert.strictEqual(page3.length, 50, 'Page 3 should have 50 issues');
                // Verify all IDs are distinct (no overlap between pages)
                const ids1 = new Set(page1.map(c => c.id));
                const ids2 = new Set(page2.map(c => c.id));
                const ids3 = new Set(page3.map(c => c.id));
                const overlap12 = [...ids1].filter(id => ids2.has(id));
                const overlap23 = [...ids2].filter(id => ids3.has(id));
                const overlap13 = [...ids1].filter(id => ids3.has(id));
                assert.strictEqual(overlap12.length, 0, 'Page 1 and 2 should not overlap');
                assert.strictEqual(overlap23.length, 0, 'Page 2 and 3 should not overlap');
                assert.strictEqual(overlap13.length, 0, 'Page 1 and 3 should not overlap');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('In Progress column pagination - correct status filtering', async function () {
            this.timeout(30000);
            try {
                // Create 100 in_progress issues
                await createManyIssues(100, { in_progress: 1.0 });
                const inProgressCount = await adapter.getColumnCount('in_progress');
                assert.ok(inProgressCount >= 100, `Should have at least 100 in_progress issues, got ${inProgressCount}`);
                // Load all pages
                const page1 = await adapter.getColumnData('in_progress', 0, 40);
                const page2 = await adapter.getColumnData('in_progress', 40, 40);
                const page3 = await adapter.getColumnData('in_progress', 80, 40);
                // Verify all cards have correct status
                const allCards = [...page1, ...page2, ...page3];
                for (const card of allCards) {
                    assert.strictEqual(card.status, 'in_progress', `Card ${card.id} should have in_progress status`);
                }
                assert.ok(allCards.length >= 100, 'Should load at least 100 cards total');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Blocked column pagination - includes blocked status', async function () {
            this.timeout(30000);
            try {
                // Create 80 blocked issues
                await createManyIssues(80, { blocked: 1.0 });
                const blockedCount = await adapter.getColumnCount('blocked');
                assert.ok(blockedCount >= 80, `Should have at least 80 blocked issues, got ${blockedCount}`);
                const page1 = await adapter.getColumnData('blocked', 0, 30);
                const page2 = await adapter.getColumnData('blocked', 30, 30);
                // All cards should have blocked status or positive blocked_by_count
                for (const card of [...page1, ...page2]) {
                    const isBlocked = card.status === 'blocked' || card.blocked_by_count > 0;
                    assert.ok(isBlocked, `Card ${card.id} should be blocked (status=${card.status}, blocked_by_count=${card.blocked_by_count})`);
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Closed column pagination - large dataset', async function () {
            this.timeout(30000);
            try {
                // Create 200 closed issues
                await createManyIssues(200, { closed: 1.0 });
                const closedCount = await adapter.getColumnCount('closed');
                assert.ok(closedCount >= 200, `Should have at least 200 closed issues, got ${closedCount}`);
                // Load multiple pages
                const page1 = await adapter.getColumnData('closed', 0, 50);
                const page2 = await adapter.getColumnData('closed', 50, 50);
                const page3 = await adapter.getColumnData('closed', 100, 50);
                const page4 = await adapter.getColumnData('closed', 150, 50);
                assert.strictEqual(page1.length, 50, 'Page 1 should have 50 issues');
                assert.strictEqual(page2.length, 50, 'Page 2 should have 50 issues');
                assert.strictEqual(page3.length, 50, 'Page 3 should have 50 issues');
                assert.strictEqual(page4.length, 50, 'Page 4 should have 50 issues');
                // Verify all have closed status
                for (const card of [...page1, ...page2, ...page3, ...page4]) {
                    assert.strictEqual(card.status, 'closed', `Card ${card.id} should be closed`);
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('Offset/Limit Boundary Conditions', () => {
        test('Offset = 0, Limit = 0 returns empty array', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(50, { open: 1.0 });
                const result = await adapter.getColumnData('ready', 0, 0);
                assert.strictEqual(result.length, 0, 'Should return empty array when limit=0');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Offset = 0, Limit > totalCount returns all items', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(30, { in_progress: 1.0 });
                const count = await adapter.getColumnCount('in_progress');
                const result = await adapter.getColumnData('in_progress', 0, 1000);
                assert.strictEqual(result.length, count, 'Should return all items when limit > totalCount');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Offset >= totalCount returns empty array', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(20, { closed: 1.0 });
                const count = await adapter.getColumnCount('closed');
                const result = await adapter.getColumnData('closed', count + 10, 50);
                assert.strictEqual(result.length, 0, 'Should return empty array when offset >= totalCount');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Offset near end returns partial page', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(55, { open: 1.0 });
                const count = await adapter.getColumnCount('ready');
                const result = await adapter.getColumnData('ready', 50, 50);
                assert.ok(result.length <= 50, 'Should return at most 50 items');
                assert.ok(result.length > 0, 'Should return some items');
                assert.ok(result.length <= count - 50, 'Should return remaining items only');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Large limit returns all items', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(25, { blocked: 1.0 });
                const count = await adapter.getColumnCount('blocked');
                const result = await adapter.getColumnData('blocked', 0, 999999);
                assert.strictEqual(result.length, count, 'Should return all items with very large limit');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('hasMore Flag Accuracy (via count)', () => {
        test('hasMore calculation - multiple pages', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(75, { open: 1.0 });
                const totalCount = await adapter.getColumnCount('ready');
                // Page 1: offset=0, limit=25, loaded=25, hasMore = (0+25 < totalCount)
                const page1 = await adapter.getColumnData('ready', 0, 25);
                const hasMore1 = (0 + page1.length) < totalCount;
                assert.strictEqual(hasMore1, true, 'Page 1 should have more data');
                // Page 2: offset=25, limit=25, loaded=25, hasMore = (25+25 < totalCount)
                const page2 = await adapter.getColumnData('ready', 25, 25);
                const hasMore2 = (25 + page2.length) < totalCount;
                assert.strictEqual(hasMore2, true, 'Page 2 should have more data');
                // Page 3: offset=50, limit=25, loaded=25, hasMore = (50+25 < totalCount)
                const page3 = await adapter.getColumnData('ready', 50, 25);
                const hasMore3 = (50 + page3.length) < totalCount;
                assert.strictEqual(hasMore3, false, 'Page 3 should be the last page');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('hasMore = false when reaching end', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(100, { closed: 1.0 });
                const totalCount = await adapter.getColumnCount('closed');
                // Load exact number of pages to reach the end
                const pageSize = 50;
                const lastPageOffset = Math.floor(totalCount / pageSize) * pageSize;
                const lastPage = await adapter.getColumnData('closed', lastPageOffset, pageSize);
                const hasMore = (lastPageOffset + lastPage.length) < totalCount;
                assert.strictEqual(hasMore, false, 'Last page should have hasMore=false');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('hasMore with single page that fits all items', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(15, { in_progress: 1.0 });
                const totalCount = await adapter.getColumnCount('in_progress');
                const page = await adapter.getColumnData('in_progress', 0, 100);
                const hasMore = (0 + page.length) < totalCount;
                assert.strictEqual(hasMore, false, 'Single page with all items should have hasMore=false');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('LoadMore with No More Data', () => {
        test('LoadMore at end returns empty array', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(50, { open: 1.0 });
                const count = await adapter.getColumnCount('ready');
                // Load beyond the end
                const result = await adapter.getColumnData('ready', count, 50);
                assert.strictEqual(result.length, 0, 'LoadMore at end should return empty array');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('LoadMore with exact count offset returns empty', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(60, { in_progress: 1.0 });
                const count = await adapter.getColumnCount('in_progress');
                const result = await adapter.getColumnData('in_progress', count, 10);
                assert.strictEqual(result.length, 0, 'LoadMore with offset=count should return empty');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('Column State Consistency After Mutations', () => {
        test('Count updated after creating issue', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(20, { open: 1.0 });
                const countBefore = await adapter.getColumnCount('ready');
                // Create a new open issue
                await adapter.createIssue({
                    title: 'New Issue',
                    description: 'New issue for testing',
                    status: 'open',
                    priority: 2,
                    issue_type: 'task'
                });
                const countAfter = await adapter.getColumnCount('ready');
                assert.strictEqual(countAfter, countBefore + 1, 'Count should increase by 1 after creating issue');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Column data updated after moving issue', async function () {
            this.timeout(20000);
            try {
                // Create open issues
                const issues = await createManyIssues(10, { open: 1.0 });
                const readyCountBefore = await adapter.getColumnCount('ready');
                const inProgressCountBefore = await adapter.getColumnCount('in_progress');
                // Move first issue to in_progress
                const issueToMove = issues[0];
                await adapter.setIssueStatus(issueToMove.id, 'in_progress');
                const readyCountAfter = await adapter.getColumnCount('ready');
                const inProgressCountAfter = await adapter.getColumnCount('in_progress');
                assert.strictEqual(readyCountAfter, readyCountBefore - 1, 'Ready count should decrease by 1');
                assert.strictEqual(inProgressCountAfter, inProgressCountBefore + 1, 'In Progress count should increase by 1');
                // Verify issue is in new column
                const inProgressData = await adapter.getColumnData('in_progress', 0, 100);
                const movedIssue = inProgressData.find(c => c.id === issueToMove.id);
                assert.ok(movedIssue, 'Moved issue should appear in in_progress column');
                assert.strictEqual(movedIssue.status, 'in_progress', 'Issue should have in_progress status');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Pagination consistent after bulk updates', async function () {
            this.timeout(30000);
            try {
                // Create 100 issues
                const issues = await createManyIssues(100, { open: 1.0 });
                // Move first 30 to in_progress
                for (let i = 0; i < 30; i++) {
                    await adapter.setIssueStatus(issues[i].id, 'in_progress');
                }
                const readyCount = await adapter.getColumnCount('ready');
                const inProgressCount = await adapter.getColumnCount('in_progress');
                // Load all pages of in_progress
                const page1 = await adapter.getColumnData('in_progress', 0, 15);
                const page2 = await adapter.getColumnData('in_progress', 15, 15);
                assert.strictEqual(page1.length, 15, 'Page 1 should have 15 issues');
                assert.strictEqual(page2.length, 15, 'Page 2 should have 15 issues');
                // Verify total count matches
                const totalLoaded = page1.length + page2.length;
                assert.strictEqual(totalLoaded, 30, 'Should have loaded all 30 moved issues');
                assert.ok(inProgressCount >= 30, 'Count should reflect all moved issues');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Closed column updated after closing issue', async function () {
            this.timeout(20000);
            try {
                const issues = await createManyIssues(15, { in_progress: 1.0 });
                const closedCountBefore = await adapter.getColumnCount('closed');
                // Close first issue
                await adapter.updateIssue(issues[0].id, { status: 'closed' });
                const closedCountAfter = await adapter.getColumnCount('closed');
                assert.strictEqual(closedCountAfter, closedCountBefore + 1, 'Closed count should increase by 1');
                // Verify issue appears in closed column
                const closedData = await adapter.getColumnData('closed', 0, 100);
                const closedIssue = closedData.find(c => c.id === issues[0].id);
                assert.ok(closedIssue, 'Closed issue should appear in closed column');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('Large Dataset Simulation', () => {
        test('1K issues - column counts remain fast', async function () {
            this.timeout(120000); // 2 minutes for large dataset
            try {
                // Create 1000 issues (simulating larger dataset)
                console.log('Creating 1000 test issues...');
                await createManyIssues(1000, {
                    open: 0.3,
                    in_progress: 0.2,
                    blocked: 0.1,
                    closed: 0.4
                });
                console.log('Testing column count performance...');
                const startCount = Date.now();
                const readyCount = await adapter.getColumnCount('ready');
                const inProgressCount = await adapter.getColumnCount('in_progress');
                const blockedCount = await adapter.getColumnCount('blocked');
                const closedCount = await adapter.getColumnCount('closed');
                const countTime = Date.now() - startCount;
                console.log(`Column counts: ready=${readyCount}, in_progress=${inProgressCount}, blocked=${blockedCount}, closed=${closedCount}`);
                console.log(`Count time: ${countTime}ms`);
                assert.ok(countTime < 1000, `Column counts should be <1s even with 1K issues, was ${countTime}ms`);
                assert.ok(readyCount + inProgressCount + blockedCount + closedCount >= 1000, 'Should have at least 1000 total issues');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('1K issues - pagination remains fast', async function () {
            this.timeout(120000);
            try {
                // Create 1000 issues
                console.log('Creating 1000 test issues for pagination test...');
                await createManyIssues(1000, { closed: 1.0 });
                console.log('Testing pagination performance...');
                const startLoad = Date.now();
                const page1 = await adapter.getColumnData('closed', 0, 100);
                const time1 = Date.now() - startLoad;
                const startLoad2 = Date.now();
                const page2 = await adapter.getColumnData('closed', 500, 100);
                const time2 = Date.now() - startLoad2;
                const startLoad3 = Date.now();
                const page3 = await adapter.getColumnData('closed', 900, 100);
                const time3 = Date.now() - startLoad3;
                console.log(`Page load times: ${time1}ms, ${time2}ms, ${time3}ms`);
                assert.ok(time1 < 2000, `First page should load <2s, was ${time1}ms`);
                assert.ok(time2 < 2000, `Mid page should load <2s, was ${time2}ms`);
                assert.ok(time3 < 2000, `Last page should load <2s, was ${time3}ms`);
                assert.strictEqual(page1.length, 100, 'Page 1 should have 100 issues');
                assert.strictEqual(page2.length, 100, 'Page 2 should have 100 issues');
                assert.ok(page3.length > 0, 'Page 3 should have issues');
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Large dataset - all columns accessible', async function () {
            this.timeout(120000);
            try {
                console.log('Creating 800 issues across all statuses...');
                await createManyIssues(800, {
                    open: 0.25,
                    in_progress: 0.25,
                    blocked: 0.25,
                    closed: 0.25
                });
                console.log('Loading first page of each column...');
                const [ready, inProgress, blocked, closed] = await Promise.all([
                    adapter.getColumnData('ready', 0, 50),
                    adapter.getColumnData('in_progress', 0, 50),
                    adapter.getColumnData('blocked', 0, 50),
                    adapter.getColumnData('closed', 0, 50)
                ]);
                assert.ok(ready.length > 0, 'Ready column should have data');
                assert.ok(inProgress.length > 0, 'In Progress column should have data');
                assert.ok(blocked.length > 0, 'Blocked column should have data');
                assert.ok(closed.length > 0, 'Closed column should have data');
                console.log(`Loaded: ready=${ready.length}, in_progress=${inProgress.length}, blocked=${blocked.length}, closed=${closed.length}`);
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
    suite('SQL Query Correctness', () => {
        test('Ready column excludes non-open issues', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(50, {
                    open: 0.5,
                    in_progress: 0.2,
                    blocked: 0.2,
                    closed: 0.1
                });
                const readyData = await adapter.getColumnData('ready', 0, 100);
                for (const card of readyData) {
                    assert.strictEqual(card.status, 'open', `Ready column should only have open issues, found ${card.status}`);
                    assert.strictEqual(card.is_ready, true, 'Ready column issues should have is_ready=true');
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Blocked column includes all blocked variations', async function () {
            this.timeout(20000);
            try {
                // Create some blocked issues
                await createManyIssues(30, { blocked: 1.0 });
                const blockedData = await adapter.getColumnData('blocked', 0, 100);
                // All should be blocked status or have blocked_by_count > 0
                for (const card of blockedData) {
                    const isBlocked = card.status === 'blocked' || card.blocked_by_count > 0;
                    assert.ok(isBlocked, `Blocked column should only have blocked issues (status=${card.status}, blocked_by=${card.blocked_by_count})`);
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
        test('Column data has all required fields', async function () {
            this.timeout(20000);
            try {
                await createManyIssues(20, { open: 1.0 });
                const data = await adapter.getColumnData('ready', 0, 10);
                assert.ok(data.length > 0, 'Should have data');
                for (const card of data) {
                    // Check required BoardCard fields
                    assert.ok(card.id, 'Card should have id');
                    assert.ok(card.title, 'Card should have title');
                    assert.ok(card.status, 'Card should have status');
                    assert.ok(typeof card.priority === 'number', 'Card should have priority number');
                    assert.ok(card.issue_type, 'Card should have issue_type');
                    assert.ok(typeof card.is_ready === 'boolean', 'Card should have is_ready boolean');
                    assert.ok(typeof card.blocked_by_count === 'number', 'Card should have blocked_by_count number');
                    assert.ok(Array.isArray(card.labels), 'Card should have labels array');
                }
            }
            catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
});

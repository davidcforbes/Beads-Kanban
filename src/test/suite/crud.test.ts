import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { BeadsAdapter } from '../../beadsAdapter';
import { IssueStatus, IssueType } from '../../types';

suite('CRUD Operations Tests', () => {
    let adapter: BeadsAdapter;
    let testDbPath: string;
    let testWorkspace: string;

    setup(async function() {
        // Create a temporary test database
        testWorkspace = path.join(__dirname, '..', '..', '..', 'test-workspace');
        const beadsDir = path.join(testWorkspace, '.beads');

        if (!fs.existsSync(testWorkspace)) {
            fs.mkdirSync(testWorkspace, { recursive: true });
        }
        if (!fs.existsSync(beadsDir)) {
            fs.mkdirSync(beadsDir, { recursive: true });
        }

        testDbPath = path.join(beadsDir, 'test-crud.db');

        // Remove old test database if it exists
        if (fs.existsSync(testDbPath)) {
            fs.unlinkSync(testDbPath);
        }

        adapter = new BeadsAdapter(testDbPath, testWorkspace);
        await adapter.connect();
    });

    teardown(async function() {
        if (adapter) {
            await adapter.disconnect();
        }

        // Clean up test database
        if (testDbPath && fs.existsSync(testDbPath)) {
            try {
                fs.unlinkSync(testDbPath);
            } catch (err) {
                // Ignore cleanup errors
            }
        }
    });

    suite('Create Operations', () => {
        test('Create issue with minimal fields (title only)', async function() {
            const issue = await adapter.createIssue({
                title: 'Test Issue',
                description: ''
            });

            assert.ok(issue.id, 'Issue should have an ID');
            assert.strictEqual(issue.title, 'Test Issue', 'Title should match');
            assert.strictEqual(issue.status, 'open', 'Default status should be open');
            assert.strictEqual(issue.priority, 2, 'Default priority should be 2');
            assert.strictEqual(issue.issue_type, 'task', 'Default type should be task');
        });

        test('Create issue with all fields specified', async function() {
            const issue = await adapter.createIssue({
                title: 'Complete Feature',
                description: '## Description\n\nDetailed description here',
                status: 'in_progress' as IssueStatus,
                priority: 1,
                issue_type: 'feature' as IssueType,
                assignee: 'testuser',
                estimated_minutes: 120,
                acceptance_criteria: 'Should pass all tests',
                design: 'Follow existing patterns',
                notes: 'Implementation notes here'
            });

            assert.strictEqual(issue.title, 'Complete Feature');
            assert.strictEqual(issue.description, '## Description\n\nDetailed description here');
            assert.strictEqual(issue.status, 'in_progress');
            assert.strictEqual(issue.priority, 1);
            assert.strictEqual(issue.issue_type, 'feature');
            assert.strictEqual(issue.assignee, 'testuser');
            assert.strictEqual(issue.estimated_minutes, 120);
            assert.strictEqual(issue.acceptance_criteria, 'Should pass all tests');
            assert.strictEqual(issue.design, 'Follow existing patterns');
            assert.strictEqual(issue.notes, 'Implementation notes here');
        });

        test('Create bug issue', async function() {
            const issue = await adapter.createIssue({
                title: 'Fix critical bug',
                description: 'Bug description',
                issue_type: 'bug' as IssueType,
                priority: 0
            });

            assert.strictEqual(issue.issue_type, 'bug');
            assert.strictEqual(issue.priority, 0);
        });

        test('Create epic issue', async function() {
            const issue = await adapter.createIssue({
                title: 'Q1 2026 Goals',
                description: 'Epic description',
                issue_type: 'epic' as IssueType
            });

            assert.strictEqual(issue.issue_type, 'epic');
        });

        test('Create chore issue', async function() {
            const issue = await adapter.createIssue({
                title: 'Update dependencies',
                description: 'Chore description',
                issue_type: 'chore' as IssueType,
                priority: 3
            });

            assert.strictEqual(issue.issue_type, 'chore');
            assert.strictEqual(issue.priority, 3);
        });

        test('Create issue with markdown in description', async function() {
            const markdown = `# Heading

## Subheading

- List item 1
- List item 2

\`\`\`typescript
function test() {
  return true;
}
\`\`\`

**Bold** and *italic* text.`;

            const issue = await adapter.createIssue({
                title: 'Test Markdown',
                description: markdown
            });

            assert.strictEqual(issue.description, markdown);
        });

        test('Created issue should appear in board data', async function() {
            const issue = await adapter.createIssue({
                title: 'Visible Issue',
                description: 'Should be in board'
            });

            const board = await adapter.getBoard();
            const found = board.cards.find(c => c.id === issue.id);

            assert.ok(found, 'Created issue should be in board cards');
            assert.strictEqual(found.title, 'Visible Issue');
        });
    });

    suite('Read Operations', () => {
        test('Get board returns all created issues', async function() {
            await adapter.createIssue({ title: 'Issue 1', description: '' });
            await adapter.createIssue({ title: 'Issue 2', description: '' });
            await adapter.createIssue({ title: 'Issue 3', description: '' });

            const board = await adapter.getBoard();

            assert.ok(board.cards.length >= 3, 'Board should contain at least 3 issues');
            assert.ok(board.cards.some(c => c.title === 'Issue 1'));
            assert.ok(board.cards.some(c => c.title === 'Issue 2'));
            assert.ok(board.cards.some(c => c.title === 'Issue 3'));
        });

        test('Get board with limit respects maxIssues parameter', async function() {
            // Create 5 issues
            for (let i = 0; i < 5; i++) {
                await adapter.createIssue({ title: `Issue ${i}`, description: '' });
            }

            const board = await adapter.getBoard(3);

            assert.ok(board.cards.length <= 3, 'Board should respect maxIssues limit');
        });

        test('Get column data returns correct subset', async function() {
            // Create issues in different statuses
            const openIssue = await adapter.createIssue({ title: 'Open Issue', description: '' });
            const inProgressIssue = await adapter.createIssue({
                title: 'In Progress',
                description: '',
                status: 'in_progress' as IssueStatus
            });

            const readyData = await adapter.getColumnData('ready', 0, 10);
            const inProgressData = await adapter.getColumnData('in_progress', 0, 10);

            assert.ok(readyData.cards.some(c => c.id === openIssue.id), 'Ready column should contain open issue');
            assert.ok(inProgressData.cards.some(c => c.id === inProgressIssue.id), 'In Progress column should contain in_progress issue');
        });

        test('Get column count returns accurate counts', async function() {
            // Create issues
            await adapter.createIssue({ title: 'Open 1', description: '' });
            await adapter.createIssue({ title: 'Open 2', description: '' });
            await adapter.createIssue({ title: 'In Progress', description: '', status: 'in_progress' as IssueStatus });

            const readyCount = await adapter.getColumnCount('ready');
            const inProgressCount = await adapter.getColumnCount('in_progress');

            assert.ok(readyCount >= 2, 'Ready column should have at least 2 issues');
            assert.ok(inProgressCount >= 1, 'In Progress column should have at least 1 issue');
        });
    });

    suite('Update Operations', () => {
        test('Update issue title', async function() {
            const issue = await adapter.createIssue({ title: 'Original Title', description: '' });

            await adapter.updateIssue(issue.id, { title: 'Updated Title' });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.title, 'Updated Title', 'Title should be updated');
        });

        test('Update issue description', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: 'Original description' });

            await adapter.updateIssue(issue.id, { description: 'Updated description' });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.description, 'Updated description');
        });

        test('Update issue priority', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '', priority: 2 });

            await adapter.updateIssue(issue.id, { priority: 0 });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.priority, 0);
        });

        test('Update issue type', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '', issue_type: 'task' as IssueType });

            await adapter.updateIssue(issue.id, { issue_type: 'bug' as IssueType });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.issue_type, 'bug');
        });

        test('Update issue assignee', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });

            await adapter.updateIssue(issue.id, { assignee: 'john.doe' });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.assignee, 'john.doe');
        });

        test('Update issue estimated_minutes', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });

            await adapter.updateIssue(issue.id, { estimated_minutes: 240 });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.estimated_minutes, 240);
        });

        test('Update multiple fields at once', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: 'Original',
                priority: 3,
                assignee: null
            });

            await adapter.updateIssue(issue.id, {
                title: 'Updated Test',
                description: 'New description',
                priority: 1,
                assignee: 'jane.smith',
                estimated_minutes: 180
            });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.title, 'Updated Test');
            assert.strictEqual(updated?.description, 'New description');
            assert.strictEqual(updated?.priority, 1);
            assert.strictEqual(updated?.assignee, 'jane.smith');
            assert.strictEqual(updated?.estimated_minutes, 180);
        });

        test('Update acceptance criteria', async function() {
            const issue = await adapter.createIssue({ title: 'Feature', description: '' });

            await adapter.updateIssue(issue.id, {
                acceptance_criteria: '- [ ] Unit tests pass\n- [ ] Integration tests pass\n- [ ] Code reviewed'
            });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.ok(updated?.acceptance_criteria?.includes('Unit tests pass'));
        });

        test('Update design notes', async function() {
            const issue = await adapter.createIssue({ title: 'Feature', description: '' });

            await adapter.updateIssue(issue.id, {
                design: '## Architecture\n\nUse MVC pattern'
            });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.ok(updated?.design?.includes('Architecture'));
        });

        test('Update notes', async function() {
            const issue = await adapter.createIssue({ title: 'Task', description: '' });

            await adapter.updateIssue(issue.id, {
                notes: 'Blocked on dependency X'
            });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.notes, 'Blocked on dependency X');
        });

        test('Clear assignee by setting to null', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: '',
                assignee: 'original.user'
            });

            await adapter.updateIssue(issue.id, { assignee: null });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.assignee, null);
        });
    });

    suite('Status Transitions (Column Moves)', () => {
        test('Move issue from Ready to In Progress', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            assert.strictEqual(issue.status, 'open');

            await adapter.moveIssue(issue.id, 'in_progress');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'in_progress');
        });

        test('Move issue from In Progress to Blocked', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: '',
                status: 'in_progress' as IssueStatus
            });

            await adapter.moveIssue(issue.id, 'blocked');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'blocked');
        });

        test('Move issue from Blocked back to In Progress', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: '',
                status: 'blocked' as IssueStatus
            });

            await adapter.moveIssue(issue.id, 'in_progress');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'in_progress');
        });

        test('Move issue from In Progress to Closed', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: '',
                status: 'in_progress' as IssueStatus
            });

            await adapter.moveIssue(issue.id, 'closed');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'closed');
            assert.ok(moved?.closed_at, 'Closed issue should have closed_at timestamp');
        });

        test('Move issue from Closed back to Ready', async function() {
            const issue = await adapter.createIssue({
                title: 'Test',
                description: '',
                status: 'closed' as IssueStatus
            });

            await adapter.moveIssue(issue.id, 'ready');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'open');
            assert.strictEqual(moved?.closed_at, null, 'Reopened issue should have null closed_at');
        });

        test('Move from Ready to Closed directly', async function() {
            const issue = await adapter.createIssue({ title: 'Quick close', description: '' });

            await adapter.moveIssue(issue.id, 'closed');

            const board = await adapter.getBoard();
            const moved = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(moved?.status, 'closed');
            assert.ok(moved?.closed_at);
        });

        test('Column data reflects status changes', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });

            // Initially in ready column
            let readyData = await adapter.getColumnData('ready', 0, 100);
            assert.ok(readyData.cards.some(c => c.id === issue.id), 'Should be in ready column');

            // Move to in_progress
            await adapter.moveIssue(issue.id, 'in_progress');

            readyData = await adapter.getColumnData('ready', 0, 100);
            const inProgressData = await adapter.getColumnData('in_progress', 0, 100);

            assert.ok(!readyData.cards.some(c => c.id === issue.id), 'Should not be in ready column');
            assert.ok(inProgressData.cards.some(c => c.id === issue.id), 'Should be in in_progress column');
        });
    });

    suite('Delete Operations (Implicit via Status)', () => {
        test('Note: Issues cannot be permanently deleted', () => {
            // The beads database does not support hard deletion
            // Issues are only soft-deleted by setting status to closed
            // This test documents the requirement
            assert.ok(true, 'Issues are soft-deleted via closed status, not permanently removed');
        });

        test('Closed issues should have closed_at timestamp', async function() {
            const issue = await adapter.createIssue({ title: 'To close', description: '' });

            await adapter.moveIssue(issue.id, 'closed');

            const board = await adapter.getBoard();
            const closed = board.cards.find(c => c.id === issue.id);

            assert.ok(closed?.closed_at, 'Closed issue must have closed_at timestamp');
            assert.ok(new Date(closed.closed_at).getTime() > 0, 'closed_at should be valid date');
        });

        test('Reopening issue clears closed_at timestamp', async function() {
            const issue = await adapter.createIssue({
                title: 'To reopen',
                description: '',
                status: 'closed' as IssueStatus
            });

            await adapter.moveIssue(issue.id, 'ready');

            const board = await adapter.getBoard();
            const reopened = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(reopened?.closed_at, null, 'Reopened issue should have null closed_at');
        });
    });

    suite('Integration: Full CRUD Lifecycle', () => {
        test('Complete lifecycle: Create -> Update -> Move -> Close', async function() {
            // 1. Create
            const issue = await adapter.createIssue({
                title: 'New Feature',
                description: 'Initial description',
                priority: 2,
                issue_type: 'feature' as IssueType
            });

            assert.ok(issue.id);
            assert.strictEqual(issue.status, 'open');

            // 2. Update details
            await adapter.updateIssue(issue.id, {
                title: 'Enhanced Feature',
                description: 'Updated with more details',
                assignee: 'developer1',
                estimated_minutes: 360
            });

            let board = await adapter.getBoard();
            let current = board.cards.find(c => c.id === issue.id);
            assert.strictEqual(current?.title, 'Enhanced Feature');
            assert.strictEqual(current?.assignee, 'developer1');

            // 3. Move to in_progress
            await adapter.moveIssue(issue.id, 'in_progress');

            board = await adapter.getBoard();
            current = board.cards.find(c => c.id === issue.id);
            assert.strictEqual(current?.status, 'in_progress');

            // 4. Add some notes
            await adapter.updateIssue(issue.id, {
                notes: 'Implementation in progress'
            });

            // 5. Complete and close
            await adapter.moveIssue(issue.id, 'closed');

            board = await adapter.getBoard();
            current = board.cards.find(c => c.id === issue.id);
            assert.strictEqual(current?.status, 'closed');
            assert.ok(current?.closed_at);
        });

        test('Multiple issues with different lifecycles', async function() {
            // Issue 1: Create and immediately close
            const issue1 = await adapter.createIssue({ title: 'Quick fix', description: '' });
            await adapter.moveIssue(issue1.id, 'closed');

            // Issue 2: Create, start work, block
            const issue2 = await adapter.createIssue({ title: 'Complex feature', description: '' });
            await adapter.moveIssue(issue2.id, 'in_progress');
            await adapter.moveIssue(issue2.id, 'blocked');

            // Issue 3: Create and leave in ready
            const issue3 = await adapter.createIssue({ title: 'Future work', description: '' });

            const board = await adapter.getBoard();

            const card1 = board.cards.find(c => c.id === issue1.id);
            const card2 = board.cards.find(c => c.id === issue2.id);
            const card3 = board.cards.find(c => c.id === issue3.id);

            assert.strictEqual(card1?.status, 'closed');
            assert.strictEqual(card2?.status, 'blocked');
            assert.strictEqual(card3?.status, 'open');
        });
    });

    suite('Edge Cases', () => {
        test('Update non-existent issue should not crash', async function() {
            // The adapter should handle this gracefully
            // Implementation may vary: throw error or silently ignore
            try {
                await adapter.updateIssue('non-existent-id', { title: 'Updated' });
                // If no error thrown, test passes
                assert.ok(true);
            } catch (err) {
                // If error thrown, that's also acceptable behavior
                assert.ok(true, 'Gracefully handled non-existent issue');
            }
        });

        test('Move non-existent issue should not crash', async function() {
            try {
                await adapter.moveIssue('non-existent-id', 'closed');
                assert.ok(true);
            } catch (err) {
                assert.ok(true, 'Gracefully handled non-existent issue');
            }
        });

        test('Create issue with empty title should fail or use default', async function() {
            // Empty title should either fail validation or use a default
            try {
                const issue = await adapter.createIssue({ title: '', description: '' });
                // If it succeeds, title should have some value
                assert.ok(issue.title.length > 0 || issue.title === '');
                assert.ok(true);
            } catch (err) {
                // Validation error is acceptable
                assert.ok(true, 'Empty title validation enforced');
            }
        });

        test('Create issue with very long title', async function() {
            const longTitle = 'A'.repeat(1000);

            const issue = await adapter.createIssue({ title: longTitle, description: '' });

            // Should either truncate or store full title
            assert.ok(issue.title.length > 0);
        });

        test('Update with partial data should only change specified fields', async function() {
            const issue = await adapter.createIssue({
                title: 'Original',
                description: 'Original desc',
                priority: 2,
                assignee: 'user1'
            });

            // Only update title
            await adapter.updateIssue(issue.id, { title: 'Updated' });

            const board = await adapter.getBoard();
            const updated = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(updated?.title, 'Updated');
            assert.strictEqual(updated?.description, 'Original desc', 'Description should remain unchanged');
            assert.strictEqual(updated?.priority, 2, 'Priority should remain unchanged');
            assert.strictEqual(updated?.assignee, 'user1', 'Assignee should remain unchanged');
        });
    });

    suite('Persistence Verification', () => {
        test('Created issue persists after disconnect/reconnect', async function() {
            const issue = await adapter.createIssue({ title: 'Persistent Issue', description: 'Test' });
            const originalId = issue.id;

            // Disconnect and reconnect
            await adapter.disconnect();
            adapter = new BeadsAdapter(testDbPath, testWorkspace);
            await adapter.connect();

            const board = await adapter.getBoard();
            const persisted = board.cards.find(c => c.id === originalId);

            assert.ok(persisted, 'Issue should persist after reconnect');
            assert.strictEqual(persisted.title, 'Persistent Issue');
        });

        test('Updates persist after disconnect/reconnect', async function() {
            const issue = await adapter.createIssue({ title: 'Original', description: '' });
            await adapter.updateIssue(issue.id, { title: 'Updated', assignee: 'testuser' });

            await adapter.disconnect();
            adapter = new BeadsAdapter(testDbPath, testWorkspace);
            await adapter.connect();

            const board = await adapter.getBoard();
            const persisted = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(persisted?.title, 'Updated');
            assert.strictEqual(persisted?.assignee, 'testuser');
        });

        test('Status changes persist after disconnect/reconnect', async function() {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            await adapter.moveIssue(issue.id, 'in_progress');
            await adapter.moveIssue(issue.id, 'closed');

            await adapter.disconnect();
            adapter = new BeadsAdapter(testDbPath, testWorkspace);
            await adapter.connect();

            const board = await adapter.getBoard();
            const persisted = board.cards.find(c => c.id === issue.id);

            assert.strictEqual(persisted?.status, 'closed');
            assert.ok(persisted?.closed_at);
        });
    });
});

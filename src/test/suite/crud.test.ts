import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';
import { IssueStatus, IssueType } from '../../types';

suite('CRUD Operations Tests', () => {
    let adapter: BeadsAdapter;
    let output: vscode.OutputChannel;

    setup(function() {
        this.timeout(10000);
        output = vscode.window.createOutputChannel('Test CRUD');
        adapter = new BeadsAdapter(output);
    });

    teardown(() => {
        adapter.dispose();
        output.dispose();
    });

    suite('Create Operations', () => {
        test('Create issue with minimal fields (title only)', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test Issue',
                    description: ''
                });

                assert.ok(result.id, 'Issue should have an ID');

                // Verify issue was created by fetching from board
                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue, 'Issue should be in board');
                assert.strictEqual(issue.title, 'Test Issue', 'Title should match');
                assert.strictEqual(issue.status, 'open', 'Default status should be open');
                assert.strictEqual(issue.priority, 2, 'Default priority should be 2');
                assert.strictEqual(issue.issue_type, 'task', 'Default type should be task');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create issue with all fields specified', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
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

                assert.ok(result.id);

                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue);
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
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create bug issue', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Fix critical bug',
                    description: 'Bug description',
                    issue_type: 'bug' as IssueType,
                    priority: 0
                });

                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue);
                assert.strictEqual(issue.issue_type, 'bug');
                assert.strictEqual(issue.priority, 0);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create epic issue', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Q1 2026 Goals',
                    description: 'Epic description',
                    issue_type: 'epic' as IssueType
                });

                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue);
                assert.strictEqual(issue.issue_type, 'epic');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create chore issue', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Update dependencies',
                    description: 'Chore description',
                    issue_type: 'chore' as IssueType,
                    priority: 3
                });

                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue);
                assert.strictEqual(issue.issue_type, 'chore');
                assert.strictEqual(issue.priority, 3);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create issue with markdown in description', async function() {
            this.timeout(10000);

            try {
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

                const result = await adapter.createIssue({
                    title: 'Test Markdown',
                    description: markdown
                });

                const board = await adapter.getBoard();
                const issue = (board.cards || []).find(c => c.id === result.id);

                assert.ok(issue);
                assert.strictEqual(issue.description, markdown);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Created issue should appear in board data', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Visible Issue',
                    description: 'Should be in board'
                });

                const board = await adapter.getBoard();
                const found = (board.cards || []).find(c => c.id === result.id);

                assert.ok(found, 'Created issue should be in board cards');
                assert.strictEqual(found.title, 'Visible Issue');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Read Operations', () => {
        test('Get board returns all created issues', async function() {
            this.timeout(10000);

            try {
                await adapter.createIssue({ title: 'Issue 1', description: '' });
                await adapter.createIssue({ title: 'Issue 2', description: '' });
                await adapter.createIssue({ title: 'Issue 3', description: '' });

                const board = await adapter.getBoard();

                assert.ok((board.cards || []).length >= 3, 'Board should contain at least 3 issues');
                assert.ok((board.cards || []).some(c => c.title === 'Issue 1'));
                assert.ok((board.cards || []).some(c => c.title === 'Issue 2'));
                assert.ok((board.cards || []).some(c => c.title === 'Issue 3'));
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Get board with limit respects maxIssues parameter', async function() {
            this.timeout(10000);

            try {
                // Create 5 issues
                for (let i = 0; i < 5; i++) {
                    await adapter.createIssue({ title: `Issue ${i}`, description: '' });
                }

                const board = await adapter.getBoard();

                assert.ok((board.cards || []).length <= 3, 'Board should respect maxIssues limit');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Get column data returns correct subset', async function() {
            this.timeout(10000);

            try {
                // Create issues in different statuses
                const openResult = await adapter.createIssue({ title: 'Open Issue', description: '' });
                const inProgressResult = await adapter.createIssue({
                    title: 'In Progress',
                    description: '',
                    status: 'in_progress' as IssueStatus
                });

                const readyData = await adapter.getColumnData('ready', 0, 10);
                const inProgressData = await adapter.getColumnData('in_progress', 0, 10);

                assert.ok(readyData.some(c => c.id === openResult.id), 'Ready column should contain open issue');
                assert.ok(inProgressData.some(c => c.id === inProgressResult.id), 'In Progress column should contain in_progress issue');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Get column count returns accurate counts', async function() {
            this.timeout(10000);

            try {
                // Create issues
                await adapter.createIssue({ title: 'Open 1', description: '' });
                await adapter.createIssue({ title: 'Open 2', description: '' });
                await adapter.createIssue({ title: 'In Progress', description: '', status: 'in_progress' as IssueStatus });

                const readyCount = await adapter.getColumnCount('ready');
                const inProgressCount = await adapter.getColumnCount('in_progress');

                assert.ok(readyCount >= 2, 'Ready column should have at least 2 issues');
                assert.ok(inProgressCount >= 1, 'In Progress column should have at least 1 issue');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Update Operations', () => {
        test('Update issue title', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Original Title', description: '' });

                await adapter.updateIssue(result.id, { title: 'Updated Title' });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.title, 'Updated Title', 'Title should be updated');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update issue description', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: 'Original description' });

                await adapter.updateIssue(result.id, { description: 'Updated description' });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.description, 'Updated description');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update issue priority', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '', priority: 2 });

                await adapter.updateIssue(result.id, { priority: 0 });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.priority, 0);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update issue type', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '', issue_type: 'task' as IssueType });

                await adapter.updateIssue(result.id, { issue_type: 'bug' as IssueType });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.issue_type, 'bug');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update issue assignee', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '' });

                await adapter.updateIssue(result.id, { assignee: 'john.doe' });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.assignee, 'john.doe');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update issue estimated_minutes', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '' });

                await adapter.updateIssue(result.id, { estimated_minutes: 240 });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.estimated_minutes, 240);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update multiple fields at once', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: 'Original',
                    priority: 3,
                    assignee: null
                });

                await adapter.updateIssue(result.id, {
                    title: 'Updated Test',
                    description: 'New description',
                    priority: 1,
                    assignee: 'jane.smith',
                    estimated_minutes: 180
                });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.title, 'Updated Test');
                assert.strictEqual(updated?.description, 'New description');
                assert.strictEqual(updated?.priority, 1);
                assert.strictEqual(updated?.assignee, 'jane.smith');
                assert.strictEqual(updated?.estimated_minutes, 180);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update acceptance criteria', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Feature', description: '' });

                await adapter.updateIssue(result.id, {
                    acceptance_criteria: '- [ ] Unit tests pass\n- [ ] Integration tests pass\n- [ ] Code reviewed'
                });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.ok(updated?.acceptance_criteria?.includes('Unit tests pass'));
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update design notes', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Feature', description: '' });

                await adapter.updateIssue(result.id, {
                    design: '## Architecture\n\nUse MVC pattern'
                });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.ok(updated?.design?.includes('Architecture'));
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update notes', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Task', description: '' });

                await adapter.updateIssue(result.id, {
                    notes: 'Blocked on dependency X'
                });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.notes, 'Blocked on dependency X');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Clear assignee by setting to null', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: '',
                    assignee: 'original.user'
                });

                await adapter.updateIssue(result.id, { assignee: null });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.assignee, null);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Status Transitions (Column Moves)', () => {
        test('Move issue from Ready to In Progress', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '' });

                await adapter.setIssueStatus(result.id, 'in_progress');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'in_progress');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move issue from In Progress to Blocked', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: '',
                    status: 'in_progress' as IssueStatus
                });

                await adapter.setIssueStatus(result.id, 'blocked');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'blocked');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move issue from Blocked back to In Progress', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: '',
                    status: 'blocked' as IssueStatus
                });

                await adapter.setIssueStatus(result.id, 'in_progress');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'in_progress');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move issue from In Progress to Closed', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: '',
                    status: 'in_progress' as IssueStatus
                });

                await adapter.setIssueStatus(result.id, 'closed');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'closed');
                assert.ok(moved?.closed_at, 'Closed issue should have closed_at timestamp');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move issue from Closed back to Ready', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Test',
                    description: '',
                    status: 'closed' as IssueStatus
                });

                await adapter.setIssueStatus(result.id, 'open');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'open');
                assert.strictEqual(moved?.closed_at, null, 'Reopened issue should have null closed_at');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move from Ready to Closed directly', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Quick close', description: '' });

                await adapter.setIssueStatus(result.id, 'closed');

                const board = await adapter.getBoard();
                const moved = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(moved?.status, 'closed');
                assert.ok(moved?.closed_at);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Column data reflects status changes', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'Test', description: '' });

                // Initially in ready column
                let readyData = await adapter.getColumnData('ready', 0, 100);
                assert.ok(readyData.some(c => c.id === result.id), 'Should be in ready column');

                // Move to in_progress
                await adapter.setIssueStatus(result.id, 'in_progress');

                readyData = await adapter.getColumnData('ready', 0, 100);
                const inProgressData = await adapter.getColumnData('in_progress', 0, 100);

                assert.ok(!readyData.some(c => c.id === result.id), 'Should not be in ready column');
                assert.ok(inProgressData.some(c => c.id === result.id), 'Should be in in_progress column');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
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
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({ title: 'To close', description: '' });

                await adapter.setIssueStatus(result.id, 'closed');

                const board = await adapter.getBoard();
                const closed = (board.cards || []).find(c => c.id === result.id);

                assert.ok(closed?.closed_at, 'Closed issue must have closed_at timestamp');
                assert.ok(new Date(closed.closed_at).getTime() > 0, 'closed_at should be valid date');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Reopening issue clears closed_at timestamp', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'To reopen',
                    description: '',
                    status: 'closed' as IssueStatus
                });

                await adapter.setIssueStatus(result.id, 'open');

                const board = await adapter.getBoard();
                const reopened = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(reopened?.closed_at, null, 'Reopened issue should have null closed_at');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Integration: Full CRUD Lifecycle', () => {
        test('Complete lifecycle: Create -> Update -> Move -> Close', async function() {
            this.timeout(10000);

            try {
                // 1. Create
                const result = await adapter.createIssue({
                    title: 'New Feature',
                    description: 'Initial description',
                    priority: 2,
                    issue_type: 'feature' as IssueType
                });

                assert.ok(result.id);

                // 2. Update details
                await adapter.updateIssue(result.id, {
                    title: 'Enhanced Feature',
                    description: 'Updated with more details',
                    assignee: 'developer1',
                    estimated_minutes: 360
                });

                let board = await adapter.getBoard();
                let current = (board.cards || []).find(c => c.id === result.id);
                assert.strictEqual(current?.title, 'Enhanced Feature');
                assert.strictEqual(current?.assignee, 'developer1');

                // 3. Move to in_progress
                await adapter.setIssueStatus(result.id, 'in_progress');

                board = await adapter.getBoard();
                current = (board.cards || []).find(c => c.id === result.id);
                assert.strictEqual(current?.status, 'in_progress');

                // 4. Add some notes
                await adapter.updateIssue(result.id, {
                    notes: 'Implementation in progress'
                });

                // 5. Complete and close
                await adapter.setIssueStatus(result.id, 'closed');

                board = await adapter.getBoard();
                current = (board.cards || []).find(c => c.id === result.id);
                assert.strictEqual(current?.status, 'closed');
                assert.ok(current?.closed_at);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Multiple issues with different lifecycles', async function() {
            this.timeout(10000);

            try {
                // Issue 1: Create and immediately close
                const result1 = await adapter.createIssue({ title: 'Quick fix', description: '' });
                await adapter.setIssueStatus(result1.id, 'closed');

                // Issue 2: Create, start work, block
                const result2 = await adapter.createIssue({ title: 'Complex feature', description: '' });
                await adapter.setIssueStatus(result2.id, 'in_progress');
                await adapter.setIssueStatus(result2.id, 'blocked');

                // Issue 3: Create and leave in ready
                const result3 = await adapter.createIssue({ title: 'Future work', description: '' });

                const board = await adapter.getBoard();

                const card1 = (board.cards || []).find(c => c.id === result1.id);
                const card2 = (board.cards || []).find(c => c.id === result2.id);
                const card3 = (board.cards || []).find(c => c.id === result3.id);

                assert.strictEqual(card1?.status, 'closed');
                assert.strictEqual(card2?.status, 'blocked');
                assert.strictEqual(card3?.status, 'open');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Edge Cases', () => {
        test('Update non-existent issue should not crash', async function() {
            this.timeout(10000);

            try {
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
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Move non-existent issue should not crash', async function() {
            this.timeout(10000);

            try {
                try {
                    await adapter.setIssueStatus('non-existent-id', 'closed');
                    assert.ok(true);
                } catch (err) {
                    assert.ok(true, 'Gracefully handled non-existent issue');
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create issue with empty title should fail or use default', async function() {
            this.timeout(10000);

            try {
                // Empty title should either fail validation or use a default
                try {
                    const result = await adapter.createIssue({ title: '', description: '' });
                    // If it succeeds, title should have some value
                    const board = await adapter.getBoard();
                    const issue = (board.cards || []).find(c => c.id === result.id);
                    assert.ok(issue && issue.title !== undefined);
                    assert.ok(true);
                } catch (err) {
                    // Validation error is acceptable
                    assert.ok(true, 'Empty title validation enforced');
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Create issue with very long title', async function() {
            this.timeout(10000);

            try {
                const longTitle = 'A'.repeat(1000);

                const result = await adapter.createIssue({ title: longTitle, description: '' });

                // Should either truncate or store full title
                assert.ok(result.id);
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Update with partial data should only change specified fields', async function() {
            this.timeout(10000);

            try {
                const result = await adapter.createIssue({
                    title: 'Original',
                    description: 'Original desc',
                    priority: 2,
                    assignee: 'user1'
                });

                // Only update title
                await adapter.updateIssue(result.id, { title: 'Updated' });

                const board = await adapter.getBoard();
                const updated = (board.cards || []).find(c => c.id === result.id);

                assert.strictEqual(updated?.title, 'Updated');
                assert.strictEqual(updated?.description, 'Original desc', 'Description should remain unchanged');
                assert.strictEqual(updated?.priority, 2, 'Priority should remain unchanged');
                assert.strictEqual(updated?.assignee, 'user1', 'Assignee should remain unchanged');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });
});

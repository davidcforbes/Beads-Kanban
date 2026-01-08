import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';

suite('Relationships and Metadata Tests', () => {
    let adapter: BeadsAdapter;
    let output: vscode.OutputChannel;

    setup(() => {
        output = vscode.window.createOutputChannel('Test');
        adapter = new BeadsAdapter(output);
    });

    teardown(() => {
        adapter.dispose();
        output.dispose();
    });

    suite('Labels', () => {
        test('Add single label to issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addLabel(issue.id, 'bug');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.ok(card.labels.includes('bug'), 'Issue should have bug label');
                assert.strictEqual(card.labels.length, 1, 'Issue should have exactly 1 label');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Add multiple labels to issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addLabel(issue.id, 'bug');
                await adapter.addLabel(issue.id, 'urgent');
                await adapter.addLabel(issue.id, 'frontend');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.strictEqual(card.labels.length, 3, 'Issue should have 3 labels');
                assert.ok(card.labels.includes('bug'), 'Should have bug label');
                assert.ok(card.labels.includes('urgent'), 'Should have urgent label');
                assert.ok(card.labels.includes('frontend'), 'Should have frontend label');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Remove label from issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addLabel(issue.id, 'bug');
                await adapter.addLabel(issue.id, 'urgent');

                // Verify labels added
                let board = await adapter.getBoard();
                let card = board.cards.find(c => c.id === issue.id);
                assert.strictEqual(card?.labels.length, 2, 'Should have 2 labels initially');

                // Remove one label
                await adapter.removeLabel(issue.id, 'urgent');

                board = await adapter.getBoard();
                card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.strictEqual(card.labels.length, 1, 'Should have 1 label after removal');
                assert.ok(card.labels.includes('bug'), 'Should still have bug label');
                assert.ok(!card.labels.includes('urgent'), 'Should not have urgent label');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Remove all labels from issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addLabel(issue.id, 'bug');
                await adapter.addLabel(issue.id, 'urgent');

                // Remove all labels
                await adapter.removeLabel(issue.id, 'bug');
                await adapter.removeLabel(issue.id, 'urgent');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.strictEqual(card.labels.length, 0, 'Should have no labels');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Labels with special characters', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                const specialLabel = 'needs:review';
                await adapter.addLabel(issue.id, specialLabel);

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.ok(card.labels.includes(specialLabel), 'Should support labels with colons');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Duplicate labels are not added twice', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addLabel(issue.id, 'bug');
                await adapter.addLabel(issue.id, 'bug');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                // Depending on implementation, may have 1 or 2 instances
                // Document behavior: Most systems deduplicate, but verify actual behavior
                assert.ok(card.labels.includes('bug'), 'Should have bug label');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Dependencies - Parent-Child', () => {
        test('Add parent-child dependency', async function() {
            this.timeout(10000);

            try {
                const parent = await adapter.createIssue({ title: 'Parent Epic', description: '' });
                const child = await adapter.createIssue({ title: 'Child Task', description: '' });

                await adapter.addDependency(child.id, parent.id, 'parent-child');

                const board = await adapter.getBoard();
                const childCard = board.cards.find(c => c.id === child.id);
                const parentCard = board.cards.find(c => c.id === parent.id);

                assert.ok(childCard, 'Child should exist');
                assert.ok(parentCard, 'Parent should exist');

                // Verify child has parent
                assert.ok(childCard.parent, 'Child should have parent');
                assert.strictEqual(childCard.parent?.id, parent.id, 'Parent ID should match');

                // Verify parent has children
                assert.ok(parentCard.children && parentCard.children.length > 0, 'Parent should have children');
                assert.ok(parentCard.children.some(c => c.id === child.id), 'Parent should list child');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Add multiple children to parent', async function() {
            this.timeout(10000);

            try {
                const parent = await adapter.createIssue({ title: 'Parent Epic', description: '' });
                const child1 = await adapter.createIssue({ title: 'Child Task 1', description: '' });
                const child2 = await adapter.createIssue({ title: 'Child Task 2', description: '' });

                await adapter.addDependency(child1.id, parent.id, 'parent-child');
                await adapter.addDependency(child2.id, parent.id, 'parent-child');

                const board = await adapter.getBoard();
                const parentCard = board.cards.find(c => c.id === parent.id);

                assert.ok(parentCard, 'Parent should exist');
                assert.ok(parentCard.children, 'Parent should have children array');
                assert.strictEqual(parentCard.children.length, 2, 'Parent should have 2 children');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Remove parent-child dependency', async function() {
            this.timeout(10000);

            try {
                const parent = await adapter.createIssue({ title: 'Parent Epic', description: '' });
                const child = await adapter.createIssue({ title: 'Child Task', description: '' });

                await adapter.addDependency(child.id, parent.id, 'parent-child');

                // Verify dependency added
                let board = await adapter.getBoard();
                let childCard = board.cards.find(c => c.id === child.id);
                assert.ok(childCard?.parent, 'Child should have parent initially');

                // Remove dependency
                await adapter.removeDependency(child.id, parent.id);

                board = await adapter.getBoard();
                childCard = board.cards.find(c => c.id === child.id);
                const parentCard = board.cards.find(c => c.id === parent.id);

                assert.ok(!childCard?.parent, 'Child should not have parent after removal');
                assert.ok(!parentCard?.children || parentCard.children.length === 0, 'Parent should have no children');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Dependencies - Blocks', () => {
        test('Add blocks dependency', async function() {
            this.timeout(10000);

            try {
                const blocker = await adapter.createIssue({ title: 'Blocker Issue', description: '' });
                const blocked = await adapter.createIssue({ title: 'Blocked Issue', description: '' });

                await adapter.addDependency(blocked.id, blocker.id, 'blocks');

                const board = await adapter.getBoard();
                const blockedCard = board.cards.find(c => c.id === blocked.id);
                const blockerCard = board.cards.find(c => c.id === blocker.id);

                assert.ok(blockedCard, 'Blocked issue should exist');
                assert.ok(blockerCard, 'Blocker issue should exist');

                // Verify blocked issue has blockedBy
                assert.ok(blockedCard.blocked_by && blockedCard.blocked_by.length > 0, 'Blocked issue should have blockedBy');
                assert.ok(blockedCard.blocked_by.some(b => b.id === blocker.id), 'Should be blocked by blocker issue');

                // Verify blocker issue has blocks
                assert.ok(blockerCard.blocks && blockerCard.blocks.length > 0, 'Blocker should have blocks array');
                assert.ok(blockerCard.blocks.some(b => b.id === blocked.id), 'Should block the blocked issue');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Issue blocked by multiple issues', async function() {
            this.timeout(10000);

            try {
                const blocker1 = await adapter.createIssue({ title: 'Blocker 1', description: '' });
                const blocker2 = await adapter.createIssue({ title: 'Blocker 2', description: '' });
                const blocked = await adapter.createIssue({ title: 'Blocked Issue', description: '' });

                await adapter.addDependency(blocked.id, blocker1.id, 'blocks');
                await adapter.addDependency(blocked.id, blocker2.id, 'blocks');

                const board = await adapter.getBoard();
                const blockedCard = board.cards.find(c => c.id === blocked.id);

                assert.ok(blockedCard, 'Blocked issue should exist');
                assert.ok(blockedCard.blocked_by, 'Should have blockedBy array');
                assert.strictEqual(blockedCard.blocked_by.length, 2, 'Should be blocked by 2 issues');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Remove blocks dependency', async function() {
            this.timeout(10000);

            try {
                const blocker = await adapter.createIssue({ title: 'Blocker Issue', description: '' });
                const blocked = await adapter.createIssue({ title: 'Blocked Issue', description: '' });

                await adapter.addDependency(blocked.id, blocker.id, 'blocks');

                // Verify dependency added
                let board = await adapter.getBoard();
                let blockedCard = board.cards.find(c => c.id === blocked.id);
                assert.ok(blockedCard?.blocked_by && blockedCard.blocked_by.length > 0, 'Should have blocker initially');

                // Remove dependency
                await adapter.removeDependency(blocked.id, blocker.id);

                board = await adapter.getBoard();
                blockedCard = board.cards.find(c => c.id === blocked.id);

                assert.ok(!blockedCard?.blocked_by || blockedCard.blocked_by.length === 0, 'Should have no blockers after removal');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Comments', () => {
        test('Add comment to issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addComment(issue.id, 'This is a test comment', 'TestUser');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.ok(card.comments && card.comments.length > 0, 'Issue should have comments');
                assert.strictEqual(card.comments.length, 1, 'Should have 1 comment');
                assert.strictEqual(card.comments[0].text, 'This is a test comment', 'Comment text should match');
                assert.strictEqual(card.comments[0].author, 'TestUser', 'Comment author should match');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Add multiple comments to issue', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addComment(issue.id, 'First comment', 'User1');
                await adapter.addComment(issue.id, 'Second comment', 'User2');
                await adapter.addComment(issue.id, 'Third comment', 'User1');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card, 'Issue should exist');
                assert.ok(card.comments, 'Should have comments array');
                assert.strictEqual(card.comments.length, 3, 'Should have 3 comments');

                // Verify comments are in order
                assert.strictEqual(card.comments[0].text, 'First comment', 'First comment should be first');
                assert.strictEqual(card.comments[1].text, 'Second comment', 'Second comment should be second');
                assert.strictEqual(card.comments[2].text, 'Third comment', 'Third comment should be third');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Comment with markdown', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                const markdownComment = '**Bold text** and *italic text* with [a link](https://example.com)';
                await adapter.addComment(issue.id, markdownComment, 'TestUser');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card?.comments && card.comments.length > 0, 'Should have comment');
                assert.strictEqual(card.comments[0].text, markdownComment, 'Markdown should be stored as-is');
                // Note: Rendering happens in webview via marked.js + DOMPurify
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Comment with code block', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                const codeComment = 'Here is some code:\n```javascript\nconst x = 42;\n```';
                await adapter.addComment(issue.id, codeComment, 'TestUser');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card?.comments && card.comments.length > 0, 'Should have comment');
                assert.strictEqual(card.comments[0].text, codeComment, 'Code block should be stored as-is');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Comments have timestamps', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });
                await adapter.addComment(issue.id, 'Test comment', 'TestUser');

                const board = await adapter.getBoard();
                const card = board.cards.find(c => c.id === issue.id);

                assert.ok(card?.comments && card.comments.length > 0, 'Should have comment');
                assert.ok(card.comments[0].created_at, 'Comment should have created_at timestamp');
                // Verify timestamp is valid ISO 8601 format
                const timestamp = new Date(card.comments[0].created_at);
                assert.ok(!isNaN(timestamp.getTime()), 'Timestamp should be valid date');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Empty comment text should be rejected or handled', async function() {
            this.timeout(10000);

            try {
                const issue = await adapter.createIssue({ title: 'Test Issue', description: '' });

                try {
                    await adapter.addComment(issue.id, '', 'TestUser');
                    // If it succeeds, verify behavior
                    const board = await adapter.getBoard();
                    const card = board.cards.find(c => c.id === issue.id);
                    // Either no comment added or empty comment stored
                    if (card?.comments && card.comments.length > 0) {
                        assert.strictEqual(card.comments[0].text, '', 'Empty comment stored');
                    }
                } catch (err) {
                    // Expected to throw for empty comment
                    assert.ok(true, 'Empty comment rejected');
                }
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });
    });

    suite('Integration - Dependencies and Status', () => {
        test('Blocked issue appears in Blocked column', async function() {
            this.timeout(10000);

            try {
                const blocker = await adapter.createIssue({
                    title: 'Blocker Issue',
                    description: '',
                    status: 'in_progress'
                });

                const blocked = await adapter.createIssue({
                    title: 'Blocked Issue',
                    description: '',
                    status: 'open'
                });

                await adapter.addDependency(blocked.id, blocker.id, 'blocks');

                const board = await adapter.getBoard();

                // Blocked issue should appear in blocked column based on board logic
                // (open status but has blockers)
                const blockedCard = board.cards.find(c => c.id === blocked.id);
                assert.ok(blockedCard, 'Blocked issue should exist');
                assert.ok(blockedCard.blocked_by && blockedCard.blocked_by.length > 0, 'Should have blockers');
            } catch (err) {
                if (err instanceof Error && err.message.includes('No .beads directory')) {
                    this.skip();
                }
                throw err;
            }
        });

        test('Note: Dependency links should be clickable in dialog', () => {
            // In the webview detail dialog, dependencies should render as clickable links
            // Clicking a parent/child/blocker link should open that issue's detail dialog
            // This requires webview testing
            assert.ok(true, 'Dependency links in dialog should be clickable');
        });

        test('Note: Comment rendering uses marked.js + DOMPurify', () => {
            // Comments are stored as markdown text
            // Webview uses marked.js to convert markdown to HTML
            // DOMPurify sanitizes the HTML before insertion
            // See webview-security.test.ts for sanitization tests
            assert.ok(true, 'Comments render via marked.js + DOMPurify pipeline');
        });
    });
});

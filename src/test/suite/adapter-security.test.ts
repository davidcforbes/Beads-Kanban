import * as assert from 'assert';
import * as vscode from 'vscode';
import { BeadsAdapter } from '../../beadsAdapter';

suite('BeadsAdapter Security Tests', () => {
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

    test('SQL Injection: Single quotes in title', async function() {
        this.timeout(10000);
        const maliciousTitle = "Test'; DROP TABLE issues; --";

        try {
            const result = await adapter.createIssue({
                title: maliciousTitle,
                description: ''
            });

            assert.ok(result.id, 'Issue should be created with ID');

            const board = await adapter.getBoard();
            assert.ok((board.cards || []).length > 0, 'Board should have issues');

            const createdIssue = (board.cards || []).find(c => c.id === result.id);
            assert.ok(createdIssue, 'Created issue should exist');
            assert.strictEqual(createdIssue.title, maliciousTitle, 'Title should be stored as-is without SQL execution');
        } catch (err) {
            // If it fails to connect to a beads DB, skip this test
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: UNION SELECT in description', async function() {
        this.timeout(10000);
        const maliciousDesc = "Normal text' UNION SELECT password FROM users--";

        try {
            const result = await adapter.createIssue({
                title: 'Test Issue',
                description: maliciousDesc
            });

            assert.ok(result.id);

            const board = await adapter.getBoard();
            const createdIssue = (board.cards || []).find(c => c.id === result.id);
            assert.ok(createdIssue);
            assert.strictEqual(createdIssue.description, maliciousDesc, 'Description should be stored as-is');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: Malicious label', async function() {
        this.timeout(10000);

        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            const maliciousLabel = "tag' UNION SELECT password FROM users--";

            await adapter.addLabel(issue.id, maliciousLabel);

            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card?.labels.includes(maliciousLabel), 'Label should be stored safely');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: DROP TABLE in comment', async function() {
        this.timeout(10000);

        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            const maliciousComment = "Nice work'; DROP TABLE comments; --";

            await adapter.addComment(issue.id, maliciousComment, 'Attacker');

            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card?.comments && card.comments.length > 0, 'Comment should exist');
            assert.strictEqual(card.comments[0].text, maliciousComment, 'Comment text should be stored safely');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: Null byte injection in assignee', async function() {
        this.timeout(10000);

        try {
            const maliciousAssignee = "user\x00admin";
            const result = await adapter.createIssue({
                title: 'Test',
                description: '',
                assignee: maliciousAssignee
            });

            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === result.id);
            assert.ok(card);
            assert.strictEqual(card.assignee, maliciousAssignee, 'Assignee with null byte should be stored safely');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: Very long string (DoS prevention)', async function() {
        this.timeout(10000);

        try {
            const longString = 'A'.repeat(10000);
            const result = await adapter.createIssue({
                title: 'Test',
                description: longString
            });

            assert.ok(result.id, 'Should handle long strings without crashing');

            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === result.id);
            assert.ok(card);
            assert.strictEqual(card.description.length, 10000, 'Long description should be stored');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: Special characters in external_ref', async function() {
        this.timeout(10000);

        try {
            const issue = await adapter.createIssue({ title: 'Test', description: '' });
            const maliciousRef = "ABC-123'; UPDATE issues SET status='closed'--";

            await adapter.updateIssue(issue.id, { external_ref: maliciousRef });

            const board = await adapter.getBoard();
            const card = (board.cards || []).find(c => c.id === issue.id);
            assert.ok(card);
            assert.strictEqual(card.external_ref, maliciousRef, 'External ref with SQL should be stored safely');
            assert.notStrictEqual(card.status, 'closed', 'Status should not be modified by SQL injection');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });

    test('SQL Injection: Semicolon and multiple statements', async function() {
        this.timeout(10000);

        try {
            const maliciousTitle = "Test; DELETE FROM issues; --";
            const result = await adapter.createIssue({
                title: maliciousTitle,
                description: ''
            });

            assert.ok(result.id);

            const board = await adapter.getBoard();
            assert.ok((board.cards || []).length > 0, 'Issues table should still exist');

            const createdIssue = (board.cards || []).find(c => c.id === result.id);
            assert.ok(createdIssue, 'Created issue should exist');
        } catch (err) {
            if (err instanceof Error && err.message.includes('No .beads directory')) {
                this.skip();
            }
            throw err;
        }
    });
});

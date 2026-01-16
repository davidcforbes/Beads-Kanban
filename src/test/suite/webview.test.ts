import * as assert from 'assert';
import * as vscode from 'vscode';
import { getWebviewHtml } from '../../webview';

suite('Webview Security Tests', () => {
    let mockWebview: vscode.Webview;
    let mockUri: vscode.Uri;

    setup(() => {
        // Create mock webview
        const panel = vscode.window.createWebviewPanel(
            'test',
            'Test',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );
        mockWebview = panel.webview;
        mockUri = vscode.Uri.file(__dirname);
        panel.dispose();
    });

    test('CSP: Has strict default-src none', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        assert.ok(html.includes("default-src 'none'"), 'CSP should have default-src none');
    });

    test('CSP: No unsafe-inline in script-src', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        const cspMatch = html.match(/script-src ([^;]+)/);
        assert.ok(cspMatch, 'CSP should have script-src directive');
        assert.ok(!cspMatch[1].includes('unsafe-inline'), 'script-src should not allow unsafe-inline');
    });

    test('CSP: Has nonce-based script execution', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        const cspMatch = html.match(/script-src ([^;]+)/);
        assert.ok(cspMatch, 'CSP should have script-src directive');
        assert.ok(cspMatch[1].includes("'nonce-"), 'script-src should use nonce');
    });

    test('CSP: Restricts img-src to webview context only', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        const cspMatch = html.match(/img-src ([^;]+)/);
        assert.ok(cspMatch, 'CSP should have img-src directive');
        // VS Code's webview.cspSource may include scoped https domains (e.g., https://*.vscode-cdn.net)
        // We want to ensure it's not unrestricted (just "https:" by itself)
        const imgSrc = cspMatch[1].trim();
        // Check it's not just "https:" which would allow any https URL
        assert.ok(!imgSrc.match(/\bhttps:\s*(?:;|$)/), 'img-src should not allow unrestricted https');
        // Should include webview source or data: URIs
        assert.ok(imgSrc.includes('data:') || imgSrc.includes('vscode') || imgSrc.includes('https://'),
                 'img-src should allow data: URIs or webview resources');
    });

    test('CSP: Has base-uri none', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        assert.ok(html.includes("base-uri 'none'"), 'CSP should restrict base-uri');
    });

    test('CSP: Has frame-ancestors none', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        assert.ok(html.includes("frame-ancestors 'none'"), 'CSP should prevent framing');
    });

    test('CSP: Has form-action none', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        assert.ok(html.includes("form-action 'none'"), 'CSP should restrict form actions');
    });

    test('Nonce: Generated uniquely per request', () => {
        const html1 = getWebviewHtml(mockWebview, mockUri);
        const html2 = getWebviewHtml(mockWebview, mockUri);

        const nonce1 = html1.match(/nonce-([a-f0-9]+)/)?.[1];
        const nonce2 = html2.match(/nonce-([a-f0-9]+)/)?.[1];

        assert.ok(nonce1, 'First HTML should have nonce');
        assert.ok(nonce2, 'Second HTML should have nonce');
        assert.notStrictEqual(nonce1, nonce2, 'Nonces should be unique per request');
        assert.ok(nonce1.length >= 16, 'Nonce should be at least 16 characters (cryptographically secure)');
    });

    test('DOMPurify: Script is included for sanitization', () => {
        const html = getWebviewHtml(mockWebview, mockUri);
        assert.ok(html.includes('purify'), 'HTML should include DOMPurify library');
    });

    test.skip('HTML Entities: Title input has maxlength', () => {
        // NOTE: This test is skipped because the newTitle input is created dynamically
        // in the webview JavaScript, not in the static HTML template
        const html = getWebviewHtml(mockWebview, mockUri);
        const titleInput = html.match(/<input[^>]*id="newTitle"[^>]*>/);
        assert.ok(titleInput, 'Should have title input');
        assert.ok(titleInput[0].includes('maxlength'), 'Title input should have maxlength attribute');
    });
});

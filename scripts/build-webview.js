const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure output directory exists
const outDir = path.join(__dirname, '../out/webview');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Bundle the main webview JavaScript
const buildBoard = esbuild.build({
  entryPoints: [path.join(__dirname, '../src/webview/board.js')],
  bundle: true,
  outfile: path.join(outDir, 'board.js'),
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
  minify: false, // Keep readable for debugging in development
  sourcemap: true,
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  logLevel: 'info'
});

// Bundle the graph layout module
const buildGraphLayout = esbuild.build({
  entryPoints: [path.join(__dirname, '../src/webview/graph-layout.js')],
  bundle: true,
  outfile: path.join(outDir, 'graph-layout.js'),
  platform: 'browser',
  target: ['es2020'],
  format: 'esm',
  minify: false,
  sourcemap: true,
  logLevel: 'info'
});

// Bundle the graph view module
const buildGraphView = esbuild.build({
  entryPoints: [path.join(__dirname, '../src/webview/graph-view.js')],
  bundle: true,
  outfile: path.join(outDir, 'graph-view.js'),
  platform: 'browser',
  target: ['es2020'],
  format: 'esm',
  minify: false,
  sourcemap: true,
  logLevel: 'info'
});

// Wait for all builds to complete
Promise.all([buildBoard, buildGraphLayout, buildGraphView])
  .then(() => {
    console.log('✓ Webview bundles built successfully');
  })
  .catch((error) => {
    console.error('✗ Webview bundle failed:', error);
    process.exit(1);
  });

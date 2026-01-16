const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure output directory exists
const outDir = path.join(__dirname, '../out/webview');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Bundle the webview JavaScript
esbuild.build({
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
}).then(() => {
  console.log('✓ Webview bundle built successfully');
}).catch((error) => {
  console.error('✗ Webview bundle failed:', error);
  process.exit(1);
});

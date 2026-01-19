const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure output directory exists
const outDir = path.join(__dirname, '../out');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Check if watch mode is enabled
const isWatch = process.argv.includes('--watch');

// Bundle the extension host code
const buildOptions = {
  entryPoints: [path.join(__dirname, '../src/extension.ts')],
  bundle: true,
  outfile: path.join(outDir, 'extension.js'),
  platform: 'node',
  target: ['node18'],
  format: 'cjs',
  external: [
    'vscode', // VS Code extension API must be external
    'better-sqlite3', // Native module - must be external
    '@vscode/test-electron',
    '@vscode/test-cli',
    'mocha',
    'chai',
    'sinon'
  ],
  minify: false, // Keep readable for debugging
  sourcemap: true,
  logLevel: 'info',
  treeShaking: true,
  metafile: true
};

if (isWatch) {
  // Watch mode for development
  esbuild.context(buildOptions).then((ctx) => {
    ctx.watch();
    console.log('👀 Watching extension host code for changes...');
  }).catch((error) => {
    console.error('✗ Extension host watch failed:', error);
    process.exit(1);
  });
} else {
  // One-time build
  esbuild.build(buildOptions).then((result) => {
    console.log('✓ Extension host bundle built successfully');

    // Show bundle size info
    if (result.metafile) {
      const outputs = Object.keys(result.metafile.outputs);
      outputs.forEach(output => {
        const size = result.metafile.outputs[output].bytes;
        const sizeKB = (size / 1024).toFixed(1);
        console.log(`  ${path.basename(output)}  ${sizeKB}kb`);
      });
    }
  }).catch((error) => {
    console.error('✗ Extension host bundle failed:', error);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Cross-platform script to copy build dependencies
 * Replaces Unix 'cp' command for Windows compatibility
 */

const fs = require('fs');
const path = require('path');

function copyFile(src, dest) {
  try {
    // Ensure destination directory exists
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    // Copy file
    fs.copyFileSync(src, dest);
    console.log(`Copied: ${src} -> ${dest}`);
  } catch (error) {
    console.error(`Error copying ${src} to ${dest}:`, error.message);
    process.exit(1);
  }
}

// Copy purify.min.js to media/
copyFile(
  path.join(__dirname, '../node_modules/dompurify/dist/purify.min.js'),
  path.join(__dirname, '../media/purify.min.js')
);

console.log('All dependencies copied successfully!');

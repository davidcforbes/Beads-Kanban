#!/usr/bin/env node
/**
 * Bumps the extension version in lockstep across the three places that must
 * stay in sync, and refuses to proceed if CHANGELOG.md isn't ready:
 *
 *   1. package.json "version"
 *   2. src/webview.ts  const version = "..."  (cache-busting query string)
 *   3. CHANGELOG.md must already contain a `## [X.Y.Z]` heading
 *
 * VS Code marketplace requires major.minor.patch with no semver pre-release
 * tags (per https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
 * so we enforce that strictly here.
 *
 * Usage: npm run release:bump -- X.Y.Z
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function fail(msg) {
  process.stderr.write(`\nrelease:bump — ${msg}\n\n`);
  process.exit(1);
}

const newVersion = process.argv[2];
if (!newVersion) {
  fail('missing version argument. Usage: npm run release:bump -- X.Y.Z');
}
if (!SEMVER_RE.test(newVersion)) {
  fail(`"${newVersion}" is not major.minor.patch — VS Code marketplace rejects pre-release tags like 2.1.4-beta.1`);
}

// --- package.json -----------------------------------------------------------
const pkgPath = path.join(PROJECT_ROOT, 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkgVersionMatch = pkgRaw.match(/"version"\s*:\s*"([^"]+)"/);
if (!pkgVersionMatch) {
  fail('could not find a "version" field in package.json');
}
const oldVersion = pkgVersionMatch[1];
if (oldVersion === newVersion) {
  fail(`package.json is already at ${newVersion} — nothing to do`);
}
const pkgUpdated = pkgRaw.replace(
  /("version"\s*:\s*")[^"]+(")/,
  `$1${newVersion}$2`
);

// --- src/webview.ts ---------------------------------------------------------
const webviewPath = path.join(PROJECT_ROOT, 'src', 'webview.ts');
const webviewRaw = fs.readFileSync(webviewPath, 'utf8');
const webviewVersionRe = /(const\s+version\s*=\s*")[^"]+(")/;
if (!webviewVersionRe.test(webviewRaw)) {
  fail('could not find `const version = "..."` in src/webview.ts');
}
const webviewUpdated = webviewRaw.replace(webviewVersionRe, `$1${newVersion}$2`);

// --- CHANGELOG.md (validate only; humans write the entry) -------------------
const changelogPath = path.join(PROJECT_ROOT, 'CHANGELOG.md');
const changelogRaw = fs.readFileSync(changelogPath, 'utf8');
const headingRe = new RegExp(
  `^##\\s*\\[${newVersion.replace(/\./g, '\\.')}\\]`,
  'm'
);
if (!headingRe.test(changelogRaw)) {
  fail(
    `CHANGELOG.md is missing a "## [${newVersion}]" heading.\n` +
    `Add an entry for ${newVersion} at the top of CHANGELOG.md before bumping ` +
    `(it documents what changed and is required by Keep-a-Changelog).`
  );
}

// --- Write all three changes only after every check passes ------------------
fs.writeFileSync(pkgPath, pkgUpdated);
fs.writeFileSync(webviewPath, webviewUpdated);

process.stdout.write(
  `\nrelease:bump — ${oldVersion} → ${newVersion}\n` +
  `  ✓ package.json\n` +
  `  ✓ src/webview.ts\n` +
  `  ✓ CHANGELOG.md heading present\n\n` +
  `Next:  npm run release:package\n\n`
);

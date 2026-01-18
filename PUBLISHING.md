# VS Code Marketplace Publishing Guide

This document provides step-by-step instructions for publishing the Beads Kanban extension to the VS Code Marketplace.

## Current Status

✅ **Completed:**
- All ESLint errors and warnings fixed (152 issues resolved)
- TypeScript compilation successful
- Dialog visibility bug fixed
- Documentation updated (CLAUDE.md, README.md, CHANGELOG.md)
- Version 2.0.5 packaged and tested
- All changes committed and pushed to GitHub

📋 **Next Steps:**
- Complete marketplace publishing prerequisites
- Publish to VS Code Marketplace

## Prerequisites

### 1. Azure DevOps Account

**Create an account:**
1. Go to https://dev.azure.com
2. Sign up with Microsoft account (create one if needed)
3. Create an organization (e.g., "davidcforbes-publisher")

### 2. Personal Access Token (PAT)

**Create a PAT for marketplace publishing:**

1. In Azure DevOps, click your profile icon (top right)
2. Select "Personal access tokens"
3. Click "+ New Token"
4. Configure the token:
   - **Name**: "vsce-marketplace-publish"
   - **Organization**: "All accessible organizations"
   - **Expiration**: Custom (recommend 90 days or 1 year)
   - **Scopes**: Click "Show all scopes" and select:
     - ✅ **Marketplace** > **Manage** (this is the critical one)
5. Click "Create"
6. **IMPORTANT**: Copy and save the token immediately (you won't be able to see it again)

### 3. Publisher Account

**Check if publisher exists:**
```bash
npx @vscode/vsce show davidcforbes
```

If not found, create publisher:
```bash
npx @vscode/vsce create-publisher davidcforbes
```

You'll be prompted for:
- Personal Access Token (paste the PAT from step 2)
- Publisher display name (e.g., "David Forbes")
- Description (optional)

**Verify publisher:**
```bash
npx @vscode/vsce login davidcforbes
# Enter your PAT when prompted
```

## Package.json Verification

Current package.json is ready for marketplace:

✅ `version`: "2.0.5" (semantic versioning)
✅ `publisher`: "davidcforbes"
✅ `displayName`: "Beads Kanban"
✅ `description`: Clear and concise
✅ `icon`: "images/icon.png" (128x128 PNG)
✅ `repository`: GitHub URL
✅ `license`: "MIT"
✅ `engines.vscode`: "^1.90.0"
✅ `categories`: ["Other", "Visualization"]
✅ `keywords`: Relevant search terms

## Publishing Steps

### Option 1: First-time Publishing (Recommended)

```powershell
# 1. Verify everything is committed and pushed
git status

# 2. Run tests
npm test

# 3. Run ESLint
npm run lint

# 4. Compile the extension
npm run compile

# 5. Package the extension (verify VSIX is created)
npx @vscode/vsce package

# 6. Verify the package contents
npx @vscode/vsce ls

# 7. Test the VSIX locally
# Install in VS Code: Extensions > ... > Install from VSIX
# Test all functionality

# 8. Publish to marketplace
npx @vscode/vsce publish
# Enter your PAT when prompted
```

### Option 2: Publish with Version Bump

```powershell
# Automatically bump version and publish in one command
npx @vscode/vsce publish patch  # 2.0.5 -> 2.0.6
# or
npx @vscode/vsce publish minor  # 2.0.5 -> 2.1.0
# or
npx @vscode/vsce publish major  # 2.0.5 -> 3.0.0
```

**Note**: When using auto-bump, remember to also update the version in `src/webview.ts` manually afterward.

## Post-Publishing Checklist

After successful publishing:

1. **Verify marketplace listing:**
   - Go to https://marketplace.visualstudio.com/items?itemName=davidcforbes.beads-kanban
   - Check that screenshots, description, and metadata are correct
   - Verify installation works from marketplace

2. **Create GitHub release:**
   ```bash
   git tag v2.0.5
   git push origin v2.0.5
   ```
   - Go to GitHub Releases: https://github.com/davidcforbes/beads-kanban/releases
   - Click "Create a new release"
   - Select tag: v2.0.5
   - Release title: "v2.0.5 - ESLint Compliance and Bug Fixes"
   - Description: Copy from CHANGELOG.md
   - Attach the VSIX file as a binary

3. **Update version for next development:**
   - Keep version at 2.0.5 until next release
   - Or bump to 2.0.6-dev in package.json to indicate development version

4. **Monitor for issues:**
   - Watch GitHub issues: https://github.com/davidcforbes/beads-kanban/issues
   - Check marketplace reviews and Q&A
   - Monitor for crash reports

## Version Management

**CRITICAL**: Always update version in TWO places:

1. **package.json** - `"version": "X.Y.Z"`
2. **src/webview.ts** - `const version = "X.Y.Z";`

These must match for proper webview cache invalidation.

**Workflow:**
```bash
# Method 1: Manual version bump
# 1. Edit package.json version
# 2. Edit src/webview.ts version
# 3. Run npm run compile
# 4. Commit changes

# Method 2: Using npm version (recommended)
npm version patch  # or minor, major
# This updates package.json and creates a git tag
# Then manually update src/webview.ts
npm run compile
git add src/webview.ts out/webview.js
git commit --amend --no-edit
```

## Troubleshooting

### "Publisher not found"

**Problem**: Publisher account doesn't exist yet.

**Solution**:
```bash
npx @vscode/vsce create-publisher davidcforbes
```

### "Personal Access Token is invalid"

**Problem**: PAT expired or has wrong scopes.

**Solution**:
1. Create new PAT with "Marketplace > Manage" scope
2. Login again: `npx @vscode/vsce login davidcforbes`

### "Package contains too many files"

**Problem**: .vscodeignore not filtering correctly.

**Solution**:
- Check `.vscodeignore` file
- Ensure node_modules, src, and test files are excluded
- Run `npx @vscode/vsce ls` to see what will be included

### "Icon not found"

**Problem**: Icon path in package.json is incorrect.

**Solution**:
- Verify `images/icon.png` exists
- Icon must be 128x128 PNG
- Check file permissions

## Marketplace Best Practices

### Update Frequency

- **Patch releases** (bug fixes): As needed
- **Minor releases** (features): Every 2-4 weeks
- **Major releases** (breaking changes): Quarterly or less

### Versioning Strategy

Follow semantic versioning:
- **Patch** (2.0.X): Bug fixes, documentation
- **Minor** (2.X.0): New features, backward compatible
- **Major** (X.0.0): Breaking changes, architecture changes

### Marketplace Optimization

1. **Screenshots**: Update regularly to show new features
2. **Description**: Keep first 200 chars compelling (appears in search)
3. **Keywords**: Use relevant terms users search for
4. **Changelog**: Keep CHANGELOG.md up to date
5. **README**: Add GIFs/videos for complex features
6. **Reviews**: Respond to reviews and address feedback

## Support and Maintenance

### GitHub Issues

- Label issues appropriately (bug, enhancement, documentation)
- Use GitHub issue templates
- Link issues to marketplace reviews when relevant
- Close issues when resolved and reference in CHANGELOG

### User Questions

- Monitor GitHub Discussions
- Respond to marketplace Q&A
- Update README.md FAQ section based on common questions

### Deprecations

When deprecating features:
1. Mark as deprecated in code and documentation
2. Update CHANGELOG.md
3. Wait at least one minor version before removal
4. Provide migration path in documentation

## Resources

- **Publishing Guide**: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- **Marketplace**: https://marketplace.visualstudio.com/manage/publishers/davidcforbes
- **vsce Documentation**: https://github.com/microsoft/vscode-vsce
- **Extension API**: https://code.visualstudio.com/api

## Quick Reference

```bash
# Check if publisher exists
npx @vscode/vsce show davidcforbes

# Login to publisher account
npx @vscode/vsce login davidcforbes

# Package extension
npx @vscode/vsce package

# List package contents
npx @vscode/vsce ls

# Publish extension
npx @vscode/vsce publish

# Publish with version bump
npx @vscode/vsce publish patch|minor|major

# Unpublish extension (use with caution!)
npx @vscode/vsce unpublish davidcforbes.beads-kanban
```

---

**Next Action**: Follow the "Publishing Steps" section above to publish version 2.0.5 to the VS Code Marketplace.

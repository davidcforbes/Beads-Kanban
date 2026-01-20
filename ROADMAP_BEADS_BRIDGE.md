# Beads Bridge: Chrome Extension Native Messaging Roadmap

## Executive Summary

This document proposes building a Chrome Extension + Native Host bridge to enable **full read/write functionality** for the Beads Kanban extension in VS Code for the Web (vscode.dev).

**Key Points:**
- ✅ Enables full functionality in vscode.dev on Chrome/Edge browsers
- ✅ Works with existing bd CLI/daemon (no beads core changes)
- ✅ Reasonable setup for developer users
- ⚠️ Chrome/Edge only (Firefox/Safari users get read-only fallback)
- 📅 ~2 weeks development effort

---

## Problem Statement

### Current Limitations

The Beads Kanban VS Code extension cannot run in VS Code for the Web (vscode.dev) because:

1. **Browser Security Sandbox**: Cannot execute shell commands or spawn processes
2. **No bd CLI Access**: The extension relies on `child_process.spawn('bd', ...)` which doesn't exist in browser WebWorker environment
3. **No Terminal**: VS Code for the Web has no integrated terminal for local command execution

### Impact

Users who want to use vscode.dev (for lightweight editing, GitHub repos, or remote work) cannot:
- ❌ Create or edit issues
- ❌ Move cards between columns
- ❌ Add comments or labels
- ❌ Manage dependencies
- ❌ Access daemon features

Current options:
- **Desktop only**: Full functionality but requires VS Code Desktop
- **Read-only web mode**: Can view boards using sql.js but no editing

---

## Proposed Solution: Chrome Extension Bridge

Build a three-component bridge that connects vscode.dev to the local bd CLI:

```
┌─────────────────────────────────────────────────────────┐
│  vscode.dev (Browser Tab)                               │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Beads Kanban Extension (Web)                     │  │
│  │  - Detects Chrome Bridge availability            │  │
│  │  - Falls back to read-only if unavailable        │  │
│  └──────────────┬────────────────────────────────────┘  │
└─────────────────┼──────────────────────────────────────┘
                  │ chrome.runtime.sendMessage()
┌─────────────────▼──────────────────────────────────────┐
│  Chrome Extension: "Beads Bridge"                      │
│  - Installed from Chrome Web Store                     │
│  - Uses externally_connectable for vscode.dev         │
│  - Forwards commands to Native Host                    │
└─────────────────┬──────────────────────────────────────┘
                  │ Native Messaging (stdin/stdout)
         ┌────────▼─────────┐
         │  Native Host     │ (Small executable)
         │  beads-bridge    │ - Python/Go/Rust script
         │                  │ - Windows: .exe
         │                  │ - Mac/Linux: binary
         └────────┬─────────┘
                  │ subprocess.run(['bd', ...])
         ┌────────▼─────────┐
         │  bd CLI/daemon   │ (Already installed by user)
         │  .beads/*.db     │
         └──────────────────┘
```

### Why This Works

1. **Target users already have bd CLI** - They're beads users who installed bd
2. **One-time setup** - Install extension + native host once, works forever
3. **No beads core changes** - Uses existing bd CLI commands
4. **Graceful fallback** - Users without bridge get read-only mode
5. **Chrome/Edge = 70%+ of developers** - Good market coverage

---

## Architecture Details

### Component 1: Native Host Application

**Language**: Python (cross-platform, minimal dependencies)

**Responsibilities:**
- Listen for messages from Chrome extension via stdin
- Execute bd CLI commands with provided arguments
- Return JSON results via stdout
- Handle errors and timeouts

**File**: `beads-bridge` (or `beads-bridge.exe` on Windows)

**Key Features:**
- Native Messaging protocol (4-byte length prefix + JSON)
- Timeout handling (30 seconds per command)
- Error reporting (bd not found, command failed, etc.)
- No network access (security)

**Installation Locations:**
- **Windows**: `%LOCALAPPDATA%\beads\bridge\beads-bridge.exe`
- **macOS**: `~/Library/Application Support/beads/bridge/beads-bridge`
- **Linux**: `~/.config/beads/bridge/beads-bridge`

**Manifest Location:**
- **Windows**: `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.beads.bridge` (registry)
- **macOS**: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.beads.bridge.json`
- **Linux**: `~/.config/google-chrome/NativeMessagingHosts/com.beads.bridge.json`

### Component 2: Chrome Extension

**Manifest Version**: 3 (latest)

**Permissions:**
- `nativeMessaging` - Required to communicate with native host
- `externally_connectable` - Allows vscode.dev to send messages

**Responsibilities:**
- Connect to native host on startup
- Receive messages from vscode.dev via `chrome.runtime.sendMessage()`
- Forward commands to native host
- Return results to vscode.dev
- Handle connection failures gracefully

**Distribution**: Chrome Web Store

**Extension ID**: Auto-generated by Chrome Web Store (e.g., `abcdefghijklmnop`)

### Component 3: VS Code Extension Adapter

**New File**: `src/chromeBridgeAdapter.ts`

**Responsibilities:**
- Detect if Chrome Bridge extension is installed
- Send bd CLI commands via `chrome.runtime.sendMessage(EXTENSION_ID, ...)`
- Parse responses and map to TypeScript types
- Implement same interface as `DaemonBeadsAdapter`

**Fallback Strategy**: If bridge unavailable, use `WebBeadsAdapter` (read-only sql.js)

---

## Implementation Plan

### Phase 1: Core Components (Week 1)

#### 1.1 Native Host Application (2 days)

**Deliverables:**
- `beads-bridge.py` - Python script implementing Native Messaging protocol
- `com.beads.bridge.json` - Native Messaging manifest template
- Unit tests for message parsing and bd CLI execution

**Code Structure:**
```python
# beads-bridge.py
def send_message(message):
    # Encode JSON with 4-byte length prefix
    pass

def read_message():
    # Read 4-byte length + JSON from stdin
    pass

def execute_bd(args):
    # Run: bd {args}
    # Return: { success: bool, data: any, error: string }
    pass

def main():
    # Message loop
    while True:
        msg = read_message()
        if msg['type'] == 'bd_command':
            result = execute_bd(msg['args'])
            send_message({ type: 'bd_result', id: msg['id'], result })
```

#### 1.2 Chrome Extension (2 days)

**Deliverables:**
- `manifest.json` - Extension manifest with permissions
- `background.js` - Service worker for Native Messaging
- Icons (16x16, 48x48, 128x128)

**Code Structure:**
```javascript
// background.js
let nativePort = chrome.runtime.connectNative('com.beads.bridge');

nativePort.onMessage.addListener((message) => {
  // Forward to pending request handlers
});

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.type === 'bd_command') {
    // Forward to native host
    // Wait for response
    // Send back to vscode.dev
  }
});
```

#### 1.3 VS Code Adapter (2 days)

**Deliverables:**
- `src/chromeBridgeAdapter.ts` - Adapter implementation
- Updated `src/adapterFactory.ts` - Auto-detect and fallback logic
- TypeScript types for Chrome messaging

**Code Structure:**
```typescript
export class ChromeBridgeAdapter implements BeadsAdapter {
  private async sendMessageToExtension(msg: any): Promise<any> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(EXTENSION_ID, msg, (response) => {
        if (chrome.runtime.lastError) reject(...);
        resolve(response);
      });
    });
  }

  private async execBd(args: string[]): Promise<any> {
    return this.sendMessageToExtension({
      type: 'bd_command',
      args: args
    });
  }

  async loadBoard(): Promise<BoardData> {
    const issues = await this.execBd(['list', '--json']);
    return this.mapToBoardData(issues);
  }

  // Implement full BeadsAdapter interface
}
```

### Phase 2: Installation & Distribution (Week 2)

#### 2.1 Installer Scripts (3 days)

**Platform-specific installers:**

**Windows** (`install-windows.ps1`):
```powershell
# 1. Download beads-bridge.exe
# 2. Copy to %LOCALAPPDATA%\beads\bridge\
# 3. Create registry entry for manifest
# 4. Verify installation
```

**macOS/Linux** (`install.sh`):
```bash
# 1. Download beads-bridge binary
# 2. Make executable, copy to ~/Library/.../beads/bridge/
# 3. Create manifest in NativeMessagingHosts/
# 4. Verify installation
```

**npm package** (`beads-bridge` on npm):
```bash
npm install -g beads-bridge
beads-bridge install  # Runs appropriate installer
beads-bridge verify   # Test connection
```

#### 2.2 Chrome Web Store Submission (2 days)

**Requirements:**
- Chrome Developer account ($5 one-time fee)
- Privacy policy (if collecting data - we don't)
- Detailed description and screenshots
- Store listing graphics

**Approval time**: Usually 1-2 weeks

#### 2.3 Documentation (2 days)

**User Documentation:**
- `docs/CHROME_BRIDGE_SETUP.md` - Installation guide with screenshots
- `README.md` updates - Add Chrome Bridge section
- FAQ - Common issues and troubleshooting

**Developer Documentation:**
- `CONTRIBUTING.md` - How to test Chrome Bridge locally
- Architecture diagrams
- Message protocol specification

### Phase 3: Testing & Polish (Concurrent with Phase 2)

#### 3.1 Testing (3 days)

**Test Scenarios:**
- Extension + native host installation on Windows/Mac/Linux
- vscode.dev connectivity
- All bd CLI commands (create, update, delete, etc.)
- Error handling (bd not found, timeout, disconnect)
- Fallback to read-only mode
- Multiple vscode.dev tabs

**Test Matrix:**
| OS | Browser | bd CLI | Expected Result |
|----|---------|--------|-----------------|
| Windows 11 | Chrome | Installed | ✅ Full functionality |
| Windows 11 | Edge | Installed | ✅ Full functionality |
| macOS | Chrome | Installed | ✅ Full functionality |
| Linux | Chrome | Installed | ✅ Full functionality |
| Any | Firefox | Installed | ⚠️ Read-only fallback |
| Windows | Chrome | Not installed | ❌ Native host error |

#### 3.2 Performance Testing

**Metrics to measure:**
- Message round-trip time (vscode.dev → extension → native → bd → back)
- Large board loading (1000+ issues)
- Multiple rapid updates
- Memory usage

**Target performance:**
- < 100ms for simple commands (list, show)
- < 500ms for mutations (create, update)
- No memory leaks over extended use

---

## User Installation Experience

### For End Users (Developer Users of Beads)

**Step 1: Install Chrome Extension** (1 minute)
```
1. Visit Chrome Web Store
2. Search "Beads Bridge"
3. Click "Add to Chrome"
4. Extension icon appears in toolbar
```

**Step 2: Install Native Host** (2 minutes)

**Option A - npm (recommended):**
```bash
npm install -g beads-bridge
beads-bridge install
```

**Option B - Installer script:**
```bash
# macOS/Linux
curl -sSL https://beads.dev/install-bridge.sh | bash

# Windows (PowerShell)
iwr https://beads.dev/install-bridge.ps1 | iex
```

**Option C - Manual:**
```
1. Download beads-bridge for your platform
2. Run: beads-bridge install
3. Follow prompts
```

**Step 3: Verify Installation** (1 minute)
```bash
beads-bridge verify
# Output: ✅ Beads Bridge installed correctly
#         ✅ bd CLI found in PATH
#         ✅ Chrome extension connected
```

**Step 4: Use in vscode.dev** (instant)
```
1. Open https://vscode.dev
2. Open folder with .beads/
3. Open Beads Kanban board
4. See status: "✅ Beads Bridge (Full Functionality)"
5. Create/edit issues normally!
```

### Troubleshooting Guide

**Common Issues:**

1. **"Chrome extension not found"**
   - Solution: Install extension from Chrome Web Store

2. **"Native host not responding"**
   - Solution: Run `beads-bridge install` again
   - Check: `beads-bridge verify`

3. **"bd CLI not found"**
   - Solution: Install bd CLI first
   - Verify: `which bd` or `where bd`

4. **"Permission denied"**
   - Solution: Run installer with appropriate permissions
   - macOS: May need to allow in System Preferences > Security

---

## Development Effort Estimate

| Task | Time | Complexity |
|------|------|------------|
| **Native Host (Python)** | 2 days | Low |
| - Message protocol implementation | 4 hours | Low |
| - bd CLI execution | 2 hours | Low |
| - Error handling | 2 hours | Low |
| - Testing | 8 hours | Medium |
| **Chrome Extension** | 2 days | Medium |
| - Manifest & background worker | 4 hours | Low |
| - Native Messaging integration | 4 hours | Medium |
| - Message routing | 4 hours | Medium |
| - Testing | 4 hours | Medium |
| **VS Code Adapter** | 2 days | Low |
| - ChromeBridgeAdapter implementation | 6 hours | Low |
| - Factory pattern updates | 2 hours | Low |
| - Testing | 8 hours | Medium |
| **Installers** | 3 days | Medium |
| - Cross-platform install scripts | 1 day | Medium |
| - npm package | 1 day | Low |
| - Testing on all platforms | 1 day | High |
| **Documentation** | 2 days | Low |
| - User setup guide | 1 day | Low |
| - Developer docs | 1 day | Low |
| **Chrome Web Store** | 2 days | Low |
| - Store listing | 4 hours | Low |
| - Screenshots/graphics | 4 hours | Low |
| - Submission & review wait | 1-2 weeks | N/A |
| **Testing & QA** | 3 days | Medium |
| - Integration testing | 1 day | Medium |
| - Cross-platform testing | 1 day | High |
| - Bug fixes | 1 day | Medium |
| **TOTAL DEVELOPMENT** | **~2 weeks** | **Medium** |

**Note:** Chrome Web Store approval adds 1-2 weeks of wait time but doesn't require active work.

---

## Comparison with Alternative Solutions

### Option 1: Chrome Bridge (This Proposal)

**Pros:**
- ✅ Full read/write functionality in vscode.dev
- ✅ Works with existing bd CLI (no beads core changes)
- ✅ One-time setup, then seamless
- ✅ Reasonable for developer audience
- ✅ Can implement in 2 weeks

**Cons:**
- ⚠️ Chrome/Edge only (70% of developers)
- ⚠️ Three components to maintain
- ⚠️ Web Store approval process
- ⚠️ Some users may struggle with native host setup

**Verdict:** **Recommended for immediate full functionality**

### Option 2: HTTP Daemon API

Add HTTP API to beads daemon:

**Pros:**
- ✅ Browser-agnostic (works in all browsers)
- ✅ Full functionality
- ✅ WebSocket support for real-time updates
- ✅ Simpler for users (no Chrome extension)

**Cons:**
- ⚠️ Requires modifying beads core (Rust/Go code)
- ⚠️ CORS and security complexity
- ⚠️ Need authentication mechanism
- ⚠️ Longer development time (4-6 weeks)
- ⚠️ Requires upstream contribution to beads

**Verdict:** **Better long-term solution, but requires beads core changes**

### Option 3: Read-Only sql.js

Load .beads/*.db in browser using sql.js WebAssembly:

**Pros:**
- ✅ Works everywhere (all browsers, no setup)
- ✅ Works with GitHub repos
- ✅ Simple implementation
- ✅ Already planned as fallback

**Cons:**
- ❌ Read-only (no create/edit/delete)
- ⚠️ Performance issues with large databases (100+ MB)
- ⚠️ Full database loaded into memory

**Verdict:** **Good fallback, but insufficient for full functionality**

### Option 4: absurd-sql (Page-based SQLite)

Use absurd-sql for efficient partial loading:

**Pros:**
- ✅ Handles large databases efficiently
- ✅ Works everywhere
- ✅ Can persist to IndexedDB

**Cons:**
- ❌ Still read-only (no write back to .beads)
- ⚠️ Complex setup
- ⚠️ Changes don't sync to bd daemon

**Verdict:** **Good for read-only performance, but doesn't solve write problem**

### Feature Comparison Matrix

| Feature | Chrome Bridge | HTTP Daemon | sql.js | absurd-sql |
|---------|--------------|-------------|---------|------------|
| **Create issues** | ✅ | ✅ | ❌ | ❌ |
| **Edit issues** | ✅ | ✅ | ❌ | ❌ |
| **Delete issues** | ✅ | ✅ | ❌ | ❌ |
| **Drag & drop** | ✅ | ✅ | ❌ | ❌ |
| **Real-time sync** | ⚠️ (polling) | ✅ (WebSocket) | ❌ | ❌ |
| **Browser support** | Chrome/Edge | All | All | All |
| **Setup required** | Yes (one-time) | No (if daemon has API) | No | No |
| **Large databases** | ✅ | ✅ | ⚠️ Slow | ✅ |
| **GitHub repos** | ❌ | ❌ | ✅ | ✅ |
| **Local projects** | ✅ | ✅ | ⚠️ Chrome only | ⚠️ Chrome only |
| **Dev effort** | 2 weeks | 4-6 weeks | 1 week | 2 weeks |
| **Beads changes** | None | Significant | None | None |

---

## Risks & Mitigations

### Risk 1: Chrome Web Store Rejection

**Likelihood**: Low
**Impact**: High

**Reasons for rejection:**
- Security concerns with Native Messaging
- Insufficient documentation
- Misleading store listing

**Mitigation:**
- Clear privacy policy (no data collection)
- Detailed description of why Native Messaging is needed
- Screenshots showing legitimate use case
- Open source code (transparency)

### Risk 2: Native Host Installation Issues

**Likelihood**: Medium
**Impact**: Medium

**Potential issues:**
- Path issues (bd not in PATH)
- Permission problems
- Antivirus blocking
- Incorrect manifest location

**Mitigation:**
- Comprehensive installer that handles all platforms
- Clear error messages with solutions
- `beads-bridge verify` command to diagnose issues
- Detailed troubleshooting guide
- Fallback to read-only mode if installation fails

### Risk 3: Browser Compatibility Changes

**Likelihood**: Low
**Impact**: Medium

**Potential issues:**
- Chrome changes Native Messaging API
- Manifest V3 updates
- vscode.dev changes messaging

**Mitigation:**
- Use stable Chrome APIs
- Monitor Chrome release notes
- Maintain compatibility with Manifest V3
- Regular testing with Chrome Canary

### Risk 4: User Support Burden

**Likelihood**: Medium
**Impact**: Medium

**Potential issues:**
- Users struggle with installation
- Platform-specific bugs
- bd CLI version incompatibilities

**Mitigation:**
- Automated installation via npm
- Extensive documentation with screenshots
- Community support via GitHub Discussions
- FAQ covering common issues
- Telemetry for error diagnostics (opt-in)

### Risk 5: Maintenance Overhead

**Likelihood**: Medium
**Impact**: Medium

**Concerns:**
- Three codebases to maintain
- Platform-specific bugs
- Chrome extension updates
- Native host updates

**Mitigation:**
- Simple, minimal codebases
- Comprehensive test suite
- CI/CD for all platforms
- Clear contribution guidelines
- Version compatibility matrix

---

## Success Metrics

### Adoption Metrics

- **Chrome Extension Installs**: Target 100+ in first month
- **Active Users**: 50+ weekly active users
- **Installation Success Rate**: > 90% complete setup successfully
- **User Satisfaction**: > 4.0 stars on Chrome Web Store

### Technical Metrics

- **Command Latency**: < 100ms average for bd CLI commands
- **Reliability**: > 99% success rate for commands
- **Error Rate**: < 1% of commands fail
- **Platform Coverage**: Works on Windows, macOS, Linux

### User Experience Metrics

- **Time to Setup**: < 5 minutes for average user
- **Documentation Clarity**: < 10% of users need support
- **Fallback Rate**: < 30% users fall back to read-only mode

---

## Roadmap

### Version 2.1 - Chrome Bridge (Q1 2026)

**Focus**: Full functionality in vscode.dev for Chrome/Edge users

**Features:**
- ✅ Chrome Extension with Native Messaging
- ✅ Native Host for Windows/Mac/Linux
- ✅ ChromeBridgeAdapter in VS Code extension
- ✅ Automated installers
- ✅ Comprehensive documentation
- ✅ Read-only fallback for non-Chrome browsers

**Timeline**: 2 weeks development + 1-2 weeks Chrome Web Store approval

### Version 2.2 - Enhanced Web Support (Q2 2026)

**Focus**: Improve fallback experience and browser compatibility

**Features:**
- ✅ absurd-sql for efficient large database loading
- ✅ Better offline support with IndexedDB caching
- ✅ Virtual scrolling for large boards
- ✅ Progressive loading and skeleton states

**Timeline**: 2-3 weeks

### Version 2.3 - HTTP Daemon API (Q3 2026)

**Focus**: Browser-agnostic solution (if beads core adds HTTP API)

**Features:**
- ✅ HttpDaemonAdapter (browser-agnostic)
- ✅ WebSocket for real-time updates
- ✅ Works in Firefox, Safari, etc.
- ✅ Keep Chrome Bridge as fallback option

**Prerequisites**: Beads core implements HTTP API
**Timeline**: 1 week (assuming beads API exists)

### Future Enhancements

**Potential additions:**
- Firefox/Safari extensions (if browser support improves)
- Desktop PWA version using File System Access API
- Collaboration features (if HTTP API available)
- Cloud sync option (optional backend service)

---

## Decision Points

### Critical Questions to Answer

1. **Is Chrome/Edge-only acceptable?**
   - 70% of developers use Chrome/Edge
   - Firefox/Safari users get read-only fallback
   - Alternative: Wait for HTTP daemon API (longer timeline)

2. **Is three-component setup acceptable for users?**
   - Developer audience is comfortable with tooling
   - One-time setup, then seamless
   - Can provide npm installer for simplicity
   - Alternative: Wait for simpler solution (less functionality)

3. **Who maintains the Chrome extension?**
   - Option A: Official beads project (preferred)
   - Option B: Community-maintained
   - Option C: Third-party (this project)

4. **What's the fallback strategy?**
   - Keep read-only sql.js for non-Chrome browsers
   - Show clear messaging about limitations
   - Provide link to Chrome Bridge setup

5. **Should we wait for HTTP daemon API instead?**
   - Pros: Better long-term solution, all browsers
   - Cons: Requires beads core changes, longer timeline
   - Recommendation: Build Chrome Bridge now, add HTTP later

### Recommended Approach

**Phase 1** (Now):
- ✅ Build Chrome Bridge for immediate functionality
- ✅ Document limitations clearly
- ✅ Provide excellent read-only fallback

**Phase 2** (Later):
- ✅ Advocate for HTTP API in beads core
- ✅ If HTTP API added, implement HttpDaemonAdapter
- ✅ Keep Chrome Bridge as alternative method

**Rationale:**
- Immediate value for majority of users
- No dependency on upstream changes
- Proven technology (Native Messaging)
- Can iterate based on user feedback

---

## Next Steps

### If Approved

1. **Create feature branch**: `feature/chrome-bridge`
2. **Start with Native Host**: Simplest component, easiest to test
3. **Build Chrome Extension**: Submit to Web Store ASAP (approval takes time)
4. **Implement VS Code Adapter**: While waiting for Web Store approval
5. **Create Installers**: npm package + platform scripts
6. **Documentation**: Setup guides with screenshots
7. **Beta Testing**: Small group of users
8. **Public Release**: After Web Store approval

### If Deferred

1. **Focus on read-only mode**: Implement absurd-sql for better performance
2. **Document limitations**: Make clear what works and what doesn't
3. **Monitor beads development**: Watch for HTTP API implementation
4. **Revisit decision**: Quarterly review of options

### If Rejected

1. **Implement read-only mode only**: sql.js or absurd-sql
2. **Recommend Desktop**: Clear messaging to use VS Code Desktop for full functionality
3. **Consider alternatives**: Explore other extension architectures

---

## Appendices

### Appendix A: Chrome Native Messaging Documentation

Official Chrome documentation:
- [Native Messaging](https://developer.chrome.com/docs/extensions/mv3/nativeMessaging/)
- [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [externally_connectable](https://developer.chrome.com/docs/extensions/mv3/manifest/externally_connectable/)

### Appendix B: Similar Extensions

Examples of extensions using Native Messaging:
- **1Password**: Browser extension + native app for password management
- **KeePassXC-Browser**: Browser extension + native KeePass database
- **Grammarly**: Browser extension + native language processing
- **Browserpass**: Browser extension + pass CLI integration

### Appendix C: Security Considerations

**Attack Vectors:**
1. Malicious website impersonating vscode.dev
   - Mitigation: `externally_connectable` whitelist

2. Man-in-the-middle on Native Messaging
   - Mitigation: Local-only communication (no network)

3. bd CLI command injection
   - Mitigation: Proper argument escaping, no shell=True

4. Unauthorized extension access
   - Mitigation: Extension ID verification

**Best Practices:**
- Never execute arbitrary commands
- Validate all inputs
- Use subprocess.run() not os.system()
- Log all commands for debugging
- Implement rate limiting

### Appendix D: Platform-Specific Notes

**Windows:**
- Installer must add registry entry for manifest
- May trigger antivirus warnings (code signing helps)
- PowerShell execution policy may block scripts

**macOS:**
- Gatekeeper may block unsigned binaries
- Users may need to allow in System Preferences
- Notarization recommended for smooth experience

**Linux:**
- Distribution-specific paths (.config vs .local)
- Snap/Flatpak Chrome has different manifest locations
- AppArmor/SELinux may need configuration

---

## Document Status

**Status**: Proposal
**Version**: 1.0
**Date**: 2026-01-19
**Author**: Claude (with human review)
**Reviewers**: [To be determined]
**Decision Deadline**: [To be determined]

## Change Log

- 2026-01-19: Initial proposal created
- [Future changes to be logged here]

---

**END OF DOCUMENT**

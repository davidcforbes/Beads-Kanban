#!/usr/bin/env bash
#
# Visual Test Launcher for Beads Kanban
#
# A lightweight alternative to visual-test-harness.js that launches the
# user's installed VS Code with remote debugging enabled. No download step,
# no test runner injection -- just opens VS Code with the debug port so
# Chrome DevTools MCP can connect.
#
# Usage:
#   ./scripts/visual-test-launch.sh [workspace-path] [port]
#
# Arguments:
#   workspace-path   Folder to open in VS Code (default: current directory)
#   port             Chrome DevTools Protocol port (default: 9222)
#
# After launch:
#   1. Open the Kanban board:  Ctrl+Shift+P -> "Beads: Open Kanban Board"
#   2. Connect Chrome DevTools MCP to http://localhost:<port>
#
# Works on Linux, macOS, and Windows (Git Bash / MSYS2 / WSL).

set -euo pipefail

WORKSPACE="${1:-.}"
DEBUG_PORT="${2:-9222}"

# Resolve workspace to absolute path
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Git Bash / MSYS on Windows
    WORKSPACE="$(cd "$WORKSPACE" 2>/dev/null && pwd -W)" || WORKSPACE="$1"
else
    WORKSPACE="$(cd "$WORKSPACE" 2>/dev/null && pwd)" || WORKSPACE="$1"
fi

echo "======================================================================="
echo "  Beads Kanban - Visual Test Launcher"
echo "======================================================================="
echo ""
echo "  Workspace:  $WORKSPACE"
echo "  Debug Port: $DEBUG_PORT"
echo ""

# Check if the port is already in use
if command -v curl &>/dev/null; then
    if curl -s "http://localhost:$DEBUG_PORT/json/version" >/dev/null 2>&1; then
        echo "WARNING: Port $DEBUG_PORT is already in use."
        echo "         Another debuggable instance may already be running."
        echo ""
        echo "  Current version info:"
        curl -s "http://localhost:$DEBUG_PORT/json/version" 2>/dev/null | head -5
        echo ""
        echo "  Continue anyway? (Ctrl+C to abort, Enter to continue)"
        read -r
    fi
fi

# Launch VS Code with remote debugging enabled
echo "Launching VS Code with --remote-debugging-port=$DEBUG_PORT ..."
code --remote-debugging-port="$DEBUG_PORT" "$WORKSPACE" &
CODE_PID=$!

echo "  VS Code launched (PID: $CODE_PID)"
echo ""

# Wait for the debug port to become available
echo "Waiting for debug port $DEBUG_PORT ..."

MAX_WAIT=30
WAITED=0

while [ $WAITED -lt $MAX_WAIT ]; do
    if command -v curl &>/dev/null; then
        if curl -s "http://localhost:$DEBUG_PORT/json/version" >/dev/null 2>&1; then
            break
        fi
    elif command -v wget &>/dev/null; then
        if wget -q -O /dev/null "http://localhost:$DEBUG_PORT/json/version" 2>/dev/null; then
            break
        fi
    else
        # No curl or wget, just wait a fixed time
        sleep 5
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
done

if [ $WAITED -ge $MAX_WAIT ]; then
    echo ""
    echo "ERROR: Debug port $DEBUG_PORT did not become available within ${MAX_WAIT}s."
    echo ""
    echo "Possible causes:"
    echo "  - VS Code is already running (close all instances and retry)"
    echo "  - The 'code' command is not on PATH"
    echo "  - A firewall is blocking the port"
    echo ""
    echo "Tip: If VS Code is already open, close it first. The debug port flag"
    echo "     only works when launching a new VS Code window from scratch."
    exit 1
fi

echo "  Debug port is ready."
echo ""

# List available targets
if command -v curl &>/dev/null; then
    echo "  CDP Targets:"
    curl -s "http://localhost:$DEBUG_PORT/json" 2>/dev/null | \
        grep -oP '"title"\s*:\s*"\K[^"]+' | \
        while IFS= read -r title; do
            echo "    - $title"
        done 2>/dev/null || echo "    (could not parse targets)"
    echo ""
fi

echo "======================================================================="
echo "  Visual Test Launcher Ready"
echo ""
echo "  Chrome DevTools Protocol: http://localhost:$DEBUG_PORT"
echo ""
echo "  Next steps:"
echo "    1. In VS Code: Ctrl+Shift+P -> 'Beads: Open Kanban Board'"
echo "    2. Connect Chrome DevTools MCP:"
echo ""
echo "       npx @anthropic-ai/chrome-devtools-mcp@latest --port=$DEBUG_PORT"
echo ""
echo "       Or add to Claude Code:"
echo "       claude mcp add chrome-devtools -- npx @anthropic-ai/chrome-devtools-mcp@latest --port=$DEBUG_PORT"
echo ""
echo "  Browse all targets:"
echo "    curl http://localhost:$DEBUG_PORT/json"
echo ""
echo "  To find the webview target after opening the board:"
echo "    curl -s http://localhost:$DEBUG_PORT/json | grep -i webview"
echo "======================================================================="

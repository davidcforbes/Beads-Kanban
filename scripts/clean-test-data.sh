#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Beads Kanban Test Data Cleaner
#
# Deletes ALL issues in the current .beads database.
# Intended for use before re-running seed-test-data.sh.
#
# Prerequisites:
#   - bd CLI on PATH
#   - jq on PATH (for JSON parsing)
#   - Current directory (or ancestor) contains a .beads/ database
#
# Usage:
#   cd /path/to/project-with-beads
#   bash scripts/clean-test-data.sh
###############################################################################

echo "=== Beads Kanban Test Data Cleaner ==="
echo ""

# ---- Prerequisites --------------------------------------------------------
if ! command -v bd &> /dev/null; then
    echo "ERROR: bd CLI not found on PATH"
    exit 1
fi

if ! command -v jq &> /dev/null; then
    echo "ERROR: jq not found on PATH (needed for JSON parsing)"
    echo "Install jq: https://jqlang.github.io/jq/download/"
    exit 1
fi

# ---- Collect all issue IDs -------------------------------------------------
echo "Fetching all issue IDs..."

IDS=$(bd list --all --limit 0 --json 2>/dev/null | jq -r '.[].id' 2>/dev/null || true)

if [ -z "$IDS" ]; then
    echo "No issues found. Database is already clean."
    exit 0
fi

COUNT=$(echo "$IDS" | wc -l | tr -d ' ')
echo "Found $COUNT issues to delete."
echo ""

# ---- Confirm ---------------------------------------------------------------
if [ "${1:-}" != "--yes" ] && [ "${1:-}" != "-y" ]; then
    read -rp "Delete all $COUNT issues? This cannot be undone. [y/N] " CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
fi

# ---- Delete all issues -----------------------------------------------------
echo ""
echo "Deleting issues..."

# Write IDs to a temp file for batch deletion
TMPFILE=$(mktemp)
echo "$IDS" > "$TMPFILE"

# Try batch delete first (faster)
if bd delete --from-file "$TMPFILE" --force 2>/dev/null; then
    echo "Batch delete succeeded."
else
    echo "Batch delete failed, falling back to individual deletion..."
    DELETED=0
    FAILED=0
    while IFS= read -r id; do
        if [ -n "$id" ]; then
            if bd delete "$id" --force 2>/dev/null; then
                DELETED=$((DELETED + 1))
            else
                echo "  WARNING: Could not delete $id"
                FAILED=$((FAILED + 1))
            fi
        fi
    done <<< "$IDS"
    echo "Deleted: $DELETED  Failed: $FAILED"
fi

rm -f "$TMPFILE"

echo ""
echo "=== Cleanup complete ==="

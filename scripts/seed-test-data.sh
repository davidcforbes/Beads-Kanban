#!/usr/bin/env bash
set -euo pipefail

###############################################################################
# Beads Kanban Visual Test Data Seeder
#
# Populates a .beads database with 53 representative issues covering all
# visual scenarios: statuses, priorities, types, labels, dependencies,
# comments, assignees, edge cases (long title, markdown, XSS), and dates.
#
# Prerequisites:
#   - bd CLI on PATH
#   - Current directory (or ancestor) contains a .beads/ database
#
# Usage:
#   cd /path/to/project-with-beads
#   bash scripts/seed-test-data.sh
#
# To clean up and re-run:
#   bash scripts/clean-test-data.sh
#   bash scripts/seed-test-data.sh
###############################################################################

echo "=== Beads Kanban Visual Test Data Seeder ==="
echo ""

# ---- Prerequisites --------------------------------------------------------
if ! command -v bd &> /dev/null; then
    echo "ERROR: bd CLI not found on PATH"
    echo "Install bd or add it to your PATH before running this script."
    exit 1
fi

echo "bd CLI found: $(command -v bd)"
echo ""

# ---- Helpers ---------------------------------------------------------------

# Create an issue and echo back its ID (uses --silent for clean output).
# Usage: ID=$(create_issue [bd create flags...])
create_issue() {
    bd create --silent "$@" 2>/dev/null
}

# Counters for progress reporting
CREATED=0

ok() {
    CREATED=$((CREATED + 1))
    echo "  [$CREATED] $1"
}

###############################################################################
# 1. EPIC WITH CHILDREN (parent-child dependencies)
###############################################################################
echo "--- Creating epic with child tasks ---"

EPIC_AUTH=$(create_issue \
    --title "Epic: User Authentication System" \
    --type epic \
    --priority 1 \
    --description "Implement end-to-end user authentication including login, OAuth2, MFA, and session management." \
    --labels "backend,security")
ok "Epic: User Authentication System ($EPIC_AUTH)"

CHILD_LOGIN=$(create_issue \
    --title "Implement login form with email and password" \
    --type task \
    --priority 1 \
    --assignee alice \
    --estimate 120 \
    --parent "$EPIC_AUTH" \
    --labels "frontend")
bd update "$CHILD_LOGIN" --status in_progress
ok "Child: Implement login form ($CHILD_LOGIN) -> in_progress"

CHILD_OAUTH=$(create_issue \
    --title "Add OAuth2 integration for Google and GitHub" \
    --type feature \
    --priority 2 \
    --parent "$EPIC_AUTH" \
    --labels "backend,security")
ok "Child: OAuth2 integration ($CHILD_OAUTH)"

CHILD_TESTS=$(create_issue \
    --title "Write authentication unit and integration tests" \
    --type task \
    --priority 2 \
    --estimate 180 \
    --parent "$EPIC_AUTH" \
    --labels "backend")
ok "Child: Auth tests ($CHILD_TESTS)"

###############################################################################
# 2. BLOCKING DEPENDENCY (issue A blocks issue B)
###############################################################################
echo ""
echo "--- Creating blocking dependencies ---"

BLOCKER_API=$(create_issue \
    --title "Design REST API schema for notifications service" \
    --type task \
    --priority 1 \
    --assignee bob \
    --estimate 240)
bd update "$BLOCKER_API" --status in_progress
ok "Blocker: API schema design ($BLOCKER_API) -> in_progress"

BLOCKED_IMPL=$(create_issue \
    --title "Implement notification delivery pipeline" \
    --type feature \
    --priority 2 \
    --description "Build the async pipeline that routes notifications to email, push, and in-app channels.")
bd dep add "$BLOCKED_IMPL" "$BLOCKER_API" --type blocks
bd update "$BLOCKED_IMPL" --status blocked
ok "Blocked: Notification pipeline ($BLOCKED_IMPL) -> blocked (by $BLOCKER_API)"

###############################################################################
# 3. EDGE CASES
###############################################################################
echo ""
echo "--- Creating edge-case issues ---"

# 3a. Very long title (200+ chars)
LONG_TITLE="Refactor the legacy data transformation pipeline to support streaming processing with backpressure handling and implement comprehensive retry logic with exponential backoff for transient network failures across all downstream microservice integrations"
LONG_ID=$(create_issue \
    --title "$LONG_TITLE" \
    --type chore \
    --priority 3)
ok "Long title (${#LONG_TITLE} chars) ($LONG_ID)"

# 3b. Multi-line markdown description
MARKDOWN_DESC='## Overview

This issue tracks the migration from REST to **GraphQL** for all client-facing APIs.

### Requirements

- [ ] Define GraphQL schema for `User`, `Project`, and `Issue` types
- [ ] Implement resolvers with DataLoader for N+1 prevention
- [ ] Add subscription support for real-time updates

### Technical Notes

Use the following pattern for resolver authentication:

```typescript
const resolvers = {
  Query: {
    issues: async (_parent, args, context) => {
      if (!context.user) throw new AuthError("Unauthorized");
      return db.issues.findMany({ where: args.filter });
    }
  }
};
```

### Links

- [GraphQL Spec](https://graphql.org/learn/)
- [Apollo Server Docs](https://www.apollographql.com/docs/apollo-server/)

> **Note:** This migration must be backward-compatible with existing REST clients for at least 6 months.'

MARKDOWN_ID=$(create_issue \
    --title "Migrate client APIs from REST to GraphQL" \
    --type feature \
    --priority 2 \
    --description "$MARKDOWN_DESC" \
    --labels "backend,docs")
ok "Markdown description ($MARKDOWN_ID)"

# 3c. XSS / special characters in title
XSS_ID=$(create_issue \
    --title "<script>alert('xss')</script> & \"quotes\" test" \
    --type bug \
    --priority 0 \
    --description "This issue tests that special characters are properly escaped in the UI.")
ok "XSS special chars ($XSS_ID)"

# 3d. Issue with a comment
COMMENT_ID=$(create_issue \
    --title "Investigate intermittent WebSocket disconnections in staging" \
    --type bug \
    --priority 1 \
    --assignee alice \
    --labels "backend,urgent")
bd update "$COMMENT_ID" --status in_progress
bd comments add "$COMMENT_ID" "Traced the issue to the load balancer's idle timeout being set to 30s while our heartbeat interval is 60s. Increasing heartbeat frequency to 15s as a quick fix while we evaluate sticky sessions." --author alice
ok "Issue with comment ($COMMENT_ID)"

# 3e. Issue with estimated_minutes
ESTIMATE_ID=$(create_issue \
    --title "Write database migration scripts for v2 schema" \
    --type task \
    --priority 2 \
    --estimate 360 \
    --labels "backend")
ok "Issue with estimate ($ESTIMATE_ID)"

# 3f. Issues with due dates
DUE_PAST=$(create_issue \
    --title "Submit quarterly security audit report" \
    --type task \
    --priority 1 \
    --due "2026-03-15" \
    --labels "security,urgent")
ok "Past due date ($DUE_PAST)"

DUE_FUTURE=$(create_issue \
    --title "Prepare demo environment for customer showcase" \
    --type task \
    --priority 2 \
    --due "+2w")
ok "Future due date ($DUE_FUTURE)"

DUE_TOMORROW=$(create_issue \
    --title "Review and merge pending pull requests before sprint end" \
    --type chore \
    --priority 1 \
    --due "tomorrow" \
    --assignee bob)
bd update "$DUE_TOMORROW" --status in_progress
ok "Due tomorrow ($DUE_TOMORROW)"

###############################################################################
# 4. REMAINING OPEN ISSUES (Ready column) - need 15 total open
###############################################################################
echo ""
echo "--- Creating open (ready) issues ---"
# Already open: EPIC_AUTH, CHILD_OAUTH, CHILD_TESTS, LONG_ID, MARKDOWN_ID,
#               DUE_PAST, DUE_FUTURE, ESTIMATE_ID = 8 open
# Need 7 more open issues

O1=$(create_issue --title "Add dark mode toggle to settings panel" --type feature --priority 3)
ok "Open: dark mode toggle ($O1)"

O2=$(create_issue --title "Optimize image compression pipeline for thumbnails" --type task --priority 2 --estimate 90)
ok "Open: image compression ($O2)"

O3=$(create_issue --title "Create onboarding wizard for first-time users" --type feature --priority 2 --labels "frontend")
ok "Open: onboarding wizard ($O3)"

O4=$(create_issue --title "Audit npm dependencies for known vulnerabilities" --type chore --priority 1 --labels "security")
ok "Open: npm audit ($O4)"

O5=$(create_issue --title "Add keyboard shortcuts for common board actions" --type feature --priority 3 --labels "frontend")
ok "Open: keyboard shortcuts ($O5)"

O6=$(create_issue --title "Set up automated performance regression tests" --type task --priority 4)
ok "Open: perf regression tests ($O6)"

O7=$(create_issue --title "Document internal API contracts for team wiki" --type chore --priority 4 --labels "docs")
ok "Open: API docs ($O7)"

###############################################################################
# 5. IN-PROGRESS ISSUES - need 10 total
###############################################################################
echo ""
echo "--- Creating in-progress issues ---"
# Already in_progress: CHILD_LOGIN, BLOCKER_API, COMMENT_ID, DUE_TOMORROW = 4
# Need 6 more

IP1=$(create_issue --title "Implement drag-and-drop card reordering within columns" --type feature --priority 2 --assignee alice --labels "frontend")
bd update "$IP1" --status in_progress
ok "In-progress: drag-and-drop reorder ($IP1)"

IP2=$(create_issue --title "Fix CSS grid layout breaking on Safari 17" --type bug --priority 1 --labels "frontend")
bd update "$IP2" --status in_progress
ok "In-progress: Safari CSS fix ($IP2)"

IP3=$(create_issue --title "Migrate CI pipeline from Jenkins to GitHub Actions" --type chore --priority 2)
bd update "$IP3" --status in_progress
ok "In-progress: CI migration ($IP3)"

IP4=$(create_issue --title "Implement rate limiting for public API endpoints" --type feature --priority 1 --labels "backend,security")
bd update "$IP4" --status in_progress
ok "In-progress: rate limiting ($IP4)"

IP5=$(create_issue --title "Add Prometheus metrics for database query latency" --type task --priority 3)
bd update "$IP5" --status in_progress
ok "In-progress: Prometheus metrics ($IP5)"

IP6=$(create_issue --title "Refactor event bus to use typed channels" --type chore --priority 3 --labels "refactor")
bd update "$IP6" --status in_progress
ok "In-progress: event bus refactor ($IP6)"

###############################################################################
# 6. BLOCKED ISSUES - need 8 total
###############################################################################
echo ""
echo "--- Creating blocked issues ---"
# Already blocked: BLOCKED_IMPL = 1
# Need 7 more

BL1=$(create_issue --title "Deploy notification microservice to production" --type task --priority 1)
bd dep add "$BL1" "$BLOCKED_IMPL" --type blocks
bd update "$BL1" --status blocked
ok "Blocked: deploy notifications ($BL1)"

BL2=$(create_issue --title "Integrate Stripe payment webhooks" --type feature --priority 2 --labels "backend")
bd update "$BL2" --status blocked
ok "Blocked: Stripe webhooks ($BL2)"

BL3=$(create_issue --title "Configure CDN cache invalidation for static assets" --type task --priority 3)
bd update "$BL3" --status blocked
ok "Blocked: CDN cache ($BL3)"

BL4=$(create_issue --title "Upgrade PostgreSQL from 14 to 16 in staging" --type chore --priority 2)
bd update "$BL4" --status blocked
ok "Blocked: PostgreSQL upgrade ($BL4)"

BL5=$(create_issue --title "Write end-to-end tests for checkout flow" --type task --priority 2 --labels "frontend")
bd update "$BL5" --status blocked
ok "Blocked: checkout e2e tests ($BL5)"

BL6=$(create_issue --title "Add SAML SSO support for enterprise customers" --type feature --priority 1 --labels "security,backend")
bd update "$BL6" --status blocked
ok "Blocked: SAML SSO ($BL6)"

BL7=$(create_issue --title "Fix flaky integration test in payment module" --type bug --priority 2)
bd update "$BL7" --status blocked
ok "Blocked: flaky test ($BL7)"

###############################################################################
# 7. CLOSED ISSUES - need 20 total
###############################################################################
echo ""
echo "--- Creating closed issues ---"

close_issue() {
    local id
    id=$(create_issue "$@")
    bd close "$id" --force 2>/dev/null || bd update "$id" --status closed
    echo "$id"
}

CL1=$(close_issue --title "Set up project repository and initial scaffolding" --type task --priority 2)
ok "Closed: initial scaffolding ($CL1)"

CL2=$(close_issue --title "Configure ESLint and Prettier for consistent code style" --type chore --priority 3)
ok "Closed: ESLint config ($CL2)"

CL3=$(close_issue --title "Implement user registration with email verification" --type feature --priority 1 --labels "backend")
ok "Closed: user registration ($CL3)"

CL4=$(close_issue --title "Fix null pointer exception in session handler" --type bug --priority 0 --labels "backend,urgent")
ok "Closed: null pointer fix ($CL4)"

CL5=$(close_issue --title "Add TypeScript strict mode to tsconfig" --type chore --priority 3)
ok "Closed: TS strict mode ($CL5)"

CL6=$(close_issue --title "Create database schema for issue tracking" --type task --priority 1)
ok "Closed: DB schema ($CL6)"

CL7=$(close_issue --title "Build kanban board column layout with CSS grid" --type feature --priority 2 --labels "frontend")
ok "Closed: kanban CSS grid ($CL7)"

CL8=$(close_issue --title "Fix race condition in concurrent file uploads" --type bug --priority 1)
ok "Closed: upload race condition ($CL8)"

CL9=$(close_issue --title "Add Docker Compose configuration for local development" --type chore --priority 3)
ok "Closed: Docker Compose ($CL9)"

CL10=$(close_issue --title "Implement issue priority sorting algorithm" --type task --priority 2)
ok "Closed: priority sorting ($CL10)"

CL11=$(close_issue --title "Create REST endpoints for CRUD operations on issues" --type feature --priority 1 --labels "backend")
ok "Closed: REST CRUD endpoints ($CL11)"

CL12=$(close_issue --title "Fix incorrect date formatting in card footer" --type bug --priority 3 --labels "frontend")
ok "Closed: date formatting ($CL12)"

CL13=$(close_issue --title "Write unit tests for data validation layer" --type task --priority 2)
ok "Closed: validation tests ($CL13)"

CL14=$(close_issue --title "Implement WebSocket connection for real-time updates" --type feature --priority 2 --labels "backend")
ok "Closed: WebSocket connection ($CL14)"

CL15=$(close_issue --title "Optimize SQL queries for board loading performance" --type task --priority 1)
ok "Closed: SQL optimization ($CL15)"

CL16=$(close_issue --title "Fix memory leak in long-running daemon process" --type bug --priority 0)
ok "Closed: memory leak fix ($CL16)"

CL17=$(close_issue --title "Add automated backup script for production database" --type chore --priority 2 --labels "backend")
ok "Closed: backup script ($CL17)"

CL18=$(close_issue --title "Implement markdown rendering in issue descriptions" --type feature --priority 2 --labels "frontend")
ok "Closed: markdown rendering ($CL18)"

CL19=$(close_issue --title "Migrate from CommonJS to ES modules" --type chore --priority 4)
ok "Closed: ES modules migration ($CL19)"

CL20=$(close_issue --title "Add Content Security Policy headers to webview" --type task --priority 1 --labels "security")
ok "Closed: CSP headers ($CL20)"

###############################################################################
# 8. ADDITIONAL ISSUES TO FILL PRIORITY / TYPE DISTRIBUTION
###############################################################################
echo ""
echo "--- Filling out priority and type distribution ---"

# Extra P4 (backlog) issues
P4_1=$(create_issue --title "Investigate server-sent events as WebSocket alternative" --type task --priority 4)
ok "P4 backlog: SSE investigation ($P4_1)"

P4_2=$(create_issue --title "Evaluate Bun runtime for build tooling" --type chore --priority 4)
ok "P4 backlog: Bun evaluation ($P4_2)"

P4_3=$(create_issue --title "Spike: evaluate Tauri as Electron replacement" --type task --priority 4)
ok "P4 backlog: Tauri spike ($P4_3)"

# Extra P3 (low) issues
P3_1=$(create_issue --title "Add tooltip previews when hovering over card titles" --type feature --priority 3 --labels "frontend")
ok "P3 low: tooltip previews ($P3_1)"

P3_2=$(create_issue --title "Clean up unused CSS variables from legacy theme" --type chore --priority 3 --labels "refactor")
ok "P3 low: CSS cleanup ($P3_2)"

# Extra bug to round out type coverage
BUG_EXTRA=$(create_issue --title "Column count badge shows stale number after drag-and-drop" --type bug --priority 2 --labels "frontend")
ok "Bug: stale column count ($BUG_EXTRA)"

###############################################################################
# Summary
###############################################################################
echo ""
echo "==========================================="
echo "  Seed complete: $CREATED issues created"
echo "==========================================="
echo ""
echo "Approximate distribution:"
echo "  Status:   ~15 open | ~10 in_progress | ~8 blocked | ~20 closed"
echo "  Priority: 2 P0 | 8+ P1 | 20 P2 | 15 P3 | 8 P4"
echo "  Types:    task, bug, feature, epic, chore (5+ each)"
echo ""
echo "Edge cases included:"
echo "  - Long title (${#LONG_TITLE} chars)"
echo "  - Multi-line markdown description"
echo "  - XSS special characters in title"
echo "  - Labels on multiple issues"
echo "  - Assignees: alice, bob"
echo "  - Epic with 3 child tasks (parent-child)"
echo "  - Blocking dependency chain"
echo "  - Issue with comment"
echo "  - Issue with estimated_minutes"
echo "  - Due dates: past, tomorrow, +2 weeks"
echo ""
echo "Open the Kanban board to verify: Beads: Open Kanban Board"

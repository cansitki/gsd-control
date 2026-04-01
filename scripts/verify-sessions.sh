#!/usr/bin/env bash
# verify-sessions.sh — Validates all session reconnection changes from S02:
#   - TmuxSessionInfo type definition (name, idle, attached)
#   - GSDSession.tmuxSessions field
#   - createEmptySession default
#   - useSSH.ts data flow (sessionDetails → tmuxSessions)
#   - SessionCard.tsx tmux session rendering
#   - Sidebar.tsx tmux session badge
#   - No confirm()/alert() calls in UI (R014 / S01 guarantee)
#   - TypeScript compilation
# Exit 0 if all checks pass, exit 1 if any fail.

set -euo pipefail

PASS=0
FAIL=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

check() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  ✅ $label"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $label"
    FAIL=$((FAIL + 1))
  fi
}

# Negative check: succeeds when the pattern is NOT found
check_not() {
  local label="$1"
  shift
  if "$@" > /dev/null 2>&1; then
    echo "  ❌ $label"
    FAIL=$((FAIL + 1))
  else
    echo "  ✅ $label"
    PASS=$((PASS + 1))
  fi
}

TYPES="$PROJECT_DIR/src/lib/types.ts"
APP_STORE="$PROJECT_DIR/src/stores/appStore.ts"
USE_SSH="$PROJECT_DIR/src/hooks/useSSH.ts"
SESSION_CARD="$PROJECT_DIR/src/components/SessionCard.tsx"
SIDEBAR="$PROJECT_DIR/src/components/Sidebar.tsx"

echo "=== Session Reconnection Verification (S02) ==="
echo ""

# --- Type definitions ---
echo "Type definitions:"
check "TmuxSessionInfo interface exists in types.ts" \
  grep -q 'interface TmuxSessionInfo' "$TYPES"
check "TmuxSessionInfo has name field" \
  grep -q 'name: string' "$TYPES"
check "TmuxSessionInfo has idle field" \
  grep -q 'idle: number' "$TYPES"
check "TmuxSessionInfo has attached field" \
  grep -q 'attached: boolean' "$TYPES"
check "GSDSession includes tmuxSessions field" \
  grep -q 'tmuxSessions.*TmuxSessionInfo' "$TYPES"

# --- Store defaults ---
echo ""
echo "Store defaults:"
check "createEmptySession includes tmuxSessions default" \
  grep -q 'tmuxSessions' "$APP_STORE"

# --- Data flow (useSSH) ---
echo ""
echo "Data flow (useSSH):"
check "useSSH references tmuxSessions in session mapping" \
  grep -q 'tmuxSessions' "$USE_SSH"
check "useSSH maps sessionDetails to TmuxSessionInfo" \
  grep -q 'sessionDetails' "$USE_SSH"

# --- UI rendering ---
echo ""
echo "UI rendering:"
check "SessionCard.tsx references tmuxSessions" \
  grep -q 'tmuxSessions' "$SESSION_CARD"
check "Sidebar.tsx references tmuxSessions" \
  grep -q 'tmuxSessions' "$SIDEBAR"

# --- Negative checks (R014 / S01 guarantee) ---
echo ""
echo "Safety — no native dialogs:"
check_not "SessionCard.tsx does NOT use confirm()" \
  grep -q 'confirm(' "$SESSION_CARD"
check_not "SessionCard.tsx does NOT use alert()" \
  grep -q 'alert(' "$SESSION_CARD"
check_not "Sidebar.tsx does NOT use window.confirm()" \
  bash -c "grep 'window\.confirm' '$SIDEBAR'"
check_not "Sidebar.tsx does NOT use alert()" \
  grep -q 'alert(' "$SIDEBAR"

# --- TypeScript compilation ---
echo ""
echo "TypeScript compilation:"
check "tsc --noEmit exits 0" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit -p "$PROJECT_DIR"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

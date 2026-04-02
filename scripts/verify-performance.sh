#!/usr/bin/env bash
# verify-performance.sh — Validates S05 (Performance & Bug Sweep) changes:
#   - Parallel SSH fetching via Promise.allSettled in 3 files
#   - Map-based O(1) fill replacing O(n²) .find() in useCostHistory
#   - Connection-gated polling in useCostHistory
#   - Stale closure fix (getState().workspaces) in useSSH fetchGSDData
#   - useMemo in Dashboard, StatusBar, SessionCard
#   - showError replacing console.warn in handleAttachTmux
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

COST_HISTORY="$PROJECT_DIR/src/hooks/useCostHistory.ts"
USE_SSH="$PROJECT_DIR/src/hooks/useSSH.ts"
TERMINAL_TABS="$PROJECT_DIR/src/components/TerminalTabs.tsx"
DASHBOARD="$PROJECT_DIR/src/components/Dashboard.tsx"
STATUS_BAR="$PROJECT_DIR/src/components/StatusBar.tsx"
SESSION_CARD="$PROJECT_DIR/src/components/SessionCard.tsx"

echo "=== S05 Performance & Bug Sweep Verification ==="

# --- Parallel fetching ---
echo ""
echo "Parallel fetching (Promise.allSettled):"
check "Promise.allSettled in useCostHistory" \
  grep -q 'Promise.allSettled' "$COST_HISTORY"
check "Promise.allSettled in useSSH fetchGSDData" \
  grep -q 'Promise.allSettled' "$USE_SSH"
check "Promise.allSettled in TerminalTabs" \
  grep -q 'Promise.allSettled' "$TERMINAL_TABS"

# --- Map-based fill ---
echo ""
echo "Map-based O(1) fill:"
check_not "No .find() call in useCostHistory (excluding comments)" \
  bash -c "grep '\.find(' '$COST_HISTORY' | grep -v '//'"
check "Map used in useCostHistory" \
  grep -qE 'new Map|Map<' "$COST_HISTORY"

# --- Connection-gated polling ---
echo ""
echo "Connection-gated polling:"
check "connection selector in useCostHistory" \
  grep -q 'connection' "$COST_HISTORY"

# --- Stale closure fix ---
echo ""
echo "Stale closure fix:"
check "getState().workspaces in fetchGSDData" \
  bash -c "grep -A5 'fetchGSDData = useCallback' '$USE_SSH' | grep -q 'getState()\.workspaces\|getState().*workspaces'"

# --- Memoization ---
echo ""
echo "useMemo memoization:"
check "useMemo in Dashboard" \
  grep -q 'useMemo' "$DASHBOARD"
check "useMemo in StatusBar" \
  grep -q 'useMemo' "$STATUS_BAR"
check "useMemo in SessionCard" \
  grep -q 'useMemo' "$SESSION_CARD"

# --- Bug fix: handleAttachTmux ---
echo ""
echo "Bug fix (tmux attach error handling):"
check "showError in handleAttachTmux" \
  bash -c "grep -A20 'handleAttachTmux' '$SESSION_CARD' | grep -q 'showError'"
check_not "No bare console.warn in handleAttachTmux" \
  bash -c "grep -A20 'handleAttachTmux' '$SESSION_CARD' | grep -q 'console\.warn.*No tmux'"

# --- TypeScript ---
echo ""
echo "TypeScript:"
check "tsc --noEmit exits 0" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit

# --- Summary ---
echo ""
TOTAL=$((PASS + FAIL))
echo "=== $PASS passed, $FAIL failed out of $TOTAL checks ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

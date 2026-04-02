#!/usr/bin/env bash
# verify-connection.sh — Validates all connection lifecycle changes from M003/S02:
#   - useSSH retry/backoff logic
#   - useSSH health check / reconnection trigger
#   - "reconnecting" in types.ts
#   - ssh_health_check in lib.rs
#   - StatusBar handles reconnecting
#   - Dashboard handles reconnecting
#   - No confirm()/alert() calls in modified files (R014 / K006)
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
USE_SSH="$PROJECT_DIR/src/hooks/useSSH.ts"
STATUS_BAR="$PROJECT_DIR/src/components/StatusBar.tsx"
DASHBOARD="$PROJECT_DIR/src/components/Dashboard.tsx"
TERMINAL="$PROJECT_DIR/src/components/TerminalBlock.tsx"
LIB_RS="$PROJECT_DIR/src-tauri/src/lib.rs"

echo "=== Connection Lifecycle Verification (M003/S02) ==="
echo ""

# --- Retry / backoff ---
echo "Retry & backoff:"
check "useSSH has retry/backoff logic" \
  grep -qE 'retryTimer|RETRY_DELAYS|backoff' "$USE_SSH"
check "useSSH has health check / reconnection trigger" \
  grep -qE 'checkHealth|ssh_health_check|health_check' "$USE_SSH"

# --- Type definitions ---
echo ""
echo "Type definitions:"
check "\"reconnecting\" in SSHConnection status type" \
  grep -q '"reconnecting"' "$TYPES"

# --- Backend ---
echo ""
echo "Backend:"
check "ssh_health_check registered in lib.rs" \
  grep -q 'ssh_health_check' "$LIB_RS"

# --- UI: StatusBar ---
echo ""
echo "UI - StatusBar:"
check "StatusBar handles reconnecting" \
  grep -q 'reconnecting' "$STATUS_BAR"
check "StatusBar shows Reconnecting... text" \
  grep -q 'Reconnecting\.\.\.' "$STATUS_BAR"

# --- UI: Dashboard ---
echo ""
echo "UI - Dashboard:"
check "Dashboard handles reconnecting" \
  grep -q 'reconnecting' "$DASHBOARD"
check "Dashboard shows Reconnecting... text" \
  grep -q 'Reconnecting\.\.\.' "$DASHBOARD"

# --- No confirm()/alert() ---
echo ""
echo "No confirm()/alert() (K006/R014):"
check_not "No confirm() in useSSH.ts" \
  grep -E '\bconfirm\(' "$USE_SSH"
check_not "No alert() in useSSH.ts" \
  grep -E '\balert\(' "$USE_SSH"
check_not "No confirm() in StatusBar.tsx" \
  grep -E '\bconfirm\(' "$STATUS_BAR"
check_not "No alert() in StatusBar.tsx" \
  grep -E '\balert\(' "$STATUS_BAR"
check_not "No confirm() in Dashboard.tsx" \
  grep -E '\bconfirm\(' "$DASHBOARD"
check_not "No alert() in Dashboard.tsx" \
  grep -E '\balert\(' "$DASHBOARD"
check_not "No confirm() in Terminal.tsx" \
  grep -E '\bconfirm\(' "$TERMINAL"
check_not "No alert() in Terminal.tsx" \
  grep -E '\balert\(' "$TERMINAL"
check_not "No confirm() in types.ts" \
  grep -E '\bconfirm\(' "$TYPES"
check_not "No alert() in types.ts" \
  grep -E '\balert\(' "$TYPES"

# --- TypeScript compilation ---
echo ""
echo "TypeScript:"
check "tsc --noEmit passes" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit -p "$PROJECT_DIR"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

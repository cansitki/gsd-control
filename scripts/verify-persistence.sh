#!/usr/bin/env bash
# verify-persistence.sh — Validates Zustand persistence & state fixes from S03:
#   - Named workspace store actions (add/remove/update)
#   - Persist config has migrate function
#   - No raw setState workspace mutations in components
#   - fetchGSDData reads workspaces from getState() (no stale closure)
#   - TerminalTabs handleNewTab has null guard
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

APP_STORE="$PROJECT_DIR/src/stores/appStore.ts"
SIDEBAR="$PROJECT_DIR/src/components/Sidebar.tsx"
SETTINGS="$PROJECT_DIR/src/components/Settings.tsx"
SETUP="$PROJECT_DIR/src/components/Setup.tsx"
USE_SSH="$PROJECT_DIR/src/hooks/useSSH.ts"
TERMINAL_TABS="$PROJECT_DIR/src/components/TerminalTabs.tsx"

echo "=== Zustand Persistence & State Fixes Verification ==="
echo ""

# --- AppState interface: workspace actions ---
echo "AppState interface — workspace actions:"
check "AppState interface has addWorkspace action" \
  grep -q 'addWorkspace:.*WorkspaceConfig.*void' "$APP_STORE"
check "AppState interface has removeWorkspace action" \
  grep -q 'removeWorkspace:.*string.*void' "$APP_STORE"
check "AppState interface has updateWorkspace action" \
  grep -q 'updateWorkspace:.*string.*void' "$APP_STORE"

# --- Store implementation: workspace actions ---
echo ""
echo "Store implementation — workspace actions:"
check "Store has addWorkspace implementation" \
  grep -q 'addWorkspace:' "$APP_STORE"
check "Store has removeWorkspace implementation" \
  grep -q 'removeWorkspace:' "$APP_STORE"
check "Store has updateWorkspace implementation" \
  grep -q 'updateWorkspace:' "$APP_STORE"

# --- Persist config: migrate function ---
echo ""
echo "Persist config — migration:"
check "Persist config has migrate function" \
  grep -q 'migrate:' "$APP_STORE"

# --- No raw setState workspace mutations in components ---
echo ""
echo "Components — no raw workspace setState:"
check_not "Sidebar.tsx has no raw useAppStore.setState with workspaces" \
  grep -q 'useAppStore\.setState.*workspaces' "$SIDEBAR"
check_not "Settings.tsx has no raw useAppStore.setState with workspaces" \
  grep -q 'useAppStore\.setState.*workspaces' "$SETTINGS"
check_not "Setup.tsx has no raw useAppStore.setState with workspaces" \
  grep -q 'useAppStore\.setState.*workspaces' "$SETUP"

# --- useSSH: fetchGSDData reads from getState ---
echo ""
echo "useSSH — stale closure fix:"
check "fetchGSDData reads workspaces from getState()" \
  grep -q 'getState()\.workspaces' "$USE_SSH"

# --- TerminalTabs: null guard ---
echo ""
echo "TerminalTabs — null guard:"
check "handleNewTab has workspaces length guard" \
  grep -q 'workspaces\.length === 0' "$TERMINAL_TABS"

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

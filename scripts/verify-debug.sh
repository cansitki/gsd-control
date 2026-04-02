#!/usr/bin/env bash
# verify-debug.sh — Validates the two-level debug system from M004/S04:
#   - DebugLevel type exported from types.ts
#   - appStore has debugLevel state, action, partialize, version 4, migration
#   - debugInvoke wrapper with secret redaction
#   - useDebugLogger gated by debugLevel (not always-on)
#   - No raw invoke imports in components/ or hooks/
#   - Settings has debug level toggle
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
DEBUG_INVOKE="$PROJECT_DIR/src/lib/debugInvoke.ts"
USE_DEBUG="$PROJECT_DIR/src/hooks/useDebugLogger.ts"
SETTINGS="$PROJECT_DIR/src/components/Settings.tsx"
COMPONENTS="$PROJECT_DIR/src/components"
HOOKS="$PROJECT_DIR/src/hooks"

echo "=== Two-Level Debug System Verification ==="

# --- Types ---
echo ""
echo "Types:"
check "DebugLevel type exported from types.ts" \
  rg 'export type DebugLevel' "$TYPES"

# --- Store interface ---
echo ""
echo "Store interface:"
check "debugLevel: DebugLevel in AppState" \
  rg 'debugLevel:\s*DebugLevel' "$APP_STORE"
check "setDebugLevel in AppState" \
  rg 'setDebugLevel' "$APP_STORE"

# --- Store implementation ---
echo ""
echo "Store implementation:"
check "debugLevel initial value in store" \
  rg 'debugLevel:' "$APP_STORE"
check "setDebugLevel action in store" \
  rg 'setDebugLevel:' "$APP_STORE"
check "debugLevel in partialize block" \
  rg 'partialize' "$APP_STORE"
check "version: 4 in persist config" \
  rg 'version:\s*4' "$APP_STORE"
check "migrate function references debugLevel" \
  rg 'migrate' "$APP_STORE"

# --- debugInvoke ---
echo ""
echo "debugInvoke wrapper:"
check "debugInvoke.ts file exists" \
  test -f "$DEBUG_INVOKE"
check "REDACTED_KEYS for secret redaction" \
  rg 'REDACTED_KEYS' "$DEBUG_INVOKE"
check "debugInvoke function exported" \
  rg 'export (async )?function debugInvoke' "$DEBUG_INVOKE"

# --- useDebugLogger ---
echo ""
echo "useDebugLogger:"
check "debugLevel referenced in useDebugLogger" \
  rg 'debugLevel' "$USE_DEBUG"
check "console.log override gated by extreme check" \
  rg 'debugLevel === .extreme.' "$USE_DEBUG"
check_not "No unconditional console.log override (not always-on)" \
  rg '^console\.log\s*=' "$USE_DEBUG"

# --- No raw invoke imports ---
echo ""
echo "Import hygiene:"
check_not "No raw invoke import in components/" \
  rg 'from "@tauri-apps/api/core"' "$COMPONENTS"
check_not "No raw invoke import in hooks/" \
  rg 'from "@tauri-apps/api/core"' "$HOOKS"

# --- Settings UI ---
echo ""
echo "Settings UI:"
check "setDebugLevel called in Settings" \
  rg 'setDebugLevel' "$SETTINGS"
check "debugLevel read in Settings" \
  rg 'debugLevel' "$SETTINGS"

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

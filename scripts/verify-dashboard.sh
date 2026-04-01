#!/usr/bin/env bash
# verify-dashboard.sh — Validates all S03 dashboard changes:
#   - DateRange type and getDateRange function
#   - terminalPreview field and capture-pane integration
#   - Date range selector in Dashboard (today/week/month presets)
#   - Last-poll timestamp and connection health in Dashboard
#   - Dynamic rangeLabel in CostChart
#   - Terminal preview in SessionCard
#   - lastPollTime and workspaceHealth in store
#   - No confirm()/alert() calls in components (R014)
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
USE_COST="$PROJECT_DIR/src/hooks/useCostHistory.ts"
DASHBOARD="$PROJECT_DIR/src/components/Dashboard.tsx"
COST_CHART="$PROJECT_DIR/src/components/CostChart.tsx"
SESSION_CARD="$PROJECT_DIR/src/components/SessionCard.tsx"

echo "=== Dashboard Verification (S03) ==="
echo ""

# --- DateRange type and date logic ---
echo "DateRange type and date logic:"
check "DateRange interface exists in types.ts" \
  grep -q 'interface DateRange' "$TYPES"
check "useCostHistory accepts DateRange parameter" \
  grep -q 'useCostHistory.*range.*DateRange' "$USE_COST"
check "getDateRange function exists (not just getLast14Days)" \
  grep -q 'function getDateRange' "$USE_COST"

# --- Terminal preview pipeline ---
echo ""
echo "Terminal preview pipeline:"
check "GSDSession has terminalPreview field in types.ts" \
  grep -q 'terminalPreview' "$TYPES"
check "capture-pane in useSSH.ts Python script" \
  grep -q 'capture-pane' "$USE_SSH"
check "terminalPreview mapped into session object in useSSH.ts" \
  grep -q 'terminalPreview' "$USE_SSH"

# --- Dashboard UI ---
echo ""
echo "Dashboard UI:"
check "Dashboard renders today preset button" \
  grep -q 'today' "$DASHBOARD"
check "Dashboard renders week preset button" \
  grep -q 'week' "$DASHBOARD"
check "Dashboard renders month preset button" \
  grep -q 'month' "$DASHBOARD"
check "Dashboard renders last-poll timestamp" \
  grep -q 'lastPollTime' "$DASHBOARD"
check "Dashboard renders workspaceHealth" \
  grep -q 'workspaceHealth' "$DASHBOARD"

# --- CostChart dynamic label ---
echo ""
echo "CostChart dynamic label:"
check "CostChart has rangeLabel prop (not hardcoded)" \
  grep -q 'rangeLabel' "$COST_CHART"

# --- SessionCard terminal preview ---
echo ""
echo "SessionCard terminal preview:"
check "SessionCard renders terminalPreview" \
  grep -q 'terminalPreview' "$SESSION_CARD"

# --- Store fields ---
echo ""
echo "Store fields:"
check "lastPollTime in app store" \
  grep -q 'lastPollTime' "$APP_STORE"
check "workspaceHealth in app store" \
  grep -q 'workspaceHealth' "$APP_STORE"

# --- Safety — no native dialogs (R014) ---
echo ""
echo "Safety — no native dialogs (R014):"
check_not "Dashboard.tsx does NOT use confirm()" \
  grep -q 'confirm(' "$DASHBOARD"
check_not "Dashboard.tsx does NOT use alert()" \
  grep -q 'alert(' "$DASHBOARD"
check_not "SessionCard.tsx does NOT use confirm()" \
  grep -q 'confirm(' "$SESSION_CARD"
check_not "SessionCard.tsx does NOT use alert()" \
  grep -q 'alert(' "$SESSION_CARD"
check_not "CostChart.tsx does NOT use confirm()" \
  grep -q 'confirm(' "$COST_CHART"
check_not "CostChart.tsx does NOT use alert()" \
  grep -q 'alert(' "$COST_CHART"

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

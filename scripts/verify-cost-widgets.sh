#!/usr/bin/env bash
# verify-cost-widgets.sh — Validates all 9 cost widgets are rendered (M006/S02):
#   - Dashboard: Total Cost, Today's Cost, Cost/Hour, Sessions (with auto/interactive)
#   - Dashboard: Active count + Connection status (kept from before)
#   - CostChart: All 4 token types (Input, Output, Cache Read, Cache Write)
#   - CostChart: Token mix proportional bar
#   - CostChart: Model Distribution section
#   - CostChart: Per-Milestone Costs table
#   - No confirm()/alert() calls (K006)
#   - TypeScript compilation clean
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

DASH="$PROJECT_DIR/src/components/Dashboard.tsx"
COST="$PROJECT_DIR/src/components/CostChart.tsx"

echo ""
echo "=== Dashboard Cost Widgets (M006/S02) ==="
echo ""

echo "--- Dashboard.tsx: Summary cards ---"
check "Today's Cost card rendered" grep -q "todayCost" "$DASH"
check "Cost/Hour card rendered" grep -q "costPerHour" "$DASH"
check "Session count rendered" grep -q "sessionCount" "$DASH"
check "Auto mode count rendered" grep -q "autoModeCount" "$DASH"
check "Interactive count rendered" grep -q "interactiveCount" "$DASH"
check "Total Cost card still present" grep -q "Total Cost" "$DASH"
check "Active card still present" grep -q "Active" "$DASH"
check "Connection card still present" grep -q "Connection" "$DASH"

echo ""
echo "--- CostChart.tsx: Token breakdown ---"
check "Input Tokens stat box" grep -q "Input Tokens" "$COST"
check "Output Tokens stat box" grep -q "Output Tokens" "$COST"
check "Cache Read stat box" grep -q "Cache Read" "$COST"
check "Cache Write stat box" grep -q "Cache Write" "$COST"
check "Token mix bar component" grep -q "TokenMixBar" "$COST"
check "totalInput referenced" grep -q "stats.totalInput" "$COST"
check "totalCacheWrite referenced" grep -q "stats.totalCacheWrite" "$COST"

echo ""
echo "--- CostChart.tsx: Model Distribution ---"
check "Model Distribution section" grep -q "Model Distribution" "$COST"
check "stats.models referenced" grep -q "stats.models" "$COST"
check "Models sorted by cost descending" grep -q "sort.*b\[1\].*a\[1\]" "$COST"

echo ""
echo "--- CostChart.tsx: Per-Milestone Costs ---"
check "Auto-Mode Milestones label" grep -q "Auto-Mode Milestones" "$COST"
check "stats.milestones referenced" grep -q "stats.milestones" "$COST"
check "Per-unit cost calculation" grep -q "m.cost / m.units" "$COST"
check "Duration column" grep -q "formatDuration" "$COST"
check "MilestoneBreakdown type imported" grep -q "MilestoneBreakdown" "$COST"

echo ""
echo "--- Safety checks ---"
check_not "No confirm() in Dashboard" grep -rn 'confirm(' "$DASH"
check_not "No alert() in Dashboard" grep -rn 'alert(' "$DASH"
check_not "No confirm() in CostChart" grep -rn 'confirm(' "$COST"
check_not "No alert() in CostChart" grep -rn 'alert(' "$COST"

echo ""
echo "--- TypeScript compilation ---"
if node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit 2>&1; then
  echo "  ✅ tsc --noEmit clean"
  PASS=$((PASS + 1))
else
  echo "  ❌ tsc --noEmit failed"
  FAIL=$((FAIL + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

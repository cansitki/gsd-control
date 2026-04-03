#!/usr/bin/env bash
# verify-cost-tracker.sh — Validates cost tracker rewrite (M006/S01):
#   - Python session scanner uses ~/.gsd/sessions/, not activity/
#   - costAggregator.ts calls correct SSH command
#   - No summing of session totals + milestone breakdown
#   - Incremental timestamp tracking present
#   - ProjectCostSummary type has sessionCount field
#   - useCostHistory returns new CostStats shape
#   - MilestoneBreakdown type exists
#   - CostChart.tsx receives compatible props
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

COST_AGG="$PROJECT_DIR/src/lib/costAggregator.ts"
USE_COST="$PROJECT_DIR/src/hooks/useCostHistory.ts"
COST_CHART="$PROJECT_DIR/src/components/CostChart.tsx"

echo "=== Cost Tracker Verification (M006/S01) ==="
echo ""

# --- (1) Python script uses sessions dir, not activity dir ---
echo "Python session scanner data source:"
check "SESSION_SCANNER_SCRIPT references ~/.gsd/sessions/" \
  grep -q 'sessions/' "$COST_AGG"
check_not "No activity/ path in data pipeline" \
  grep -q 'activity/' "$COST_AGG"

echo ""

# --- (2) costAggregator.ts calls correct SSH command ---
echo "SSH command integration:"
check "SESSION_SCANNER_SCRIPT constant defined" \
  grep -q 'SESSION_SCANNER_SCRIPT' "$COST_AGG"
check "Script is escaped and passed to SSH" \
  grep -q "SESSION_SCANNER_SCRIPT.replace" "$COST_AGG"

echo ""

# --- (3) No summing of session + metrics totals (deduplication) ---
echo "Deduplication — session totals and milestone breakdown separate:"
check "milestones field is MilestoneBreakdown[] in ProjectCostSummary" \
  grep -q 'milestones: MilestoneBreakdown\[\]' "$COST_AGG"
check "fetchMilestoneBreakdown is a separate function" \
  grep -q 'export async function fetchMilestoneBreakdown' "$COST_AGG"
check_not "totalCost never sums milestone costs" \
  grep -q 'milestoneBreakdown.*totalCost\|totalCost.*milestone' "$COST_AGG"

echo ""

# --- (4) Incremental timestamp tracking present ---
echo "Incremental scan support:"
check "scanTimestamps Map exists" \
  grep -q 'scanTimestamps.*Map' "$COST_AGG"
check "lastScan read from scanTimestamps" \
  grep -q 'scanTimestamps.get' "$COST_AGG"
check "scanTimestamps.set called after scan" \
  grep -q 'scanTimestamps.set' "$COST_AGG"

echo ""

# --- (5) ProjectCostSummary type has sessionCount field ---
echo "ProjectCostSummary type completeness:"
check "sessionCount field in ProjectCostSummary" \
  grep -q 'sessionCount: number' "$COST_AGG"
check "autoModeCount field exists" \
  grep -q 'autoModeCount' "$COST_AGG"
check "interactiveCount field exists" \
  grep -q 'interactiveCount' "$COST_AGG"

echo ""

# --- (6) useCostHistory returns new CostStats shape ---
echo "CostStats shape in useCostHistory:"
check "CostStats interface defined" \
  grep -q 'export interface CostStats' "$USE_COST"
check "sessionCount in CostStats" \
  grep -q 'sessionCount' "$USE_COST"
check "CostStats includes totalCost" \
  grep -q 'totalCost' "$USE_COST"

echo ""

# --- (7) MilestoneBreakdown type exists ---
echo "MilestoneBreakdown type:"
check "MilestoneBreakdown interface exported" \
  grep -q 'export interface MilestoneBreakdown' "$COST_AGG"

echo ""

# --- (8) CostChart.tsx receives compatible props ---
echo "CostChart.tsx compatibility:"
check "CostChart imports CostStats" \
  grep -q "CostStats" "$COST_CHART"
check "CostChart uses stats.totalCost" \
  grep -q 'stats.totalCost' "$COST_CHART"

echo ""

# --- (9) TypeScript compilation clean ---
echo "TypeScript compilation:"
# K005: npx tsc may fail; use node directly
TSC="$PROJECT_DIR/node_modules/typescript/lib/tsc.js"
if [ -f "$TSC" ]; then
  check "tsc --noEmit clean" \
    node "$TSC" --noEmit
else
  echo "  ⚠️  TypeScript compiler not found at $TSC — skipping"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

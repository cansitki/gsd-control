#!/usr/bin/env bash
# verify-integration.sh — Cross-block integration invariants (M005/S06):
#   - All 3 block types in renderBlock switch
#   - All 3 block types in creation dropdown & empty state
#   - BlockType enum has exactly 3 values
#   - Store v4 migrate function exists
#   - No stale file references or terminal-tab API
#   - Sidebar context menu has all block types
#   - No hand-rolled sizing math
#   - debugInvoke used everywhere (no direct @tauri-apps/api/core imports)
#   - TypeScript compilation
#   - Master gate: run all 15 other verify scripts
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

cd "$PROJECT_DIR"

echo ""
echo "=== Cross-Block Integration Checks ==="
echo ""

# 1. All 3 block types in renderBlock switch
echo "--- renderBlock switch ---"
check "renderBlock has case terminal" rg 'case "terminal"' src/components/BlockLayout.tsx
check "renderBlock has case browser" rg 'case "browser"' src/components/BlockLayout.tsx
check "renderBlock has case explorer" rg 'case "explorer"' src/components/BlockLayout.tsx

# 2. All 3 block types in creation dropdown
echo "--- Creation dropdown ---"
check "Dropdown has handleNewTerminal" rg 'handleNewTerminal' src/components/BlockLayout.tsx
check "Dropdown has handleNewBrowser" rg 'handleNewBrowser' src/components/BlockLayout.tsx
check "Dropdown has handleNewExplorer" rg 'handleNewExplorer' src/components/BlockLayout.tsx

# 3. BlockType enum has exactly 3 values
echo "--- BlockType enum ---"
check "BlockType includes terminal" rg '"terminal"' src/lib/types.ts
check "BlockType includes browser" rg '"browser"' src/lib/types.ts
check "BlockType includes explorer" rg '"explorer"' src/lib/types.ts

# 4. Store v4 migrate function exists
echo "--- Store migration ---"
check "Store has migrate function" grep -q 'migrate' src/stores/appStore.ts

# 5. No stale file references
echo "--- No stale references ---"
check_not "No Terminal.tsx references" rg 'Terminal\.tsx' src/
check_not "No TerminalTabs.tsx references" rg 'TerminalTabs\.tsx' src/

# 6. No stale terminal-tab API
echo "--- No stale terminal-tab API ---"
check_not "No terminalTabs" rg 'terminalTabs' src/
check_not "No addTerminalTab" rg 'addTerminalTab' src/
check_not "No activeTerminalId" rg 'activeTerminalId' src/
check_not "No TerminalTab type" rg 'TerminalTab' src/

# 7. Sidebar context menu has all block types
echo "--- Sidebar block types ---"
check "Sidebar has terminal view" rg '"terminal"' src/components/Sidebar.tsx
check "Sidebar has Open in Browser" rg 'Open in Browser' src/components/Sidebar.tsx
check "Sidebar has Open Explorer" rg 'Open Explorer' src/components/Sidebar.tsx

# 8. Empty state offers all 3 block types
echo "--- Empty state ---"
# Empty state and dropdown both use the same handlers
TERMINAL_COUNT=$(rg -c 'handleNewTerminal' src/components/BlockLayout.tsx || echo 0)
check "Empty state + dropdown: multiple handleNewTerminal refs" test "$TERMINAL_COUNT" -ge 2

# 9. No hand-rolled sizing math
echo "--- No hand-rolled sizing ---"
check_not "No _renderService" rg '_renderService' src/
check_not "No _core._" rg '_core\._' src/
check_not "No retryFit" rg 'retryFit' src/

# 10. debugInvoke used everywhere
echo "--- debugInvoke wrapper ---"
check_not "No direct @tauri-apps/api/core in components" rg "from '@tauri-apps/api/core'" src/components/
check_not "No direct @tauri-apps/api/core in hooks" rg "from '@tauri-apps/api/core'" src/hooks/

# 11. TypeScript compilation
echo "--- TypeScript ---"
check "tsc --noEmit clean" node node_modules/typescript/lib/tsc.js --noEmit

echo ""
echo "=== Integration Checks: $PASS passed, $FAIL failed ==="
echo ""

# 12. Master gate: run all 15 other verify scripts
echo "=== Master Gate: Running all 15 verify scripts ==="
echo ""

SCRIPTS_PASS=0
SCRIPTS_FAIL=0

for script in "$SCRIPT_DIR"/verify-*.sh; do
  name="$(basename "$script")"
  # Skip ourselves
  if [ "$name" = "verify-integration.sh" ]; then
    continue
  fi
  if bash "$script" > /dev/null 2>&1; then
    echo "  ✅ $name"
    SCRIPTS_PASS=$((SCRIPTS_PASS + 1))
  else
    echo "  ❌ $name"
    SCRIPTS_FAIL=$((SCRIPTS_FAIL + 1))
  fi
done

echo ""
echo "=== Master Gate: $SCRIPTS_PASS scripts passed, $SCRIPTS_FAIL scripts failed ==="
echo ""

# Combine totals
TOTAL_PASS=$((PASS + SCRIPTS_PASS))
TOTAL_FAIL=$((FAIL + SCRIPTS_FAIL))

echo "=== TOTAL: $TOTAL_PASS passed, $TOTAL_FAIL failed ==="

if [ "$TOTAL_FAIL" -gt 0 ]; then
  exit 1
fi

exit 0

#!/usr/bin/env bash
# verify-explorer.sh — Validates File Explorer block (M005/S05):
#   - ExplorerBlock.tsx with SSH directory listing, breadcrumbs, preview, store persistence
#   - BlockLayout.tsx Explorer creation and wiring
#   - Sidebar.tsx Explorer context menu option
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

echo ""
echo "=== Explorer Block Verification ==="

echo ""
echo "--- ExplorerBlock.tsx existence & size ---"
check "ExplorerBlock.tsx exists" test -f "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "ExplorerBlock.tsx has >50 lines" test "$(wc -l < "$PROJECT_DIR/src/components/ExplorerBlock.tsx")" -gt 50

echo ""
echo "--- ExplorerBlock imports & core integrations ---"
check "imports debugInvoke" grep -q "debugInvoke" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "imports addDebugLog" grep -q "addDebugLog" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "imports useAppStore" grep -q "useAppStore" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "imports shell escape utility" grep -qE "sanitizeShellArg|escapeShellSingleQuote" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- ExplorerBlock SSH & directory listing ---"
check "exec_in_workspace called for SSH" grep -q "exec_in_workspace" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "ls -la command present" grep -q "ls -la" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- ExplorerBlock UI elements ---"
check "Breadcrumb UI present" grep -qE "breadcrumb|Breadcrumb|crumb" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "Loading state UI present" grep -q "Loading" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "Error state UI present" grep -qE "error|Error" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- ExplorerBlock file preview ---"
check "File preview (head -c) present" grep -q "head -c" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "Binary detection (file --mime-type) present" grep -q "file --mime-type" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- ExplorerBlock store & terminal ---"
check "updateBlock called for path persistence" grep -q "updateBlock" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "addBlock called for open-terminal-here" grep -q "addBlock" "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- BlockLayout Explorer integration ---"
check "BlockLayout has handleNewExplorer" grep -q "handleNewExplorer" "$PROJECT_DIR/src/components/BlockLayout.tsx"
check "BlockLayout dropdown has Explorer option" grep -q "Explorer" "$PROJECT_DIR/src/components/BlockLayout.tsx"
check "renderBlock passes workspace to ExplorerBlock" grep -q "workspace={block.workspace}" "$PROJECT_DIR/src/components/BlockLayout.tsx"

echo ""
echo "--- Sidebar Explorer integration ---"
check "Sidebar has Open Explorer option" grep -q "Open Explorer" "$PROJECT_DIR/src/components/Sidebar.tsx"

echo ""
echo "--- Safety checks ---"
check_not "No confirm() in ExplorerBlock" grep -qE '\bconfirm\(' "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check_not "No alert() in ExplorerBlock" grep -qE '\balert\(' "$PROJECT_DIR/src/components/ExplorerBlock.tsx"

echo ""
echo "--- TypeScript compilation ---"
check "tsc --noEmit clean" node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

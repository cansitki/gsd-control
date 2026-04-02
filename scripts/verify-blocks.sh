#!/usr/bin/env bash
# verify-blocks.sh — Validates block type system & layout (M005/S03):
#   - BlockType/Block types in types.ts
#   - Block store API in appStore.ts (no terminal tab references)
#   - BlockLayout.tsx with block registry, BrowserBlock, ExplorerBlock
#   - All call sites migrated (Sidebar, SessionCard, useKeyboardShortcuts, TerminalBlock)
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

echo "=== Block Type System & Layout Verification ==="
echo ""

echo "── Types (src/lib/types.ts) ──"
check "BlockType type exists" \
  grep -q 'BlockType' "$PROJECT_DIR/src/lib/types.ts"
check "Block interface has type field" \
  grep -q 'type: BlockType' "$PROJECT_DIR/src/lib/types.ts"
check_not "No TerminalTab in types.ts" \
  grep -q 'TerminalTab' "$PROJECT_DIR/src/lib/types.ts"

echo ""
echo "── Store (src/stores/appStore.ts) ──"
check "blocks array in appStore" \
  grep -q 'blocks:' "$PROJECT_DIR/src/stores/appStore.ts"
check "activeBlockId in appStore" \
  grep -q 'activeBlockId' "$PROJECT_DIR/src/stores/appStore.ts"
check "addBlock in appStore" \
  grep -q 'addBlock' "$PROJECT_DIR/src/stores/appStore.ts"
check "removeBlock in appStore" \
  grep -q 'removeBlock' "$PROJECT_DIR/src/stores/appStore.ts"
check "setActiveBlock in appStore" \
  grep -q 'setActiveBlock' "$PROJECT_DIR/src/stores/appStore.ts"
check "updateBlock in appStore" \
  grep -q 'updateBlock' "$PROJECT_DIR/src/stores/appStore.ts"
check "setBlockLayout in appStore" \
  grep -q 'setBlockLayout' "$PROJECT_DIR/src/stores/appStore.ts"
check_not "No terminalTabs in appStore" \
  grep -q 'terminalTabs' "$PROJECT_DIR/src/stores/appStore.ts"
check_not "No addTerminalTab in appStore" \
  grep -q 'addTerminalTab' "$PROJECT_DIR/src/stores/appStore.ts"
check_not "No activeTerminalId in appStore" \
  grep -q 'activeTerminalId' "$PROJECT_DIR/src/stores/appStore.ts"
check "blockLayout in partialize" \
  grep -q 'blockLayout' "$PROJECT_DIR/src/stores/appStore.ts"
check "Store version 4" \
  grep -q 'version: 4' "$PROJECT_DIR/src/stores/appStore.ts"
check "Migrate function exists" \
  grep -q 'migrate' "$PROJECT_DIR/src/stores/appStore.ts"

echo ""
echo "── Components ──"
check "BlockLayout.tsx exists" \
  test -f "$PROJECT_DIR/src/components/BlockLayout.tsx"
check_not "TerminalTabs.tsx does NOT exist" \
  test -f "$PROJECT_DIR/src/components/TerminalTabs.tsx"
check "Block registry or icon map in BlockLayout" \
  grep -qE 'BLOCK_REGISTRY|BLOCK_ICON' "$PROJECT_DIR/src/components/BlockLayout.tsx"
check "BrowserBlock.tsx exists" \
  test -f "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "ExplorerBlock.tsx exists" \
  test -f "$PROJECT_DIR/src/components/ExplorerBlock.tsx"
check "App.tsx imports BlockLayout" \
  grep -q 'BlockLayout' "$PROJECT_DIR/src/App.tsx"
check_not "App.tsx does NOT import TerminalTabs" \
  grep -q 'TerminalTabs' "$PROJECT_DIR/src/App.tsx"

echo ""
echo "── Call site migration ──"
check "Sidebar uses addBlock" \
  grep -q 'addBlock' "$PROJECT_DIR/src/components/Sidebar.tsx"
check_not "Sidebar has no addTerminalTab" \
  grep -q 'addTerminalTab' "$PROJECT_DIR/src/components/Sidebar.tsx"
check "SessionCard uses addBlock" \
  grep -q 'addBlock' "$PROJECT_DIR/src/components/SessionCard.tsx"
check_not "SessionCard has no addTerminalTab" \
  grep -q 'addTerminalTab' "$PROJECT_DIR/src/components/SessionCard.tsx"
check "useKeyboardShortcuts uses addBlock" \
  grep -q 'addBlock' "$PROJECT_DIR/src/hooks/useKeyboardShortcuts.ts"
check_not "useKeyboardShortcuts has no addTerminalTab" \
  grep -q 'addTerminalTab' "$PROJECT_DIR/src/hooks/useKeyboardShortcuts.ts"
check "useDebugLogger references blocks" \
  grep -q 'state.blocks.length' "$PROJECT_DIR/src/hooks/useDebugLogger.ts"

echo ""
echo "── Global sweep: no stale references ──"
check_not "No addTerminalTab anywhere in src/" \
  grep -rq 'addTerminalTab' "$PROJECT_DIR/src/"
check_not "No terminalTabs anywhere in src/" \
  grep -rq 'terminalTabs' "$PROJECT_DIR/src/"
check_not "No activeTerminalId anywhere in src/" \
  grep -rq 'activeTerminalId' "$PROJECT_DIR/src/"
check_not "No TerminalTab type anywhere in src/" \
  grep -rq 'TerminalTab' "$PROJECT_DIR/src/"

echo ""
echo "── TypeScript compilation ──"
check "tsc --noEmit clean" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit --project "$PROJECT_DIR"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

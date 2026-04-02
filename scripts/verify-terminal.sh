#!/usr/bin/env bash
# verify-terminal.sh — Validates TermWrap + TerminalBlock architecture (M005/S01):
#   - TermWrap class with xterm addons, WebGL fallback, ResizeObserver, search, dispose
#   - TerminalBlock component using TermWrap (no hand-rolled sizing)
#   - TerminalTabs imports TerminalBlock
#   - No legacy Terminal.tsx, _renderService, or retryFit
#   - Package deps present
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

TERMWRAP="$PROJECT_DIR/src/lib/termwrap.ts"
TERMINAL_BLOCK="$PROJECT_DIR/src/components/TerminalBlock.tsx"
BLOCK_LAYOUT="$PROJECT_DIR/src/components/BlockLayout.tsx"
PACKAGE_JSON="$PROJECT_DIR/package.json"

echo "=== TermWrap + TerminalBlock Architecture Verification ==="
echo ""

echo "── TermWrap class (src/lib/termwrap.ts) ──"
check "Imports FitAddon from @xterm/addon-fit" \
  grep -q "from ['\"]@xterm/addon-fit['\"]" "$TERMWRAP"
check "Imports WebglAddon from @xterm/addon-webgl" \
  grep -q "from ['\"]@xterm/addon-webgl['\"]" "$TERMWRAP"
check "Imports SearchAddon from @xterm/addon-search" \
  grep -q "from ['\"]@xterm/addon-search['\"]" "$TERMWRAP"
check "Imports SerializeAddon from @xterm/addon-serialize" \
  grep -q "from ['\"]@xterm/addon-serialize['\"]" "$TERMWRAP"
check "Contains fitAddon.fit() call" \
  grep -q 'fitAddon.fit()' "$TERMWRAP"
check "Contains onContextLoss WebGL fallback" \
  grep -q 'onContextLoss' "$TERMWRAP"
check_not "Does NOT contain _renderService access" \
  grep -q '_renderService' "$TERMWRAP"
check_not "Does NOT contain _core access" \
  grep -q '_core' "$TERMWRAP"
check "Contains ResizeObserver" \
  grep -q 'ResizeObserver' "$TERMWRAP"
check "Contains dispose() method" \
  grep -q 'dispose()' "$TERMWRAP"
check "Contains findNext method" \
  grep -q 'findNext' "$TERMWRAP"
check "Contains findPrevious method" \
  grep -q 'findPrevious' "$TERMWRAP"

echo ""
echo "── TerminalBlock (src/components/TerminalBlock.tsx) ──"
check "Imports TermWrap from ../lib/termwrap" \
  grep -q "from ['\"]../lib/termwrap['\"]" "$TERMINAL_BLOCK"
check "Contains terminal_resize invoke" \
  grep -q 'terminal_resize' "$TERMINAL_BLOCK"
check "Contains search UI (findNext)" \
  grep -q 'findNext' "$TERMINAL_BLOCK"
check "Contains search state (searchOpen or searchQuery)" \
  grep -q 'search' "$TERMINAL_BLOCK"
check_not "Does NOT contain _renderService" \
  grep -q '_renderService' "$TERMINAL_BLOCK"
check_not "Does NOT contain retryFit" \
  grep -q 'retryFit' "$TERMINAL_BLOCK"

echo ""
echo "── BlockLayout (src/components/BlockLayout.tsx) ──"
check "Imports TerminalBlock (not Terminal)" \
  grep -q 'TerminalBlock' "$BLOCK_LAYOUT"
check_not "Does NOT import old Terminal component" \
  grep -q "from ['\"]./Terminal['\"]" "$BLOCK_LAYOUT"

echo ""
echo "── Negative: legacy code removed ──"
check_not "Terminal.tsx does NOT exist" \
  test -f "$PROJECT_DIR/src/components/Terminal.tsx"
check_not "No file in src/ contains _core._renderService" \
  grep -rq '_core._renderService' "$PROJECT_DIR/src/"
check_not "No file in src/ contains retryFit" \
  grep -rq 'retryFit' "$PROJECT_DIR/src/"

echo ""
echo "── Package.json: addon deps ──"
check "Contains @xterm/addon-webgl" \
  grep -q '@xterm/addon-webgl' "$PACKAGE_JSON"
check "Contains @xterm/addon-search" \
  grep -q '@xterm/addon-search' "$PACKAGE_JSON"
check "Contains @xterm/addon-serialize" \
  grep -q '@xterm/addon-serialize' "$PACKAGE_JSON"

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

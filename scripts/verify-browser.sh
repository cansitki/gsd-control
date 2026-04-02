#!/usr/bin/env bash
# verify-browser.sh — Validates Browser Block implementation (M005/S04):
#   - Tauri webview capabilities in default.json
#   - BrowserBlock component: imports, position sync, lifecycle, navigation, observability
#   - Block creation UI: BlockLayout dropdown, Sidebar context menu
#   - Negative: no confirm()/alert() in BrowserBlock
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

echo "=== Browser Block Verification ==="
echo ""

echo "── Tauri Capabilities (src-tauri/capabilities/default.json) ──"
check "allow-create-webview" \
  grep -q 'allow-create-webview' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-set-webview-position" \
  grep -q 'allow-set-webview-position' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-set-webview-size" \
  grep -q 'allow-set-webview-size' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-webview-close" \
  grep -q 'allow-webview-close' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-webview-hide" \
  grep -q 'allow-webview-hide' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-webview-show" \
  grep -q 'allow-webview-show' "$PROJECT_DIR/src-tauri/capabilities/default.json"
check "allow-set-webview-focus" \
  grep -q 'allow-set-webview-focus' "$PROJECT_DIR/src-tauri/capabilities/default.json"

echo ""
echo "── BrowserBlock Imports ──"
check "imports Webview from @tauri-apps/api/webview" \
  grep -q "Webview.*@tauri-apps/api/webview" "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "imports getCurrentWindow" \
  grep -q 'getCurrentWindow' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "imports LogicalPosition" \
  grep -q 'LogicalPosition' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "imports LogicalSize" \
  grep -q 'LogicalSize' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

echo ""
echo "── Position Sync ──"
check "ResizeObserver used" \
  grep -q 'ResizeObserver' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "getBoundingClientRect used" \
  grep -q 'getBoundingClientRect' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "requestAnimationFrame used" \
  grep -q 'requestAnimationFrame' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

echo ""
echo "── Webview Lifecycle ──"
check "new Webview creation" \
  grep -q 'new Webview' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "webview show" \
  grep -qE '\.show\(\)' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "webview hide" \
  grep -qE '\.hide\(\)' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "webview close" \
  grep -qE '\.close\(\)' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

echo ""
echo "── Navigation ──"
check "normalizeUrl function" \
  grep -q 'normalizeUrl' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check "updateBlock for URL sync" \
  grep -q 'updateBlock' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

echo ""
echo "── Observability ──"
check "addDebugLog in BrowserBlock" \
  grep -q 'addDebugLog' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

echo ""
echo "── Block Creation UI ──"
check "BlockLayout has browser block option" \
  grep -q "type.*browser" "$PROJECT_DIR/src/components/BlockLayout.tsx"
check "BlockLayout handleNewBrowser function" \
  grep -q 'handleNewBrowser' "$PROJECT_DIR/src/components/BlockLayout.tsx"
check "Sidebar has Open in Browser option" \
  grep -q 'Open in Browser' "$PROJECT_DIR/src/components/Sidebar.tsx"
check "Sidebar creates browser type block" \
  grep -q "type: 'browser'" "$PROJECT_DIR/src/components/Sidebar.tsx"

echo ""
echo "── Negative Checks ──"
check_not "No confirm() in BrowserBlock" \
  grep -qP '\bconfirm\s*\(' "$PROJECT_DIR/src/components/BrowserBlock.tsx"
check_not "No alert() in BrowserBlock" \
  grep -qP '\balert\s*\(' "$PROJECT_DIR/src/components/BrowserBlock.tsx"

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

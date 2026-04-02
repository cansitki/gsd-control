#!/usr/bin/env bash
# verify-terminal.sh — Validates terminal direct-connect and resize changes (S02):
#   - No polling wait loop in Terminal.tsx
#   - TerminalSession has workspace/coder_user/tmux_session fields
#   - resize_terminal sends tmux resize-window via SSH
#   - open_terminal_tmux stores tmux_session in session
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

TERMINAL_TSX="$PROJECT_DIR/src/components/Terminal.tsx"
TERMINAL_RS="$PROJECT_DIR/src-tauri/src/terminal.rs"

echo "=== Terminal Direct Connect & Resize Verification ==="
echo ""

echo "── T01: Polling wait removed ──"
check_not "Terminal.tsx does NOT contain 'while (waited <' polling loop" \
  grep -q 'while (waited <' "$TERMINAL_TSX"
check_not "Terminal.tsx does NOT reference lastPollTime in polling gate" \
  grep -q 'lastPollTime' "$TERMINAL_TSX"

echo ""
echo "── T01: Terminal still invokes resize ──"
check "Terminal.tsx calls invoke(\"terminal_resize\")" \
  grep -q 'invoke("terminal_resize"' "$TERMINAL_TSX"

echo ""
echo "── T02: TerminalSession struct fields ──"
check "TerminalSession has workspace field" \
  grep -q 'pub workspace: String' "$TERMINAL_RS"
check "TerminalSession has tmux_session field" \
  grep -q 'pub tmux_session: Option<String>' "$TERMINAL_RS"
check "TerminalSession has coder_user field" \
  grep -q 'pub coder_user: String' "$TERMINAL_RS"

echo ""
echo "── T02: resize_terminal implementation ──"
check "resize_terminal contains resize-window" \
  grep -q 'resize-window' "$TERMINAL_RS"
check "resize_terminal uses real parameter names (not underscored no-op)" \
  grep -q 'fn resize_terminal' "$TERMINAL_RS"
# Verify the function uses 'id' not '_id' — non-underscored means the param is used
check_not "resize_terminal params are NOT underscored (no-op stub)" \
  grep -q '_id: &str' "$TERMINAL_RS"

echo ""
echo "── T02: open_terminal_tmux stores tmux_session ──"
check "open_terminal_tmux stores tmux_session: Some(...)" \
  grep -q 'tmux_session: Some(tmux_session' "$TERMINAL_RS"

echo ""
echo "── T02: open_terminal stores tmux_session: None ──"
check "open_terminal stores tmux_session: None" \
  grep -q 'tmux_session: None' "$TERMINAL_RS"

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

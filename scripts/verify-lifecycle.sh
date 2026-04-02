#!/usr/bin/env bash
# verify-lifecycle.sh — S02 structural verification: terminal lifecycle & polish
#   - TermWrap serialize/restore methods (T01)
#   - Terminal state cache module (T01)
#   - Paste dedup guard in TerminalBlock (T01)
#   - Deduplicated Rust terminal backend (T02)
#   - TypeScript compilation
#   - verify-terminal.sh still passes (S01 regression)
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
STATE_CACHE="$PROJECT_DIR/src/lib/terminalStateCache.ts"
TERMINAL_BLOCK="$PROJECT_DIR/src/components/TerminalBlock.tsx"
TERMINAL_RS="$PROJECT_DIR/src-tauri/src/terminal.rs"
COMMANDS_RS="$PROJECT_DIR/src-tauri/src/commands.rs"

echo "=== S02: Terminal Lifecycle & Polish Verification ==="
echo ""

echo "── TermWrap serialize/restore (T01) ──"
check "TermWrap has serialize() method" \
  grep -q 'serialize()' "$TERMWRAP"
check "TermWrap has restoreState() method" \
  grep -q 'restoreState' "$TERMWRAP"

echo ""
echo "── Terminal state cache (T01) ──"
check "terminalStateCache.ts exists" \
  test -f "$STATE_CACHE"
check "terminalStateCache exports Map-based store" \
  grep -q 'Map' "$STATE_CACHE"

echo ""
echo "── Paste dedup guard (T01) ──"
check "TerminalBlock imports terminalStateCache" \
  grep -q 'terminalStateCache' "$TERMINAL_BLOCK"
check "TerminalBlock has lastPasteData ref" \
  grep -q 'lastPasteData' "$TERMINAL_BLOCK"
check "TerminalBlock has lastPasteTime ref" \
  grep -q 'lastPasteTime' "$TERMINAL_BLOCK"

echo ""
echo "── Rust backend dedup (T02) ──"
check "terminal.rs has single open_terminal with Option<String> tmux_session" \
  grep -q 'tmux_session: Option<String>' "$TERMINAL_RS"
check_not "terminal.rs does NOT have open_terminal_tmux function" \
  grep -q 'fn open_terminal_tmux' "$TERMINAL_RS"

# Count Stdio::piped() — should be exactly 3 (stdin, stdout, stderr — once)
PIPE_COUNT=$(grep -c 'Stdio::piped()' "$TERMINAL_RS")
check "No duplicate spawn patterns (Stdio::piped count = 3)" \
  test "$PIPE_COUNT" -eq 3

check "commands.rs terminal_open calls with tmux_session: None" \
  grep -q 'None,' "$COMMANDS_RS"
check "commands.rs terminal_open_tmux calls with Some(tmux_session)" \
  grep -q 'Some(tmux_session)' "$COMMANDS_RS"
check_not "commands.rs has no remaining open_terminal_tmux call" \
  grep -q 'open_terminal_tmux' "$COMMANDS_RS"

echo ""
echo "── TypeScript compilation ──"
check "tsc --noEmit clean" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit --project "$PROJECT_DIR"

echo ""
echo "── S01 regression: verify-terminal.sh ──"
check "verify-terminal.sh still passes" \
  bash "$SCRIPT_DIR/verify-terminal.sh"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0

#!/usr/bin/env bash
# verify-ssh-mux.sh — Validates SSH multiplexing configuration from M004/S01:
#   - ssh_command() is public and centralized
#   - ControlMaster/ControlPath/ControlPersist flags present
#   - No raw Command::new("/usr/bin/ssh") outside ssh.rs
#   - terminal.rs calls ssh_command() helper
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

SSH_RS="$PROJECT_DIR/src-tauri/src/ssh.rs"
TERMINAL_RS="$PROJECT_DIR/src-tauri/src/terminal.rs"
SRC_TAURI_DIR="$PROJECT_DIR/src-tauri/src"

echo ""
echo "=== SSH Multiplexing Verification ==="
echo ""

echo "--- ssh_command() helper ---"
check "ssh_command() is pub" grep -q 'pub fn ssh_command' "$SSH_RS"

echo ""
echo "--- Multiplexing flags ---"
check "ControlMaster=auto present" grep -q 'ControlMaster=auto' "$SSH_RS"
check "ControlPath=/tmp/ssh-mux- present" grep -q 'ControlPath=/tmp/ssh-mux-' "$SSH_RS"
check "ControlPersist=600 present" grep -q 'ControlPersist=600' "$SSH_RS"

echo ""
echo "--- terminal.rs uses helper ---"
check_not "No raw Command::new(\"/usr/bin/ssh\") in terminal.rs" grep -q 'Command::new("/usr/bin/ssh")' "$TERMINAL_RS"
check "open_terminal calls ssh_command()" grep -q 'ssh_command()' "$TERMINAL_RS"

echo ""
echo "--- Codebase-wide SSH command audit ---"
# Exactly 1 file in src-tauri/src/ should contain Command::new("/usr/bin/ssh") — ssh.rs only
RAW_COUNT=$(grep -rl 'Command::new("/usr/bin/ssh")' "$SRC_TAURI_DIR" | wc -l | tr -d ' ')
check "Exactly 1 file has Command::new(\"/usr/bin/ssh\") (ssh.rs)" test "$RAW_COUNT" -eq 1

echo ""
echo "--- TypeScript compilation ---"
check "tsc --noEmit passes" node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

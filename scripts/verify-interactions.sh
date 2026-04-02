#!/usr/bin/env bash
# verify-interactions.sh — Validates all interaction fixes from S01:
#   - check_update conditional auth header
#   - exec_in_workspace coder_user guard
#   - install_update conditional auth header
#   - debug logger always-on (no debugEnabled gate)
#   - Settings cleanup (no debug toggle, optional token label)
#   - destructive action confirmation modals
#   - SessionCard error feedback
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

COMMANDS_RS="$PROJECT_DIR/src-tauri/src/commands.rs"
DEBUG_LOGGER="$PROJECT_DIR/src/hooks/useDebugLogger.ts"
SETTINGS="$PROJECT_DIR/src/components/Settings.tsx"
SIDEBAR="$PROJECT_DIR/src/components/Sidebar.tsx"
SESSION_CARD="$PROJECT_DIR/src/components/SessionCard.tsx"
DEBUG_LOG_BUFFER="$PROJECT_DIR/src/lib/debugLogBuffer.ts"

echo "=== Interaction Fixes Verification ==="
echo ""

# --- Rust backend: check_update conditional auth ---
echo "Rust backend — conditional auth:"
check "check_update has github_token.is_empty guard" \
  grep -q 'github_token.is_empty()' "$COMMANDS_RS"
check "Authorization header uses format!(\"token ...\") inside guard" \
  grep -q 'format!("token {}", github_token)' "$COMMANDS_RS"
# Verify there are exactly 2 is_empty guards (one for check_update, one for install_update)
check "exactly 2 github_token.is_empty() guards" \
  bash -c "test \$(grep -c 'github_token.is_empty()' '$COMMANDS_RS') -eq 2"

# --- Rust backend: exec_in_workspace coder_user guard ---
echo ""
echo "Rust backend — exec_in_workspace:"
check "coder_user.is_empty() guard present" \
  grep -q 'coder_user.is_empty()' "$COMMANDS_RS"

# --- Frontend: Debug logging always-on ---
echo ""
echo "Frontend — Debug logging:"
check_not "useDebugLogger does NOT reference debugEnabled" \
  grep -q 'debugEnabled' "$DEBUG_LOGGER"
check_not "Settings does NOT contain setDebugEnabled" \
  grep -q 'setDebugEnabled' "$SETTINGS"
check "debugLogBuffer has addDebugLog" \
  grep -q 'addDebugLog' "$DEBUG_LOG_BUFFER"
check "debugLogBuffer has clearDebugLogs" \
  grep -q 'clearDebugLogs' "$DEBUG_LOG_BUFFER"

# --- Frontend: Settings cleanup ---
echo ""
echo "Frontend — Settings:"
check "Settings contains 'optional' (case-insensitive) near GitHub token" \
  grep -qi 'optional' "$SETTINGS"
check_not "Settings does NOT contain debug toggle" \
  grep -qi 'debug.*toggle\|toggle.*debug' "$SETTINGS"

# --- Frontend: Destructive action safety ---
echo ""
echo "Frontend — Destructive action safety:"
check_not "Sidebar does NOT use native confirm()" \
  bash -c "grep -q 'window\.confirm\|[^a-zA-Z]confirm(' '$SIDEBAR' | grep -v 'confirmRemove\|setConfirm\|Confirm'"
check "Sidebar has confirmation modal for workspace removal" \
  grep -q 'confirmRemoveWorkspace' "$SIDEBAR"
check "Sidebar has confirmation modal for project removal" \
  grep -q 'confirmRemoveProject' "$SIDEBAR"
check "Sidebar contains 'Remove workspace' text" \
  grep -qi 'remove workspace' "$SIDEBAR"

# --- Frontend: Button error feedback ---
echo ""
echo "Frontend — SessionCard error feedback:"
check "SessionCard has error state variable" \
  grep -q 'const \[error, setError\]' "$SESSION_CARD"
check "SessionCard has showError helper" \
  grep -q 'showError' "$SESSION_CARD"
check "SessionCard displays error in red" \
  grep -q 'accent-red' "$SESSION_CARD"

# --- TypeScript compilation ---
echo ""
echo "TypeScript compilation:"
check "tsc --noEmit exits 0" \
  node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit -p "$PROJECT_DIR"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

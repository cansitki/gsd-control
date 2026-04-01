#!/usr/bin/env bash
# verify-updater.sh — Validates all Tauri updater integration points.
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

echo "=== Tauri Updater Verification ==="
echo ""

# --- Cargo.toml ---
echo "Cargo.toml:"
check "tauri-plugin-updater crate present" \
  grep -q 'tauri-plugin-updater' "$PROJECT_DIR/src-tauri/Cargo.toml"
check "tauri-plugin-process crate present" \
  grep -q 'tauri-plugin-process' "$PROJECT_DIR/src-tauri/Cargo.toml"

# --- package.json ---
echo "package.json:"
check "@tauri-apps/plugin-updater npm package" \
  grep -q 'plugin-updater' "$PROJECT_DIR/package.json"
check "@tauri-apps/plugin-process npm package" \
  grep -q 'plugin-process' "$PROJECT_DIR/package.json"

# --- tauri.conf.json ---
echo "tauri.conf.json:"
check "createUpdaterArtifacts is true" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/tauri.conf.json'); process.exit(c.bundle.createUpdaterArtifacts===true?0:1)"
check "plugins.updater.pubkey is set" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/tauri.conf.json'); process.exit(c.plugins?.updater?.pubkey?0:1)"
check "plugins.updater.endpoints has entries" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/tauri.conf.json'); process.exit(c.plugins?.updater?.endpoints?.length>0?0:1)"

# --- capabilities ---
echo "capabilities/default.json:"
check "updater:default permission" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/capabilities/default.json'); process.exit(c.permissions.includes('updater:default')?0:1)"
check "process:allow-restart permission" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/capabilities/default.json'); process.exit(c.permissions.includes('process:allow-restart')?0:1)"

# --- lib.rs ---
echo "lib.rs:"
check "tauri_plugin_updater registered" \
  grep -q 'tauri_plugin_updater' "$PROJECT_DIR/src-tauri/src/lib.rs"
check "tauri_plugin_process registered" \
  grep -q 'tauri_plugin_process' "$PROJECT_DIR/src-tauri/src/lib.rs"

# --- Frontend ---
echo "Frontend:"
check "useUpdater.ts hook exists" \
  test -f "$PROJECT_DIR/src/hooks/useUpdater.ts"
check "UpdateNotification.tsx component exists" \
  test -f "$PROJECT_DIR/src/components/UpdateNotification.tsx"
check "UpdateNotification mounted in App.tsx" \
  grep -q 'UpdateNotification' "$PROJECT_DIR/src/App.tsx"

# --- Summary ---
echo ""
TOTAL=$((PASS + FAIL))
echo "Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
  echo "❌ $FAIL check(s) FAILED"
  exit 1
else
  echo "✅ All checks passed"
  exit 0
fi

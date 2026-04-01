#!/usr/bin/env bash
# verify-ci.sh — Validates GitHub Actions release workflow structure
# and config consistency across package.json, tauri.conf.json, Cargo.toml.
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

WORKFLOW="$PROJECT_DIR/.github/workflows/release.yml"

echo "=== CI Pipeline Verification ==="
echo ""

# --- Workflow file existence ---
echo "Workflow file:"
check "release.yml exists" test -f "$WORKFLOW"

# --- Trigger ---
echo "Trigger:"
check "push trigger present" grep -q 'push:' "$WORKFLOW"
check "tags filter with v* pattern" grep -q "v\*" "$WORKFLOW"

# --- Permissions ---
echo "Permissions:"
check "contents: write permission" grep -q 'contents: write' "$WORKFLOW"

# --- Matrix ---
echo "Matrix:"
check "aarch64-apple-darwin target" grep -q 'aarch64-apple-darwin' "$WORKFLOW"
check "x86_64-apple-darwin target" grep -q 'x86_64-apple-darwin' "$WORKFLOW"

# --- Actions ---
echo "Actions:"
check "actions/checkout@v4" grep -q 'actions/checkout@v4' "$WORKFLOW"
check "actions/setup-node@v4" grep -q 'actions/setup-node@v4' "$WORKFLOW"
check "dtolnay/rust-toolchain@stable" grep -q 'dtolnay/rust-toolchain@stable' "$WORKFLOW"
check "swatinem/rust-cache@v2" grep -q 'swatinem/rust-cache@v2' "$WORKFLOW"
check "tauri-apps/tauri-action@v0" grep -q 'tauri-apps/tauri-action@v0' "$WORKFLOW"

# --- Signing ---
echo "Signing:"
check "TAURI_SIGNING_PRIVATE_KEY env ref" grep -q 'TAURI_SIGNING_PRIVATE_KEY' "$WORKFLOW"
check "GITHUB_TOKEN env ref" grep -q 'GITHUB_TOKEN' "$WORKFLOW"

# --- Release config ---
echo "Release config:"
check "tagName: v__VERSION__" grep -q 'v__VERSION__' "$WORKFLOW"
check "releaseDraft: false" grep -q 'releaseDraft: false' "$WORKFLOW"
check "prerelease: false" grep -q 'prerelease: false' "$WORKFLOW"

# --- Dependencies ---
echo "Dependencies:"
check "npm ci (not yarn)" grep -q 'npm ci' "$WORKFLOW"

# --- tauri.conf.json ---
echo "tauri.conf.json:"
check "createUpdaterArtifacts is true" \
  node -e "const c=require('$PROJECT_DIR/src-tauri/tauri.conf.json'); process.exit(c.bundle.createUpdaterArtifacts===true?0:1)"

# --- Version consistency ---
echo "Version consistency:"
check "package.json version matches tauri.conf.json" \
  node -e "
    const pkg=require('$PROJECT_DIR/package.json');
    const tauri=require('$PROJECT_DIR/src-tauri/tauri.conf.json');
    process.exit(pkg.version===tauri.version?0:1);
  "

check "Cargo.toml version matches package.json" \
  node -e "
    const fs=require('fs');
    const pkg=require('$PROJECT_DIR/package.json');
    const cargo=fs.readFileSync('$PROJECT_DIR/src-tauri/Cargo.toml','utf8');
    const m=cargo.match(/^version\s*=\s*\"([^\"]+)\"/m);
    process.exit(m && m[1]===pkg.version?0:1);
  "

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

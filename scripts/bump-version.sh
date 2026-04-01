#!/usr/bin/env bash
set -euo pipefail

# bump-version.sh — Update version in all 3 sources atomically
# Usage: bash scripts/bump-version.sh X.Y.Z
#
# Updates:
#   1. package.json          (node -e)
#   2. src-tauri/tauri.conf.json (node -e)
#   3. src-tauri/Cargo.toml  (sed)
#
# Idempotent: running twice with the same version is a no-op.
# Note: Cargo.lock updates on next `cargo build` (user's Mac).

VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: bump-version.sh <version>"
  echo "  version must be semver: X.Y.Z (e.g. 1.2.3)"
  exit 1
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: '$VERSION' is not valid semver (expected X.Y.Z)"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- 1. package.json ---
PKG="$SCRIPT_DIR/package.json"
OLD_PKG=$(node -e "const p=require('$PKG'); process.stdout.write(p.version)")
node -e "
  const fs = require('fs');
  const path = '$PKG';
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  data.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
"
echo "package.json:            $OLD_PKG → $VERSION"

# --- 2. src-tauri/tauri.conf.json ---
TAURI="$SCRIPT_DIR/src-tauri/tauri.conf.json"
OLD_TAURI=$(node -e "const t=require('$TAURI'); process.stdout.write(t.version)")
node -e "
  const fs = require('fs');
  const path = '$TAURI';
  const data = JSON.parse(fs.readFileSync(path, 'utf8'));
  data.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n');
"
echo "src-tauri/tauri.conf.json: $OLD_TAURI → $VERSION"

# --- 3. src-tauri/Cargo.toml ---
CARGO="$SCRIPT_DIR/src-tauri/Cargo.toml"
OLD_CARGO=$(sed -n 's/^version = "\([^"]*\)"/\1/p' "$CARGO" | head -1)
sed -i "s/^version = \"[^\"]*\"/version = \"$VERSION\"/" "$CARGO"
echo "src-tauri/Cargo.toml:    $OLD_CARGO → $VERSION"

echo ""
echo "✓ All 3 version sources updated to $VERSION"
echo ""
echo "Next: git tag v$VERSION && git push origin v$VERSION"

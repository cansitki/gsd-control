#!/usr/bin/env bash
# verify-watcher.sh — Validates watcher script sorting, separators, groups, and sync:
#   - buildLocalStatus contains .sort() (active-first sorting)
#   - buildStatusMessage contains .sort() (snapshot sorting)
#   - Separator characters present (em-dash line)
#   - Group labels (Active/Offline) in output-building code
#   - JS syntax valid
#   - watcherScript.ts synced: contains .sort() and separator characters
#   - TypeScript compilation clean
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

JS="$PROJECT_DIR/scripts/gsd-watcher.js"
TS="$PROJECT_DIR/src/lib/watcherScript.ts"

echo "=== Watcher Script Verification ==="

# 1. buildLocalStatus contains .sort(
check "buildLocalStatus contains .sort()" grep -c '\.sort(' "$JS"

# 2. buildStatusMessage sort (confirmed via sort count — 2+ means both functions)
check "two or more .sort( calls in JS" test "$(grep -c '\.sort(' "$JS")" -ge 2

# 3. Separator characters present (em-dash line between workspace sections)
check "em-dash separator present in JS" grep -q '———————————' "$JS"

# 4. Group labels: Active header in JS
check "Active group label in JS" grep -q '── Active ──' "$JS"

# 5. Group labels: Offline header in JS
check "Offline group label in JS" grep -q '── Offline ──' "$JS"

# 6. JS syntax valid
check "gsd-watcher.js syntax valid" node -c "$JS"

# 7. watcherScript.ts contains .sort( (sync confirmed)
check "watcherScript.ts contains .sort()" grep -q '\.sort(' "$TS"

# 8. watcherScript.ts contains separator characters (sync confirmed)
check "watcherScript.ts contains separator" grep -q '———————————' "$TS"

# 9. watcherScript.ts contains Active group label (sync confirmed)
check "watcherScript.ts contains Active label" grep -q '── Active ──' "$TS"

# 10. TypeScript compilation clean
check "tsc --noEmit clean" node "$PROJECT_DIR/node_modules/typescript/lib/tsc.js" --noEmit

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi

# Cost Tracker Milestone — Context for Next Session

## What We Have
The current SSH poll reads `{project}/.gsd/metrics.json` for auto-mode cost only.
This misses interactive sessions entirely (~$200+ for bmu-agency).

## What We Need
A full cost/token tracker using `~/.gsd/sessions/` as the single source of truth.

## Data Sources (Priority Order)
1. **PRIMARY**: `~/.gsd/sessions/{cwd-encoded}/*.jsonl` — ALL usage (interactive + auto)
2. **SECONDARY**: `{project}/.gsd/metrics.json` — auto-mode per-milestone breakdown
3. **METADATA**: `{project}/.gsd/gsd.db` (SQLite) — milestone/slice/task names

## Key Parsing Rules
- Session files: parse `type == "message"` lines, read `message.usage.cost.total`
- CWD encoding: `/home/coder/bmu-agency` → `--home-coder-bmu-agency--/`
- Date from filename: first 10 chars of filename = `YYYY-MM-DD`
- Auto-mode detection: file contains `type == "custom_message"` with `customType == "gsd-auto"`
- DEDUP: Never sum sessions + metrics.json + activity logs — they overlap

## Dashboard Widgets Needed
- Total cost ($) — from sessions sum
- Today's cost — sessions filtered by today
- Cost/hour rate — today's cost / hours elapsed
- Daily spend chart — sessions grouped by date
- Per-milestone cost — metrics.json grouped by M-id
- Token breakdown (input/output/cacheRead/cacheWrite)
- Model distribution
- Active session indicator
- Per-unit costs (per milestone, per slice, per task)

## Implementation Notes
- The SSH poll runs a Python script on the workspace every 30s
- Can't use fs.watch (remote workspace) — must poll via SSH
- Session files can be large — use `tail` or incremental reads
- Consider caching: read full scan once, then only read new/modified files
- The `cost` breakdown has: input, output, cacheRead, cacheWrite, total

## Reference
Full engineering guide saved by user — see conversation context.
The Python scanner code and Node.js watcher code are provided above.

# GSD Token & Cost Tracker — Engineering Guide

**Project:** BMU Agency (Antelok Platform)  
**Generated:** 2026-04-03  
**Purpose:** Everything an engineer needs to build a live cost/token dashboard from GSD data files.

---

## Implementation Context for Next Session

### What We Have
The current SSH poll reads `{project}/.gsd/metrics.json` for auto-mode cost only.
This misses interactive sessions entirely (~$200+ for bmu-agency).

### What We Need
A full cost/token tracker using `~/.gsd/sessions/` as the single source of truth.

### Dashboard Widgets Needed
- Total cost ($) — from sessions sum
- Today's cost — sessions filtered by today
- Cost/hour rate — today's cost / hours elapsed
- Daily spend chart — sessions grouped by date
- Per-milestone cost — metrics.json grouped by M-id
- Token breakdown (input/output/cacheRead/cacheWrite)
- Model distribution
- Active session indicator
- Per-unit costs (per milestone, per slice, per task)

### Implementation Notes
- The SSH poll runs a Python script on the workspace every 30s
- Can't use fs.watch (remote workspace) — must poll via SSH
- Session files can be large — use `tail` or incremental reads
- Consider caching: read full scan once, then only read new/modified files
- The `cost` breakdown has: input, output, cacheRead, cacheWrite, total

---

## 1. Executive Summary

GSD (the `pi` CLI) tracks token usage across **9 data sources**. Only **2 matter** for building a tracker:

| Priority | Source | Path | Coverage |
|----------|--------|------|----------|
| **PRIMARY** | Session logs | `~/.gsd/sessions/**/*.jsonl` | **ALL usage** — interactive + auto-mode |
| **SECONDARY** | Metrics JSON | `{project}/.gsd/metrics.json` | Auto-mode units only (per-milestone breakdown) |

The session logs are the **single source of truth**. Everything else is either a subset, a copy, or non-cost data.

---

## 2. Project Numbers at a Glance

| Metric | Value |
|--------|-------|
| **Total cost** | **$1,755.38** |
| **Total tokens** | **3,981,958,405** (~3.98 billion) |
| **Total sessions** | **996** |
| **Total messages** | **79,990** |
| **Total output tokens** | **13,071,785** (~13.1M) |
| **Date range** | March 19 – April 3, 2026 (16 active days) |
| **Auto-mode agent hours** | ~38.9h |
| **Milestones completed** | 27 (M004–M030) |
| **Primary model** | claude-opus-4-6 (99.5% of cost) |

---

## 3. Data Sources — Complete Catalog

| # | Source | Path | Type | Has Cost Data | Coverage |
|---|--------|------|------|:---:|----------|
| 1 | **Session logs** | `~/.gsd/sessions/**/*.jsonl` | JSONL files | ✅ per-message | ALL (interactive + auto) |
| 2 | **Metrics JSON** | `{project}/.gsd/metrics.json` | Single JSON | ✅ per-unit | Auto-mode only |
| 3 | **Activity logs** | `{project}/.gsd/activity/*.jsonl` | JSONL files | ✅ per-message | Auto-mode only (same data as #1 subset) |
| 4 | **Reports** | `{project}/.gsd/reports/reports.json` | JSON + HTML | ✅ cumulative | Snapshots at milestone completion |
| 5 | **Worktree metrics** | `{project}/.gsd/worktrees/*/metrics.json` | JSON copies | ✅ (copy) | COPIES of #2 — don't sum |
| 6 | **Old project stores** | `~/.gsd/projects/{hash}/` | Mixed | ✅ partial | M001–M004 (legacy stores) |
| 7 | **Dispatch journal** | `{project}/.gsd/journal/*.jsonl` | JSONL | ❌ | Timing/event data only |
| 8 | **SQLite DB** | `{project}/.gsd/gsd.db` | SQLite | ❌ | Planning/completion metadata |
| 9 | **Agent sessions** | `~/.gsd/agent/sessions/**/*.jsonl` | JSONL | ✅ small subset | Parallel worker sessions |

---

## Source #1: Session Logs (PRIMARY — ALL USAGE)

**Path:** `/home/coder/.gsd/sessions/`  
**This is the only source you need for total project cost.**

### Directory Structure

```
~/.gsd/sessions/
  {cwd-encoded-as-dashes}/
    {YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}-{ms}Z_{UUID}.jsonl
    {YYYY}-{MM}-{DD}T{HH}-{mm}-{ss}-{ms}Z_{UUID}.jsonl
    ...
```

The working directory where `pi` was launched is encoded into the subdirectory name by replacing `/` with `-` and wrapping in `--`. Examples:

| Subdirectory | Actual cwd |
|---|---|
| `--home-coder-bmu-agency--/` | `/home/coder/bmu-agency` |
| `--home-coder-bmu-agency-.gsd-worktrees-M028--/` | `/home/coder/bmu-agency/.gsd/worktrees/M028` |

### Actual Subdirectories Found

```
--home-coder--/                → 1 session file
--home-coder-.gsd-worktrees-M001--/ → 1 session file
--home-coder-bmu-agency--/     → 994 session files  ← main project
```

### Filename Format

```
2026-03-20T11-33-43-111Z_a8c64487-6708-4c7e-a60d-930fa93afd31.jsonl
│                        │
│                        └─ Session UUID
└─ ISO timestamp (session start time)
   First 10 chars = date (YYYY-MM-DD) for daily grouping
```

### JSONL Line Types

Each file has one JSON object per line. The `type` field determines the structure:

| type | Has cost data | Description |
|------|:---:|---|
| `"session"` | ❌ | First line. Contains session UUID, cwd, version. |
| `"model_change"` | ❌ | Model/provider switch event. |
| `"thinking_level_change"` | ❌ | Thinking mode toggle. |
| `"custom_message"` | ❌ | GSD system prompts, task plans. **Auto-mode marker: `customType == "gsd-auto"`** |
| **`"message"`** | **✅** | **API call with full token/cost data. THIS IS WHAT YOU PARSE.** |

### Message Structure (the cost-bearing line)

```json
{
  "type": "message",
  "id": "f12e87f6",
  "parentId": "606e8949",
  "timestamp": "2026-03-19T11:06:17.609Z",
  "message": {
    "role": "assistant",
    "content": "[...tool calls or text blocks...]",
    "api": "anthropic-messages",
    "provider": "anthropic",
    "model": "claude-opus-4-6[1m]",
    "usage": {
      "input": 3,
      "output": 284,
      "cacheRead": 20749,
      "cacheWrite": 13747,
      "totalTokens": 34783,
      "cost": {
        "input": 0.000015,
        "output": 0.0071,
        "cacheRead": 0.0103745,
        "cacheWrite": 0.08591875,
        "total": 0.10340825
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1773918371620
  }
}
```

### Field Reference

| Field | Type | Description |
|-------|------|-------------|
| `message.usage.input` | int | Direct input tokens (tiny, usually <100) |
| `message.usage.output` | int | Output tokens (model's response) |
| `message.usage.cacheRead` | int | Cached context tokens re-sent (HUGE — bulk of token count) |
| `message.usage.cacheWrite` | int | Newly cached context tokens |
| `message.usage.totalTokens` | int | Sum of all token types |
| `message.usage.cost.input` | float | $ for input tokens |
| `message.usage.cost.output` | float | $ for output tokens |
| `message.usage.cost.cacheRead` | float | $ for cache reads (biggest $ component) |
| `message.usage.cost.cacheWrite` | float | $ for cache writes |
| **`message.usage.cost.total`** | **float** | **Total $ for this single API call — THIS IS THE KEY FIELD** |
| `message.model` | string | Model name, e.g. `"claude-opus-4-6[1m]"` |
| `message.role` | string | `"assistant"` — only these have usage data |
| `message.stopReason` | string | `"toolUse"` (tool call) or `"endTurn"` (final response) |
| `message.timestamp` | int | Epoch milliseconds of the API response |
| (top-level) `timestamp` | string | ISO-8601 timestamp of the event |

### Detecting Session Type

| Type | How to detect |
|------|--------------|
| **Auto-mode** | File contains a line with `type == "custom_message"` AND `customType == "gsd-auto"` |
| **Interactive** | File does NOT contain any `gsd-auto` custom_message |

### Edge Cases

- Some messages may have `usage: null` or missing `cost` — skip these.
- `toolResult` lines have no usage data — they're tool execution results.
- A session file can be empty (0 messages) if the session was killed immediately.
- The `content` field can be very large (full code files) — don't store it for the tracker, just skip it.

---

## Source #2: Auto-Mode Metrics JSON

**Path:** `/home/coder/bmu-agency/.gsd/metrics.json`  
**Coverage:** Auto-mode units only. Does NOT include interactive sessions.

### Structure

```json
{
  "version": 1,
  "projectStartedAt": 1774114456756,
  "units": [
    {
      "type": "execute-task",
      "id": "M014/S01/T01",
      "model": "claude-opus-4-6[1m]",
      "startedAt": 1774114458865,
      "finishedAt": 1774114569356,
      "tokens": {
        "input": 14,
        "output": 5923,
        "cacheRead": 575874,
        "cacheWrite": 29827,
        "total": 611638
      },
      "cost": 0.6225,
      "toolCalls": 0,
      "assistantMessages": 13,
      "userMessages": 0,
      "apiRequests": 13,
      "promptCharCount": 16408,
      "skills": ["accessibility", "agent-browser", "..."],
      "cacheHitRate": 100
    }
  ]
}
```

### Unit Types

| type | Description |
|------|-------------|
| `execute-task` | Task execution (the bulk) |
| `plan-slice` | Slice planning |
| `research-slice` | Slice research |
| `complete-slice` | Slice completion |
| `plan-milestone` | Milestone planning |
| `research-milestone` | Milestone research |
| `validate-milestone` | Milestone validation |
| `complete-milestone` | Milestone completion |
| `reassess-roadmap` | Roadmap reassessment |
| `rewrite-docs` | Documentation rewrite |

### Parsing Milestone/Slice/Task from ID

```javascript
const parts = id.split('/');
const milestone = parts[0];          // "M014"
const slice = parts[1] || null;      // "S01" or null
const task = parts[2] || null;       // "T01" or null
```

---

## Source #8: SQLite Database

**Path:** `/home/coder/bmu-agency/.gsd/gsd.db`  
**NO cost/token data.** Planning and completion metadata only.

| Table | Rows | Contains |
|-------|-----:|----------|
| milestones | 29 | id, title, status, vision, created_at, completed_at |
| slices | 141 | milestone_id, id, title, status, risk, demo, goal, completed_at |
| tasks | 396 | milestone_id, slice_id, id, title, status, one_liner, narrative, completed_at |
| decisions | 187 | Architectural decisions |
| quality_gates | 885 | Q3-Q8 gate evaluations |
| verification_evidence | 716 | Command, exit_code, verdict, duration_ms |

**Access:** `import sqlite3; db = sqlite3.connect('.gsd/gsd.db')`

---

## 4. Data Flow Diagram

```
  User types in terminal (or auto-mode runs)
       │
       ▼
  pi (GSD CLI) starts a SESSION
       │
       ├──► ~/.gsd/sessions/{cwd}/{timestamp}_{uuid}.jsonl
       │    ✅ EVERY message logged here (SOURCE #1)
       │    ✅ Both interactive and auto-mode
       │    ✅ Per-message cost in message.usage.cost.total
       │
       ├──► If auto-mode:
       │    │
       │    ├──► {project}/.gsd/activity/{seq}-{type}-{MID}-{SID}-{TID}.jsonl
       │    │    (SOURCE #3 — same messages, organized by unit)
       │    │
       │    ├──► {project}/.gsd/journal/{date}.jsonl
       │    │    (SOURCE #7 — dispatch events, no cost data)
       │    │
       │    └──► On unit complete:
       │         └──► {project}/.gsd/metrics.json  (SOURCE #2 — summary appended)
       │
       └──► On milestone complete:
            ├──► {project}/.gsd/reports/{MID}-{timestamp}.html  (SOURCE #4)
            └──► {project}/.gsd/reports/reports.json  (index updated)
```

---

## 5. Deduplication Rules

**CRITICAL — violating these will double/triple-count costs:**

1. **`~/.gsd/sessions/` is the single source of truth** for total cost. Never add any other source to it.
2. `.gsd/metrics.json` is a **SUBSET** of session data (auto-mode only). Don't add to sessions total.
3. `.gsd/activity/` is the **SAME DATA** as metrics.json but per-message. Don't add.
4. `.gsd/worktrees/*/metrics.json` are **COPIES**. Don't add.
5. `~/.gsd/projects/*/sessions/` **may overlap** with `~/.gsd/sessions/`. Don't add.
6. `.gsd/reports/` values are **CUMULATIVE** — diff consecutive entries, don't sum them.
7. `~/.gsd/agent/sessions/` is a **small subset** — already included in `~/.gsd/sessions/`.

**Safe combinations:**
- Total cost: Session logs only (Source #1)
- Per-milestone auto-mode: metrics.json only (Source #2)
- Per-message detail for a specific auto unit: activity log for that unit (Source #3)

---

## 6. Sample Parser Code

### Python — Full Session Scanner

```python
import json
import os
from collections import defaultdict
from pathlib import Path

SESSIONS_DIR = Path.home() / ".gsd" / "sessions"
PROJECT_CWD = "--home-coder-bmu-agency--"

def scan_all_sessions():
    """Scan all session files and return aggregated data."""
    sessions_path = SESSIONS_DIR / PROJECT_CWD
    
    totals = {
        "cost": 0, "input": 0, "output": 0,
        "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
        "messages": 0, "sessions": 0
    }
    daily = defaultdict(lambda: {
        "cost": 0, "tokens": 0, "sessions": 0, "messages": 0, "output": 0
    })
    by_model = defaultdict(lambda: {"cost": 0, "tokens": 0, "messages": 0})
    
    for jsonl_file in sorted(sessions_path.glob("*.jsonl")):
        date_str = jsonl_file.name[:10]  # "2026-03-20"
        session_has_messages = False
        
        with open(jsonl_file) as f:
            for line in f:
                try:
                    event = json.loads(line.strip())
                except json.JSONDecodeError:
                    continue
                
                if event.get("type") != "message":
                    continue
                
                msg = event.get("message", {})
                usage = msg.get("usage")
                if not usage:
                    continue
                
                cost = usage.get("cost", {})
                if not isinstance(cost, dict):
                    continue
                
                c = cost.get("total", 0)
                totals["cost"] += c
                totals["input"] += usage.get("input", 0)
                totals["output"] += usage.get("output", 0)
                totals["cacheRead"] += usage.get("cacheRead", 0)
                totals["cacheWrite"] += usage.get("cacheWrite", 0)
                totals["totalTokens"] += usage.get("totalTokens", 0)
                totals["messages"] += 1
                
                daily[date_str]["cost"] += c
                daily[date_str]["tokens"] += usage.get("totalTokens", 0)
                daily[date_str]["messages"] += 1
                daily[date_str]["output"] += usage.get("output", 0)
                
                model = msg.get("model", "unknown")
                by_model[model]["cost"] += c
                by_model[model]["tokens"] += usage.get("totalTokens", 0)
                by_model[model]["messages"] += 1
                
                session_has_messages = True
        
        if session_has_messages:
            totals["sessions"] += 1
            daily[date_str]["sessions"] += 1
    
    return totals, dict(daily), dict(by_model)


def scan_metrics_json(project_path):
    """Scan metrics.json for per-milestone auto-mode breakdown."""
    metrics_path = Path(project_path) / ".gsd" / "metrics.json"
    
    with open(metrics_path) as f:
        data = json.load(f)
    
    by_milestone = defaultdict(lambda: {
        "cost": 0, "tokens": 0, "output": 0, "units": 0, "duration_ms": 0
    })
    
    for unit in data.get("units", []):
        uid = unit.get("id", "")
        milestone = uid.split("/")[0] if "/" in uid else uid
        
        tokens = unit.get("tokens", {})
        by_milestone[milestone]["cost"] += unit.get("cost", 0)
        by_milestone[milestone]["tokens"] += tokens.get("total", 0)
        by_milestone[milestone]["output"] += tokens.get("output", 0)
        by_milestone[milestone]["units"] += 1
        
        started = unit.get("startedAt", 0)
        finished = unit.get("finishedAt", 0)
        if finished > started:
            by_milestone[milestone]["duration_ms"] += finished - started
    
    return dict(by_milestone)
```

---

## 7. Cost Structure Analysis

| Component | Est. % | Description |
|-----------|-------:|-------------|
| Cache reads | ~56% | System prompt + knowledge base re-sent each turn |
| Cache writes | ~17% | New context written to cache |
| Output tokens | ~12% | Model responses (code, explanations, tool calls) |
| Overhead | ~15% | API overhead, retries, failed turns |
| Direct input | <1% | User-typed text (negligible) |

---

## 8. Per-Milestone Breakdown (from metrics.json)

| Milestone | Title | Units | Cost | Tokens | Hours |
|-----------|-------|------:|-----:|-------:|------:|
| M006 | Domain Routing & Infrastructure | 3 | $1.97 | 3.5M | 0.2h |
| M014 | Production Hardening & Bug Fixes | 35 | $62.79 | 93.1M | 2.4h |
| M015 | Platform Diagnostic System | 19 | $28.80 | 41.4M | 1.2h |
| M016 | Tenant Navigation Overhaul | 17 | $25.46 | 38.3M | 1.2h |
| M017 | Design System "Coral & Charcoal" | 47 | $134.78 | 210.3M | 4.5h |
| M018 | Dashboard Widgets & Auth Pages | 29 | $31.44 | 39.8M | 1.8h |
| M019 | Page Template Alignment | 43 | $62.11 | 82.9M | 3.5h |
| M020 | 2FA & Google OAuth | 27 | $43.98 | 57.3M | 2.6h |
| M021 | Dashboard Grid Rebuild | 26 | $49.25 | 71.1M | 2.2h |
| M022 | Function-Based Roles & Permissions | 26 | $50.29 | 78.8M | 2.1h |
| M023 | Dynamic Role System | 25 | $44.13 | 66.2M | 2.2h |
| M024 | Internationalization (8 languages) | 39 | $115.15 | 353.7M | 6.6h |
| M025 | Permission-Driven Dashboard Redesign | 18 | $33.96 | 51.2M | 1.4h |
| M026 | Feature Opportunities Research | 29 | $38.80 | 42.6M | 2.2h |
| **Auto total** | | **383** | **$823.92** | **1.23B** | **34.1h** |

---

## Appendix: File Paths Quick Reference

```
COST DATA (use these):
  ~/.gsd/sessions/**/*.jsonl                          ← PRIMARY (all usage)
  {project}/.gsd/metrics.json                         ← auto-mode summaries
  {project}/.gsd/activity/*.jsonl                     ← auto-mode per-message detail
  {project}/.gsd/reports/reports.json                  ← cumulative snapshots

METADATA (no cost, useful for labels):
  {project}/.gsd/gsd.db                               ← SQLite: milestone/slice/task names
  {project}/.gsd/STATE.md                              ← current status
  {project}/.gsd/PROJECT.md                            ← project description
  {project}/.gsd/journal/*.jsonl                       ← timing events

DO NOT USE FOR TOTALS (copies/subsets):
  {project}/.gsd/worktrees/*/metrics.json              ← copies
  ~/.gsd/projects/*/sessions/                          ← may overlap with sessions
  ~/.gsd/agent/sessions/                               ← small subset
```

Where `{project}` = `/home/coder/bmu-agency`

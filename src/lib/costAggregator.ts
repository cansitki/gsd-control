/**
 * Cost aggregation — reads ~/.gsd/sessions/ on remote workspaces via SSH.
 * This is the SINGLE SOURCE OF TRUTH for all cost data (interactive + auto-mode).
 *
 * Also reads {project}/.gsd/metrics.json for per-milestone breakdown (auto-mode only).
 * These two sources are NEVER summed — they represent overlapping data.
 *
 * Deduplication rules (from COST-TRACKER-CONTEXT.md):
 * - Session logs = total cost (Source #1)
 * - metrics.json = per-milestone auto-mode breakdown (Source #2, subset of #1)
 * - activity logs, worktree metrics, reports = NEVER used (copies/subsets)
 */

import { debugInvoke as invoke } from "./debugInvoke";

export interface DailyCost {
  date: string; // YYYY-MM-DD
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
}

export interface MilestoneBreakdown {
  milestone: string;
  cost: number;
  tokens: number;
  output: number;
  units: number;
  durationMs: number;
}

export interface ProjectCostSummary {
  project: string;
  workspace: string;
  daily: DailyCost[];
  totalCost: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  totalMessages: number;
  totalTokens: number;
  models: Record<string, number>; // model → cost
  firstDate: string;
  lastDate: string;
  sessionCount: number;
  autoModeCount: number;
  interactiveCount: number;
  milestones: MilestoneBreakdown[];
  scanMeta: {
    filesScanned: number;
    scanDurationMs: number;
    incremental: boolean;
  };
}

// Incremental scan state: tracks last scan time per workspace+project
const scanTimestamps: Map<string, number> = new Map();
const cachedResults: Map<string, ProjectCostSummary> = new Map();

/**
 * Python script that runs on the remote workspace via SSH.
 * Reads ~/.gsd/sessions/{cwd-encoded}/*.jsonl — the SINGLE SOURCE OF TRUTH.
 *
 * Supports incremental scanning: pass 'since' as epoch seconds to skip
 * files not modified after that time (os.path.getmtime).
 *
 * Also reads {project}/.gsd/metrics.json for per-milestone breakdown.
 *
 * Output JSON shape:
 * {
 *   sessions: { daily, totals, models, sessionCount, autoModeCount, interactiveCount, scanMeta },
 *   milestones: [ { milestone, cost, tokens, output, units, durationMs } ]
 * }
 */
const SESSION_SCANNER_SCRIPT = `
import json, glob, os, sys, time

project_path = sys.argv[1] if len(sys.argv) > 1 else ""
since = float(sys.argv[2]) if len(sys.argv) > 2 else 0

home = os.path.expanduser("~")
sessions_dir = os.path.join(home, ".gsd", "sessions")

# Encode the project cwd as the sessions subdirectory name
# /home/coder/bmu-agency → --home-coder-bmu-agency--
full_project_path = os.path.join(home, project_path) if project_path else home
cwd_encoded = "--" + full_project_path.lstrip("/").replace("/", "-") + "--"

session_path = os.path.join(sessions_dir, cwd_encoded)

# Also check worktree session dirs (same project, different cwd)
worktree_pattern = cwd_encoded.rstrip("-") + "-.gsd-worktrees-"
all_session_dirs = []
if os.path.isdir(session_path):
    all_session_dirs.append(session_path)
if os.path.isdir(sessions_dir):
    for d in os.listdir(sessions_dir):
        if d.startswith(worktree_pattern) and os.path.isdir(os.path.join(sessions_dir, d)):
            all_session_dirs.append(os.path.join(sessions_dir, d))

from collections import defaultdict

daily = defaultdict(lambda: {"cost": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "messages": 0})
models = defaultdict(float)
total = {"cost": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "messages": 0, "totalTokens": 0}
first_date = None
last_date = None
session_count = 0
auto_count = 0
interactive_count = 0
files_scanned = 0
scan_start = time.time()

for sdir in all_session_dirs:
    for f in sorted(glob.glob(os.path.join(sdir, "*.jsonl"))):
        # Incremental: skip files not modified since last scan
        if since > 0:
            try:
                mtime = os.path.getmtime(f)
                if mtime < since:
                    continue
            except:
                continue

        files_scanned += 1
        has_messages = False
        is_auto = False

        try:
            with open(f) as fh:
                for line in fh:
                    try:
                        obj = json.loads(line)
                    except:
                        continue

                    otype = obj.get("type", "")

                    # Detect auto-mode sessions
                    if otype == "custom_message" and obj.get("customType") == "gsd-auto":
                        is_auto = True
                        continue

                    if otype != "message":
                        continue

                    msg = obj.get("message", {})
                    usage = msg.get("usage")
                    if not usage:
                        continue
                    cost_obj = usage.get("cost")
                    if not isinstance(cost_obj, dict):
                        continue
                    c = cost_obj.get("total", 0)
                    if not c or c <= 0:
                        continue

                    # Extract date from top-level timestamp (ISO-8601)
                    ts = obj.get("timestamp", "")
                    day = ts[:10] if ts and len(ts) >= 10 else ""
                    if not day or day < "2020":
                        continue

                    has_messages = True
                    if first_date is None or day < first_date:
                        first_date = day
                    if last_date is None or day > last_date:
                        last_date = day

                    d = daily[day]
                    d["cost"] += c
                    inp = usage.get("input", 0)
                    out = usage.get("output", 0)
                    cr = usage.get("cacheRead", 0)
                    cw = usage.get("cacheWrite", 0)
                    tt = usage.get("totalTokens", 0)
                    d["input"] += inp
                    d["output"] += out
                    d["cacheRead"] += cr
                    d["cacheWrite"] += cw
                    d["messages"] += 1

                    total["cost"] += c
                    total["input"] += inp
                    total["output"] += out
                    total["cacheRead"] += cr
                    total["cacheWrite"] += cw
                    total["messages"] += 1
                    total["totalTokens"] += tt

                    model = msg.get("model", "unknown")
                    models[model] += c
        except:
            continue

        if has_messages:
            session_count += 1
            if is_auto:
                auto_count += 1
            else:
                interactive_count += 1

scan_ms = int((time.time() - scan_start) * 1000)

# Per-milestone breakdown from metrics.json (auto-mode only, NOT summed with session totals)
milestones = []
gsd_dir = os.path.join(home, project_path, ".gsd") if project_path else ""
metrics_path = os.path.join(gsd_dir, "metrics.json") if gsd_dir else ""
if metrics_path and os.path.isfile(metrics_path):
    try:
        with open(metrics_path) as mf:
            mdata = json.load(mf)
        by_ms = defaultdict(lambda: {"cost": 0, "tokens": 0, "output": 0, "units": 0, "duration_ms": 0})
        for unit in mdata.get("units", []):
            uid = unit.get("id", "")
            ms = uid.split("/")[0] if "/" in uid else uid
            tokens = unit.get("tokens", {})
            by_ms[ms]["cost"] += unit.get("cost", 0)
            by_ms[ms]["tokens"] += tokens.get("total", 0)
            by_ms[ms]["output"] += tokens.get("output", 0)
            by_ms[ms]["units"] += 1
            started = unit.get("startedAt", 0)
            finished = unit.get("finishedAt", 0)
            if finished > started:
                by_ms[ms]["duration_ms"] += finished - started
        milestones = [{"milestone": k, **v} for k, v in sorted(by_ms.items())]
    except:
        pass

result = {
    "sessions": {
        "daily": [{"date": k, **v} for k, v in sorted(daily.items())],
        "totals": total,
        "models": dict(models),
        "firstDate": first_date or "",
        "lastDate": last_date or "",
        "sessionCount": session_count,
        "autoModeCount": auto_count,
        "interactiveCount": interactive_count,
        "scanMeta": {
            "filesScanned": files_scanned,
            "scanDurationMs": scan_ms,
            "incremental": since > 0
        }
    },
    "milestones": milestones
}
print(json.dumps(result))
`.trim();

interface SessionScanResult {
  sessions: {
    daily: DailyCost[];
    totals: {
      cost: number;
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      messages: number;
      totalTokens: number;
    };
    models: Record<string, number>;
    firstDate: string;
    lastDate: string;
    sessionCount: number;
    autoModeCount: number;
    interactiveCount: number;
    scanMeta: {
      filesScanned: number;
      scanDurationMs: number;
      incremental: boolean;
    };
  };
  milestones: MilestoneBreakdown[];
}

/**
 * Merge incremental scan results into cached data.
 * Incremental scans only return data from modified files,
 * so we need to add new data to the existing cache.
 *
 * For simplicity and correctness, when doing incremental scans
 * we replace the full result — the Python script re-reads modified
 * files completely, so the daily aggregates for affected days are
 * already correct. We just need to merge days that weren't in the
 * incremental scan from the cache.
 */
function mergeIncremental(
  cached: ProjectCostSummary,
  fresh: ProjectCostSummary,
  wasIncremental: boolean,
): ProjectCostSummary {
  if (!wasIncremental) {
    // Full scan — just use fresh data
    return fresh;
  }

  // For incremental: the fresh data only has days from modified files.
  // We need to keep cached days that aren't in the fresh data.
  const freshDateSet = new Set(fresh.daily.map((d) => d.date));
  const mergedDaily: DailyCost[] = [
    ...cached.daily.filter((d) => !freshDateSet.has(d.date)),
    ...fresh.daily,
  ].sort((a, b) => a.date.localeCompare(b.date));

  // Recompute totals from merged daily data
  let totalCost = 0;
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let totalMessages = 0;

  for (const day of mergedDaily) {
    totalCost += day.cost;
    totalInput += day.input;
    totalOutput += day.output;
    totalCacheRead += day.cacheRead;
    totalCacheWrite += day.cacheWrite;
    totalMessages += day.messages;
  }

  // Merge model costs — take fresh for models that appear in fresh data,
  // keep cached for models that don't
  const mergedModels: Record<string, number> = { ...cached.models };
  for (const [model, cost] of Object.entries(fresh.models)) {
    mergedModels[model] = cost; // fresh replaces cached per-model
  }

  return {
    ...fresh,
    daily: mergedDaily,
    totalCost,
    totalInput,
    totalOutput,
    totalCacheRead,
    totalCacheWrite,
    totalMessages,
    models: mergedModels,
    firstDate: mergedDaily[0]?.date ?? "",
    lastDate: mergedDaily[mergedDaily.length - 1]?.date ?? "",
    // Session counts: use fresh for incremental (it only scanned modified files)
    // so we keep cached counts and add fresh delta
    sessionCount: wasIncremental
      ? cached.sessionCount + fresh.sessionCount
      : fresh.sessionCount,
    autoModeCount: wasIncremental
      ? cached.autoModeCount + fresh.autoModeCount
      : fresh.autoModeCount,
    interactiveCount: wasIncremental
      ? cached.interactiveCount + fresh.interactiveCount
      : fresh.interactiveCount,
  };
}

export async function fetchProjectCosts(
  workspace: string,
  projectPath: string,
  projectDisplayName: string,
): Promise<ProjectCostSummary | null> {
  const cacheKey = `${workspace}:${projectPath}`;

  try {
    // Incremental: use last scan time if we have cached data
    const lastScan = scanTimestamps.get(cacheKey) ?? 0;
    const sinceArg = lastScan > 0 ? String(lastScan) : "0";
    const scanStartTime = Date.now() / 1000;

    // Escape single quotes in the script for safe shell embedding
    const escaped = SESSION_SCANNER_SCRIPT.replace(/'/g, "'\\''");
    const raw = await invoke<string>("exec_in_workspace", {
      workspace,
      command: `python3 -c '${escaped}' '${projectPath}' '${sinceArg}'`,
    });

    let parsed: SessionScanResult;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return cachedResults.get(cacheKey) ?? null;
    }

    if (!parsed.sessions?.daily) {
      return cachedResults.get(cacheKey) ?? null;
    }

    const sess = parsed.sessions;
    const fresh: ProjectCostSummary = {
      project: projectDisplayName,
      workspace,
      daily: sess.daily,
      totalCost: sess.totals?.cost ?? 0,
      totalInput: sess.totals?.input ?? 0,
      totalOutput: sess.totals?.output ?? 0,
      totalCacheRead: sess.totals?.cacheRead ?? 0,
      totalCacheWrite: sess.totals?.cacheWrite ?? 0,
      totalMessages: sess.totals?.messages ?? 0,
      totalTokens: sess.totals?.totalTokens ?? 0,
      models: sess.models ?? {},
      firstDate: sess.firstDate ?? "",
      lastDate: sess.lastDate ?? "",
      sessionCount: sess.sessionCount ?? 0,
      autoModeCount: sess.autoModeCount ?? 0,
      interactiveCount: sess.interactiveCount ?? 0,
      milestones: parsed.milestones ?? [],
      scanMeta: sess.scanMeta ?? {
        filesScanned: 0,
        scanDurationMs: 0,
        incremental: false,
      },
    };

    // Merge with cache if incremental
    const cached = cachedResults.get(cacheKey);
    const result =
      cached && fresh.scanMeta.incremental
        ? mergeIncremental(cached, fresh, true)
        : fresh;

    // Update cache
    scanTimestamps.set(cacheKey, scanStartTime);
    cachedResults.set(cacheKey, result);

    return result;
  } catch {
    return cachedResults.get(cacheKey) ?? null;
  }
}

/**
 * Fetch ONLY milestone breakdown from metrics.json (no session data).
 * Use when you need per-milestone costs without re-scanning sessions.
 */
export async function fetchMilestoneBreakdown(
  workspace: string,
  projectPath: string,
): Promise<MilestoneBreakdown[]> {
  try {
    const raw = await invoke<string>("exec_in_workspace", {
      workspace,
      command: `python3 -c '
import json, os, sys
from collections import defaultdict
p = sys.argv[1]
home = os.path.expanduser("~")
mp = os.path.join(home, p, ".gsd", "metrics.json")
if not os.path.isfile(mp):
    print("[]")
    sys.exit(0)
with open(mp) as f:
    d = json.load(f)
by_ms = defaultdict(lambda: {"cost":0,"tokens":0,"output":0,"units":0,"duration_ms":0})
for u in d.get("units",[]):
    uid = u.get("id","")
    ms = uid.split("/")[0] if "/" in uid else uid
    t = u.get("tokens",{})
    by_ms[ms]["cost"] += u.get("cost",0)
    by_ms[ms]["tokens"] += t.get("total",0)
    by_ms[ms]["output"] += t.get("output",0)
    by_ms[ms]["units"] += 1
    s = u.get("startedAt",0)
    e = u.get("finishedAt",0)
    if e > s: by_ms[ms]["duration_ms"] += e - s
print(json.dumps([{"milestone":k,**v} for k,v in sorted(by_ms.items())]))
' '${projectPath}'`,
    });

    return JSON.parse(raw) as MilestoneBreakdown[];
  } catch {
    return [];
  }
}

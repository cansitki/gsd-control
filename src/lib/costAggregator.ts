/**
 * Cost aggregation — reads .gsd/activity/*.jsonl on remote workspaces via SSH.
 * Returns daily cost breakdowns, token totals, and model usage.
 *
 * This replaces the old metrics.json approach which only captured the current session.
 * Activity JSONL files are cumulative — every auto-mode iteration writes one.
 */

import { debugInvoke as invoke } from "./debugInvoke";

export interface DailyCost {
  date: string;    // YYYY-MM-DD
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  messages: number;
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
  models: Record<string, number>; // model → cost
  firstDate: string;
  lastDate: string;
}

// Python script that runs on the remote workspace.
// Reads all .gsd/activity/*.jsonl, aggregates cost/token data by day.
// Output: JSON with daily array, totals, model breakdown.
const AGGREGATION_SCRIPT = `
import json, glob, os, sys
from collections import defaultdict

project = sys.argv[1] if len(sys.argv) > 1 else ""
gsd_dir = os.path.expanduser(f"~/{project}/.gsd") if project else ""
if not os.path.isdir(gsd_dir):
    print(json.dumps({"error": "no .gsd dir", "daily": [], "totals": {}}))
    sys.exit(0)

activity_dir = os.path.join(gsd_dir, "activity")
if not os.path.isdir(activity_dir):
    print(json.dumps({"error": "no activity dir", "daily": [], "totals": {}}))
    sys.exit(0)

daily = defaultdict(lambda: {"cost": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "messages": 0})
models = defaultdict(float)
total = {"cost": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "messages": 0}
first_date = None
last_date = None

for f in sorted(glob.glob(os.path.join(activity_dir, "*.jsonl"))):
    try:
        with open(f) as fh:
            for line in fh:
                try:
                    obj = json.loads(line)
                except: continue
                if obj.get("type") != "message": continue
                msg = obj.get("message", {})
                usage = msg.get("usage", {})
                cost_obj = usage.get("cost", {})
                c = cost_obj.get("total", 0)
                if c <= 0: continue
                ts = obj.get("timestamp", "")
                day = ts[:10] if ts else ""
                if not day: continue
                if first_date is None or day < first_date: first_date = day
                if last_date is None or day > last_date: last_date = day
                d = daily[day]
                d["cost"] += c
                d["input"] += usage.get("input", 0)
                d["output"] += usage.get("output", 0)
                d["cacheRead"] += usage.get("cacheRead", 0)
                d["cacheWrite"] += usage.get("cacheWrite", 0)
                d["messages"] += 1
                total["cost"] += c
                total["input"] += usage.get("input", 0)
                total["output"] += usage.get("output", 0)
                total["cacheRead"] += usage.get("cacheRead", 0)
                total["cacheWrite"] += usage.get("cacheWrite", 0)
                total["messages"] += 1
                model = msg.get("model", "unknown")
                models[model] += c
    except: continue

result = {
    "daily": [{"date": k, **v} for k, v in sorted(daily.items())],
    "totals": total,
    "models": dict(models),
    "firstDate": first_date or "",
    "lastDate": last_date or "",
}
print(json.dumps(result))
`.trim();

export async function fetchProjectCosts(
  workspace: string,
  projectPath: string,
  projectDisplayName: string
): Promise<ProjectCostSummary | null> {
  try {
    // Escape single quotes in the script for safe shell embedding
    const escaped = AGGREGATION_SCRIPT.replace(/'/g, "'\\''");
    const raw = await invoke<string>("exec_in_workspace", {
      workspace,
      command: `python3 -c '${escaped}' '${projectPath}'`,
    });

    let parsed: {
      daily: DailyCost[];
      totals: Record<string, number>;
      models: Record<string, number>;
      firstDate: string;
      lastDate: string;
      error?: string;
    };

    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }

    if (parsed.error || !parsed.daily) return null;

    return {
      project: projectDisplayName,
      workspace,
      daily: parsed.daily,
      totalCost: parsed.totals?.cost ?? 0,
      totalInput: parsed.totals?.input ?? 0,
      totalOutput: parsed.totals?.output ?? 0,
      totalCacheRead: parsed.totals?.cacheRead ?? 0,
      totalCacheWrite: parsed.totals?.cacheWrite ?? 0,
      totalMessages: parsed.totals?.messages ?? 0,
      models: parsed.models ?? {},
      firstDate: parsed.firstDate ?? "",
      lastDate: parsed.lastDate ?? "",
    };
  } catch {
    return null;
  }
}

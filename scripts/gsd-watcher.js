#!/usr/bin/env node
// gsd-watcher.js — Telegram bot for GSD status monitoring
// Deployed to /home/coder/.gsd-watcher.js on each workspace
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WORKSPACE_NAME

const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WORKSPACE = process.env.WORKSPACE_NAME || "Unknown";
const SNAPSHOT_FILE = "/home/coder/.gsd-watcher-status.json";

if (!BOT_TOKEN || !CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  process.exit(1);
}

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;
let lastUpdateId = 0;

// ── Helpers ────────────────────────────────────────────────────────────

function telegramRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(`${API}/${method}`);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (chunk) => (buf += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(buf));
          } catch {
            resolve(buf);
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function sendMessage(text, chatId) {
  return telegramRequest("sendMessage", {
    chat_id: chatId || CHAT_ID,
    text,
    parse_mode: "Markdown",
  });
}

function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── GSD Project Discovery (local fallback) ─────────────────────────────

function findGSDProjects() {
  try {
    const result = execSync(
      'find /home/coder -maxdepth 3 -name .gsd "(" -type d -o -type l ")" 2>/dev/null',
      { encoding: "utf-8", timeout: 5000 }
    );
    return result
      .trim()
      .split("\n")
      .filter((l) => l && l !== "/home/coder/.gsd")
      .map((gsdPath) => {
        const projectDir = path.dirname(gsdPath);
        const name = path.basename(projectDir);
        let resolvedGsd = gsdPath;
        try {
          resolvedGsd = fs.realpathSync(gsdPath);
        } catch {}
        return { name, dir: projectDir, gsdDir: resolvedGsd };
      });
  } catch {
    return [];
  }
}

function parseStateMd(content) {
  if (!content) return null;
  const info = {};

  const milestoneMatch = content.match(/\*\*Active Milestone:\*\*\s*(.+)/);
  const sliceMatch = content.match(/\*\*Active Slice:\*\*\s*(.+)/);
  const phaseMatch = content.match(/\*\*Phase:\*\*\s*(.+)/);
  const reqMatch = content.match(/\*\*Requirements Status:\*\*\s*(.+)/);
  const nextMatch = content.match(/## Next Action\n([\s\S]*?)(?:\n##|$)/);

  if (milestoneMatch) info.milestone = milestoneMatch[1].trim();
  if (sliceMatch) info.slice = sliceMatch[1].trim();
  if (phaseMatch) info.phase = phaseMatch[1].trim();
  if (reqMatch) info.requirements = reqMatch[1].trim();
  if (nextMatch) info.nextAction = nextMatch[1].trim().split("\n")[0];

  const completedMs = (content.match(/^- ✅/gm) || []).length;
  const activeMs = (content.match(/^- 🔄/gm) || []).length;
  info.milestoneProgress = { completed: completedMs, active: activeMs };

  const blockerSection = content.match(/## Blockers\n([\s\S]*?)(?:\n##|$)/);
  if (blockerSection) {
    const blockerText = blockerSection[1].trim();
    if (blockerText && blockerText !== "- None") {
      info.blockers = blockerText;
    }
  }

  return Object.keys(info).length > 0 ? info : null;
}

function getAutoLock(gsdDir) {
  const lockContent = readFileOrNull(path.join(gsdDir, "auto.lock"));
  if (!lockContent) return null;
  try {
    return JSON.parse(lockContent);
  } catch {
    return null;
  }
}

function getGSDAutoStatus(projectName, gsdDir) {
  const lock = getAutoLock(gsdDir);
  if (lock && lock.pid) {
    try {
      process.kill(lock.pid, 0);
      return { status: "running", unit: lock.unitId, phase: lock.unitType };
    } catch {}
  }

  try {
    const result = execSync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
      { encoding: "utf-8", timeout: 3000 }
    );
    const sessions = result.trim().split("\n").filter(Boolean);
    const hasSession = sessions.some(
      (s) => s.includes(projectName) || s.includes("gsd-auto")
    );
    return { status: hasSession ? "running" : "stopped" };
  } catch {
    return { status: "unknown" };
  }
}

function phaseEmoji(phase) {
  if (!phase) return "❓";
  if (phase === "complete") return "✅";
  if (phase === "executing") return "⚡";
  if (phase === "planning") return "📐";
  if (phase === "researching" || phase === "research") return "🔬";
  if (phase.includes("summariz")) return "📝";
  if (phase.includes("validat")) return "🔍";
  if (phase.includes("gate")) return "🚧";
  return "🔄";
}

// ── Status: snapshot-based (all workspaces from app) ───────────────────

function readSnapshot() {
  const raw = readFileOrNull(SNAPSHOT_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function buildSnapshotStatus(snapshot) {
  const age = Date.now() - snapshot.timestamp;
  const ageMins = Math.floor(age / 60000);
  const stale = ageMins > 5;
  const ageLabel = ageMins < 1 ? "just now" : ageMins < 60 ? `${ageMins}m ago` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`;

  let msg = `📡 *All Workspaces*`;
  if (stale) msg += ` ⚠️ _stale (${ageLabel})_`;
  else msg += ` _(${ageLabel})_`;
  msg += "\n";

  for (const ws of snapshot.workspaces) {
    msg += `\n🖥 *${ws.name}*\n`;

    for (const proj of ws.projects) {
      const runIcon = proj.isRunning || proj.autoMode ? "🟢" : "⚫";
      msg += `\n${runIcon} *${proj.name}*\n`;

      if (proj.milestone) {
        const progress = proj.milestonesTotal
          ? ` (${proj.milestonesDone}/${proj.milestonesTotal})`
          : "";
        msg += `  📌 ${proj.milestone}${progress}\n`;
      }
      if (proj.slice) msg += `  🔹 ${proj.slice}\n`;
      if (proj.phase) msg += `  ${phaseEmoji(proj.phase)} Phase: ${proj.phase}\n`;
      if (proj.cost) msg += `  💰 $${proj.cost.toFixed(2)}\n`;
      if (proj.nextAction) msg += `  ➡️ _${proj.nextAction}_\n`;
    }
  }

  return msg.trim();
}

// ── Status: local fallback (this workspace only) ───────────────────────

function buildLocalStatus() {
  const projects = findGSDProjects();

  if (projects.length === 0) {
    return `📡 *${WORKSPACE}*\n\nNo GSD projects found.`;
  }

  let msg = `📡 *${WORKSPACE}* _(local only)_\n`;

  for (const proj of projects) {
    const stateMd = readFileOrNull(path.join(proj.gsdDir, "STATE.md"));
    const state = parseStateMd(stateMd);
    const auto = getGSDAutoStatus(proj.name, proj.gsdDir);

    const runIcon = auto.status === "running" ? "🟢" : "⚫";
    msg += `\n${runIcon} *${proj.name}*`;
    if (auto.status === "running" && auto.unit) {
      msg += ` — _${auto.unit}_`;
    }
    msg += "\n";

    if (state) {
      if (state.milestone) {
        const mp = state.milestoneProgress;
        const progress = mp
          ? ` (${mp.completed} done${mp.active ? `, ${mp.active} active` : ""})`
          : "";
        msg += `  📌 ${state.milestone}${progress}\n`;
      }
      if (state.slice) msg += `  🔹 ${state.slice}\n`;
      if (state.phase)
        msg += `  ${phaseEmoji(state.phase)} Phase: ${state.phase}\n`;
      if (state.requirements) msg += `  📋 ${state.requirements}\n`;
      if (state.nextAction) msg += `  ➡️ _${state.nextAction}_\n`;
      if (state.blockers)
        msg += `  🚨 *Blocker:* ${state.blockers}\n`;
    }
  }

  return msg.trim();
}

// ── Status Command (snapshot first, local fallback) ────────────────────

function buildStatusMessage() {
  // Prefer snapshot from the app (has all workspaces)
  const snapshot = readSnapshot();
  if (snapshot && (Date.now() - snapshot.timestamp) < 3600000) {
    // Snapshot is less than 1 hour old — use it
    // Also append fresh local data for THIS workspace (more current than snapshot)
    let msg = buildSnapshotStatus(snapshot);

    // Add local auto.lock data that the snapshot may not have
    const projects = findGSDProjects();
    for (const proj of projects) {
      const auto = getGSDAutoStatus(proj.name, proj.gsdDir);
      if (auto.status === "running" && auto.unit) {
        // Check if snapshot already shows this project as running
        const snapshotProj = snapshot.workspaces
          .flatMap((ws) => ws.projects)
          .find((p) => p.name === proj.name || p.path?.includes(proj.name));
        if (snapshotProj && !snapshotProj.autoMode) {
          msg += `\n\n_⚡ Live: ${proj.name} auto-mode on ${auto.unit}_`;
        }
      }
    }

    return msg;
  }

  // No snapshot or too old — fall back to local-only
  return buildLocalStatus();
}

// ── Command Polling ────────────────────────────────────────────────────

let _botUsername = null;
async function getBotUsername() {
  if (_botUsername) return _botUsername;
  try {
    const result = await telegramRequest("getMe", {});
    _botUsername = result.result?.username || "bot";
  } catch {
    _botUsername = "bot";
  }
  return _botUsername;
}

async function pollUpdates() {
  try {
    const result = await telegramRequest("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ["message"],
    });

    if (!result.ok || !result.result) return;

    for (const update of result.result) {
      lastUpdateId = update.update_id;

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = String(msg.chat.id);
      if (chatId !== CHAT_ID) continue;

      const text = msg.text.trim().toLowerCase();
      const botName = (await getBotUsername()).toLowerCase();

      if (text === "/status" || text === `/status@${botName}`) {
        const statusMsg = buildStatusMessage();
        await sendMessage(statusMsg, chatId);
      } else if (text === "/help" || text === `/help@${botName}`) {
        await sendMessage(
          `🤖 *GSD Watcher — ${WORKSPACE}*\n\n` +
            `/status — Show all project statuses\n` +
            `/help — Show this message`,
          chatId
        );
      }
    }
  } catch (err) {
    console.error("[watcher] poll error:", err.message);
  }
}

// ── File Watcher (state change notifications) ──────────────────────────

const watchedFiles = new Map();

function checkForGSDEvents() {
  const projects = findGSDProjects();

  for (const proj of projects) {
    const stateFile = path.join(proj.gsdDir, "STATE.md");
    try {
      const stat = fs.statSync(stateFile);
      const mtime = stat.mtimeMs;
      const prevMtime = watchedFiles.get(stateFile);

      if (prevMtime && mtime > prevMtime) {
        const content = readFileOrNull(stateFile);
        const state = parseStateMd(content);
        if (state && state.phase === "complete") {
          sendMessage(
            `✅ *${proj.name}* on *${WORKSPACE}*\nMilestone complete: ${state.milestone || "?"}`
          );
        }
      }

      watchedFiles.set(stateFile, mtime);
    } catch {
      // file doesn't exist yet
    }
  }
}

// ── Main Loop ──────────────────────────────────────────────────────────

async function main() {
  console.log(`[gsd-watcher] Starting for workspace: ${WORKSPACE}`);
  console.log(`[gsd-watcher] Chat ID: ${CHAT_ID}`);

  await sendMessage(
    `🔄 *GSD Watcher started* on *${WORKSPACE}*\nSend /status for project info.`
  );

  while (true) {
    await pollUpdates();
    checkForGSDEvents();
  }
}

main().catch((err) => {
  console.error("[gsd-watcher] Fatal:", err);
  process.exit(1);
});

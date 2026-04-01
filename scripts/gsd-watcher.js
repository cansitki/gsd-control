#!/usr/bin/env node
// gsd-watcher.js — Telegram bot for GSD status monitoring
// Deployed to /home/coder/.gsd-watcher.js on each workspace
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, WORKSPACE_NAME

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const WORKSPACE = process.env.WORKSPACE_NAME || "Unknown";

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

// ── GSD Project Discovery ──────────────────────────────────────────────

function findGSDProjects() {
  try {
    const result = execSync(
      "find /home/coder -maxdepth 3 -name .gsd -type d 2>/dev/null",
      { encoding: "utf-8", timeout: 5000 }
    );
    return result
      .trim()
      .split("\n")
      .filter((l) => l && l !== "/home/coder/.gsd")
      .map((gsdPath) => {
        const projectDir = path.dirname(gsdPath);
        const name = path.basename(projectDir);
        return { name, dir: projectDir, gsdDir: gsdPath };
      });
  } catch {
    return [];
  }
}

function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function parseStateMd(content) {
  if (!content) return null;
  const info = {};
  const milestoneMatch = content.match(/\*\*Active Milestone:\*\*\s*(.+)/);
  const sliceMatch = content.match(/\*\*Active Slice:\*\*\s*(.+)/);
  const phaseMatch = content.match(/\*\*Phase:\*\*\s*(.+)/);
  if (milestoneMatch) info.milestone = milestoneMatch[1].trim();
  if (sliceMatch) info.slice = sliceMatch[1].trim();
  if (phaseMatch) info.phase = phaseMatch[1].trim();
  return Object.keys(info).length > 0 ? info : null;
}

function getGSDAutoStatus(projectName) {
  try {
    const result = execSync(
      `tmux list-sessions -F '#{session_name}:#{session_activity}' 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 3000 }
    );
    const sessionName = projectName.replace(/\//g, "-");
    const match = result.split("\n").find((l) => l.startsWith(sessionName + ":"));
    if (match) return "running";
    return "stopped";
  } catch {
    return "unknown";
  }
}

// ── Status Command ─────────────────────────────────────────────────────

function buildStatusMessage() {
  const projects = findGSDProjects();

  if (projects.length === 0) {
    return `📡 *${WORKSPACE}*\n\nNo GSD projects found.`;
  }

  let msg = `📡 *${WORKSPACE}*\n\n`;

  for (const proj of projects) {
    const stateMd = readFileOrNull(path.join(proj.gsdDir, "STATE.md"));
    const state = parseStateMd(stateMd);
    const autoStatus = getGSDAutoStatus(proj.name);

    const icon = autoStatus === "running" ? "🟢" : "⚫";
    msg += `${icon} *${proj.name}*\n`;

    if (state) {
      if (state.milestone) msg += `  Milestone: ${state.milestone}\n`;
      if (state.slice) msg += `  Slice: ${state.slice}\n`;
      if (state.phase) msg += `  Phase: ${state.phase}\n`;
    }

    msg += `  Auto-mode: ${autoStatus}\n\n`;
  }

  return msg.trim();
}

// ── Polling Loop ───────────────────────────────────────────────────────

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

      // Only respond to messages from our chat
      const chatId = String(msg.chat.id);
      if (chatId !== CHAT_ID) continue;

      const text = msg.text.trim().toLowerCase();

      if (text === "/status" || text === `/status@${(await getBotUsername()).toLowerCase()}`) {
        const statusMsg = buildStatusMessage();
        await sendMessage(statusMsg, chatId);
      } else if (text === "/help" || text === `/help@${(await getBotUsername()).toLowerCase()}`) {
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

// ── File Watcher (GSD events → Telegram notifications) ────────────────

const watchedFiles = new Map(); // path → last mtime

function checkForGSDEvents() {
  const projects = findGSDProjects();

  for (const proj of projects) {
    const stateFile = path.join(proj.gsdDir, "STATE.md");
    try {
      const stat = fs.statSync(stateFile);
      const mtime = stat.mtimeMs;
      const prevMtime = watchedFiles.get(stateFile);

      if (prevMtime && mtime > prevMtime) {
        // State changed — read and notify
        const content = readFileOrNull(stateFile);
        const state = parseStateMd(content);
        if (state) {
          const phase = state.phase || "unknown";
          if (phase === "complete") {
            sendMessage(
              `✅ *${proj.name}* on *${WORKSPACE}*\nMilestone complete: ${state.milestone || "?"}`,
            );
          }
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

  // Initial greeting
  await sendMessage(`🔄 *GSD Watcher started* on *${WORKSPACE}*\nSend /status for project info.`);

  // Poll loop
  while (true) {
    await pollUpdates();
    checkForGSDEvents();
  }
}

main().catch((err) => {
  console.error("[gsd-watcher] Fatal:", err);
  process.exit(1);
});

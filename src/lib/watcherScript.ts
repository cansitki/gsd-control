// Auto-generated from scripts/gsd-watcher.js
// This is the watcher script that gets deployed to workspaces
export const WATCHER_SCRIPT = `#!/usr/bin/env node
const https = require("https");
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

const API = \`https://api.telegram.org/bot\${BOT_TOKEN}\`;
let lastUpdateId = 0;

function telegramRequest(method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(\`\${API}/\${method}\`);
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
          try { resolve(JSON.parse(buf)); }
          catch { resolve(buf); }
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

function findGSDProjects() {
  try {
    const result = execSync(
      "find /home/coder -maxdepth 3 -name .gsd -type d 2>/dev/null",
      { encoding: "utf-8", timeout: 5000 }
    );
    return result.trim().split("\\n")
      .filter((l) => l && l !== "/home/coder/.gsd")
      .map((gsdPath) => {
        const projectDir = path.dirname(gsdPath);
        const name = path.basename(projectDir);
        return { name, dir: projectDir, gsdDir: gsdPath };
      });
  } catch { return []; }
}

function readFileOrNull(filePath) {
  try { return fs.readFileSync(filePath, "utf-8"); }
  catch { return null; }
}

function parseStateMd(content) {
  if (!content) return null;
  const info = {};
  const m1 = content.match(/\\*\\*Active Milestone:\\*\\*\\s*(.+)/);
  const m2 = content.match(/\\*\\*Active Slice:\\*\\*\\s*(.+)/);
  const m3 = content.match(/\\*\\*Phase:\\*\\*\\s*(.+)/);
  if (m1) info.milestone = m1[1].trim();
  if (m2) info.slice = m2[1].trim();
  if (m3) info.phase = m3[1].trim();
  return Object.keys(info).length > 0 ? info : null;
}

function getGSDAutoStatus(projectName) {
  try {
    const result = execSync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null || true",
      { encoding: "utf-8", timeout: 3000 }
    );
    const sessionName = projectName.replace(/\\//g, "-");
    return result.split("\\n").some((l) => l.trim() === sessionName) ? "running" : "stopped";
  } catch { return "unknown"; }
}

function buildStatusMessage() {
  const projects = findGSDProjects();
  if (projects.length === 0) return "\\u{1f4e1} *" + WORKSPACE + "*\\n\\nNo GSD projects found.";

  let msg = "\\u{1f4e1} *" + WORKSPACE + "*\\n\\n";
  for (const proj of projects) {
    const stateMd = readFileOrNull(path.join(proj.gsdDir, "STATE.md"));
    const state = parseStateMd(stateMd);
    const autoStatus = getGSDAutoStatus(proj.name);
    const icon = autoStatus === "running" ? "\\u{1f7e2}" : "\\u{26ab}";
    msg += icon + " *" + proj.name + "*\\n";
    if (state) {
      if (state.milestone) msg += "  Milestone: " + state.milestone + "\\n";
      if (state.slice) msg += "  Slice: " + state.slice + "\\n";
      if (state.phase) msg += "  Phase: " + state.phase + "\\n";
    }
    msg += "  Auto-mode: " + autoStatus + "\\n\\n";
  }
  return msg.trim();
}

const watchedFiles = new Map();

function checkForGSDEvents() {
  const projects = findGSDProjects();
  for (const proj of projects) {
    const stateFile = path.join(proj.gsdDir, "STATE.md");
    try {
      const stat = fs.statSync(stateFile);
      const mtime = stat.mtimeMs;
      const prev = watchedFiles.get(stateFile);
      if (prev && mtime > prev) {
        const content = readFileOrNull(stateFile);
        const state = parseStateMd(content);
        if (state && state.phase === "complete") {
          sendMessage("\\u{2705} *" + proj.name + "* on *" + WORKSPACE + "*\\nMilestone complete: " + (state.milestone || "?"));
        }
      }
      watchedFiles.set(stateFile, mtime);
    } catch {}
  }
}

let _botUsername = null;
async function getBotUsername() {
  if (_botUsername) return _botUsername;
  try {
    const r = await telegramRequest("getMe", {});
    _botUsername = r.result?.username || "bot";
  } catch { _botUsername = "bot"; }
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
      if (text === "/status" || text === "/status@" + botName) {
        await sendMessage(buildStatusMessage(), chatId);
      } else if (text === "/help" || text === "/help@" + botName) {
        await sendMessage("\\u{1f916} *GSD Watcher \\u{2014} " + WORKSPACE + "*\\n\\n/status \\u{2014} Show all project statuses\\n/help \\u{2014} Show this message", chatId);
      }
    }
  } catch (err) {
    console.error("[watcher] poll error:", err.message);
  }
}

async function main() {
  console.log("[gsd-watcher] Starting for workspace: " + WORKSPACE);
  await sendMessage("\\u{1f504} *GSD Watcher started* on *" + WORKSPACE + "*\\nSend /status for project info.");
  while (true) {
    await pollUpdates();
    checkForGSDEvents();
  }
}

main().catch((err) => { console.error("[gsd-watcher] Fatal:", err); process.exit(1); });
`;

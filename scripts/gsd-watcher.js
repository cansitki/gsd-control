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
        timeout: method === "getUpdates" ? 35000 : 10000,
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
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`telegramRequest ${method} timed out`));
    });
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

function sendMessageHTML(text, chatId, replyMarkup) {
  const body = {
    chat_id: chatId || CHAT_ID,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest("sendMessage", body);
}

function editMessageText(chatId, messageId, text, replyMarkup) {
  const body = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  return telegramRequest("editMessageText", body);
}

function answerCallbackQuery(callbackQueryId, text) {
  const body = { callback_query_id: callbackQueryId };
  if (text) body.text = text;
  return telegramRequest("answerCallbackQuery", body);
}

function readFileOrNull(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

// ── Terminal Capture ────────────────────────────────────────────────────

function stripAnsi(str) {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function findTmuxSession(projectName) {
  try {
    const result = execSync(
      "tmux list-sessions -F '#{session_name}' 2>/dev/null",
      { encoding: "utf-8", timeout: 3000 }
    );
    const sessions = result.trim().split("\n").filter(Boolean);
    // Exact match first, then substring match
    const exact = sessions.find((s) => s === projectName);
    if (exact) return exact;
    const partial = sessions.find((s) => s.includes(projectName));
    return partial || null;
  } catch {
    return null;
  }
}

function captureTmuxOutput(sessionName) {
  try {
    const raw = execSync(
      `tmux capture-pane -t '${sessionName}' -p -J 2>/dev/null`,
      { encoding: "utf-8", timeout: 5000 }
    );
    return stripAnsi(raw).trimEnd();
  } catch {
    return null;
  }
}

// ── Live Feed State ────────────────────────────────────────────────────

const MAX_CONTENT_LEN = 4000; // 4096 limit minus header + <pre></pre> overhead
const LIVE_LOOP_DELAY_MS = 500; // delay between edit-complete and next capture
const MAX_CONSECUTIVE_FAILURES = 5;

let liveFeed = null; // { project, session, chatId, messageId, timerId, lastContent, failCount, stopped }

function liveFeedButtons() {
  return {
    inline_keyboard: [
      [
        { text: "⏹ Stop", callback_data: "live_stop" },
        { text: "📋 Sessions", callback_data: "live_sessions" },
      ],
    ],
  };
}

async function sendSessionList(chatId) {
  const projects = findGSDProjects();
  const sessions = [];
  for (const proj of projects) {
    const sess = findTmuxSession(proj.name);
    if (sess) sessions.push({ name: proj.name, session: sess });
  }
  if (sessions.length === 0) {
    await sendMessage("No active tmux sessions found.", chatId);
    return;
  }
  const buttons = sessions.map((s) => [
    { text: `📺 ${s.name}`, callback_data: `live_select:${s.name}` },
  ]);
  await sendMessageHTML(
    "<b>Active Sessions</b>\nSelect a project to stream:",
    chatId,
    { inline_keyboard: buttons }
  );
}

async function startLiveFeed(projectName, chatId) {
  // Stop any existing feed first (R038: one feed at a time)
  if (liveFeed) {
    stopLiveFeed();
  }

  // Validate project name against discovered projects
  const projects = findGSDProjects();
  const proj = projects.find(
    (p) => p.name.toLowerCase() === projectName.toLowerCase()
  );
  if (!proj) {
    await sendMessage(
      `No GSD project "${projectName}" found.\nKnown: ${projects.map((p) => p.name).join(", ") || "none"}`,
      chatId
    );
    return;
  }

  // Find tmux session
  const session = findTmuxSession(proj.name);
  if (!session) {
    await sendMessage(
      `No tmux session found for "${proj.name}".`,
      chatId
    );
    return;
  }

  // Capture initial content
  const content = captureTmuxOutput(session);
  if (content === null) {
    await sendMessage(`Failed to capture tmux output for "${session}".`, chatId);
    return;
  }

  const truncated =
    content.length > MAX_CONTENT_LEN
      ? content.slice(content.length - MAX_CONTENT_LEN)
      : content;
  const header = `📺 <b>${escapeHtml(proj.name)}</b> — live`;
  const body = `${header}\n<pre>${escapeHtml(truncated)}</pre>`;

  const res = await sendMessageHTML(body, chatId, liveFeedButtons());
  if (!res.ok || !res.result) {
    await sendMessage("Failed to start live feed.", chatId);
    return;
  }

  const messageId = res.result.message_id;

  liveFeed = {
    project: proj.name,
    session,
    chatId,
    messageId,
    timerId: null,
    lastContent: truncated,
    failCount: 0,
    stopped: false,
  };

  // Self-scheduling loop: capture → edit → wait for response → setTimeout(next)
  async function tick() {
    if (!liveFeed || liveFeed.stopped) return;

    const output = captureTmuxOutput(liveFeed.session);
    if (output === null) {
      liveFeed.failCount++;
      if (liveFeed.failCount >= MAX_CONSECUTIVE_FAILURES) {
        console.log("[watcher] live feed: too many capture failures, stopping");
        const stopHeader = `📺 <b>${escapeHtml(liveFeed.project)}</b> — stopped (capture failed)`;
        const stopBody = `${stopHeader}\n<pre>${escapeHtml(liveFeed.lastContent || "")}</pre>`;
        await editMessageText(chatId, liveFeed.messageId, stopBody);
        stopLiveFeed();
        return;
      }
      liveFeed.timerId = setTimeout(tick, LIVE_LOOP_DELAY_MS);
      return;
    }

    const trunc =
      output.length > MAX_CONTENT_LEN
        ? output.slice(output.length - MAX_CONTENT_LEN)
        : output;

    // Skip edit if content unchanged (avoids Telegram 400 'message is not modified')
    if (trunc === liveFeed.lastContent) {
      liveFeed.timerId = setTimeout(tick, LIVE_LOOP_DELAY_MS);
      return;
    }

    liveFeed.lastContent = trunc;
    const updHeader = `📺 <b>${escapeHtml(liveFeed.project)}</b> — live`;
    const updBody = `${updHeader}\n<pre>${escapeHtml(trunc)}</pre>`;

    const editRes = await editMessageText(
      chatId,
      liveFeed.messageId,
      updBody,
      liveFeedButtons()
    );
    if (!editRes.ok) {
      liveFeed.failCount++;
      console.log(
        `[watcher] live feed edit failed (${liveFeed.failCount}/${MAX_CONSECUTIVE_FAILURES}):`,
        editRes.description || "unknown"
      );
      if (liveFeed.failCount >= MAX_CONSECUTIVE_FAILURES) {
        console.log("[watcher] live feed: too many edit failures, stopping");
        stopLiveFeed();
        return;
      }
    } else {
      liveFeed.failCount = 0;
    }

    if (liveFeed && !liveFeed.stopped) {
      liveFeed.timerId = setTimeout(tick, LIVE_LOOP_DELAY_MS);
    }
  }

  // Kick off the self-scheduling loop
  liveFeed.timerId = setTimeout(tick, LIVE_LOOP_DELAY_MS);

  console.log(
    `[watcher] live feed started: project=${proj.name} session=${session} msgId=${messageId} delay=${LIVE_LOOP_DELAY_MS}ms`
  );
}

function stopLiveFeed() {
  if (!liveFeed) return;
  liveFeed.stopped = true;
  if (liveFeed.timerId) {
    clearTimeout(liveFeed.timerId);
  }
  console.log(`[watcher] live feed stopped: project=${liveFeed.project}`);
  liveFeed = null;
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

// ── Status: snapshot reader ─────────────────────────────────────────────

function readSnapshot() {
  const raw = readFileOrNull(SNAPSHOT_FILE);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Status: local (this workspace) ─────────────────────────────────────

function buildLocalStatus() {
  const projects = findGSDProjects();

  if (projects.length === 0) {
    return `*${WORKSPACE}*\n\nNo GSD projects found.`;
  }

  // Collect project tuples with computed state
  const entries = projects.map((proj) => {
    const stateMd = readFileOrNull(path.join(proj.gsdDir, "STATE.md"));
    const state = parseStateMd(stateMd);
    const auto = getGSDAutoStatus(proj.name, proj.gsdDir);
    const isRunning = auto.status === "running";
    return { proj, state, auto, isRunning };
  });

  // Sort: active first, then alphabetical by name
  entries.sort((a, b) => {
    if (a.isRunning !== b.isRunning) return a.isRunning ? -1 : 1;
    return a.proj.name.localeCompare(b.proj.name);
  });

  const hasActive = entries.some((e) => e.isRunning);
  const hasOffline = entries.some((e) => !e.isRunning);
  const showGroups = hasActive && hasOffline;

  let msg = `*${WORKSPACE}*\n`;
  let activeHeaderDone = false;
  let offlineHeaderDone = false;

  for (const entry of entries) {
    const { proj, state, auto, isRunning } = entry;

    // Insert group headers when both groups exist
    if (showGroups && isRunning && !activeHeaderDone) {
      msg += `\n── Active ──\n`;
      activeHeaderDone = true;
    }
    if (showGroups && !isRunning && !offlineHeaderDone) {
      msg += `\n── Offline ──\n`;
      offlineHeaderDone = true;
    }

    const dot = isRunning ? "●" : "○";
    msg += `\n${dot} *${proj.name}*`;

    // Detect quick task vs milestone from auto.lock unitId
    if (isRunning && auto.unit) {
      if (auto.unit.startsWith("quick/")) {
        msg += ` — quick task`;
      }
    }
    msg += "\n";

    if (state) {
      // Milestone or quick — show what they're working on
      if (state.milestone) {
        msg += `  ${state.milestone}`;
        if (state.slice) msg += ` / ${state.slice}`;
        msg += "\n";
      }
      if (state.phase) msg += `  Phase: ${state.phase}\n`;
      if (state.nextAction) msg += `  ${state.nextAction}\n`;
      if (state.blockers) msg += `  *Blocker:* ${state.blockers}\n`;
    }
  }

  return msg.trim();
}

// ── Status Command (snapshot first, local fallback) ────────────────────

function buildStatusMessage() {
  // Always start with live local data for THIS workspace
  const localMsg = buildLocalStatus();

  // If snapshot exists and is fresh, add OTHER workspaces from it
  const snapshot = readSnapshot();
  if (snapshot && (Date.now() - snapshot.timestamp) < 3600000) {
    const age = Date.now() - snapshot.timestamp;
    const ageMins = Math.floor(age / 60000);
    const stale = ageMins > 5;
    const ageLabel = ageMins < 1 ? "just now" : ageMins < 60 ? `${ageMins}m ago` : `${Math.floor(ageMins / 60)}h ${ageMins % 60}m ago`;

    // Find other workspaces in the snapshot (not this one)
    const otherWorkspaces = snapshot.workspaces.filter(
      (ws) => ws.name !== WORKSPACE && ws.coderName !== WORKSPACE
    );

    if (otherWorkspaces.length > 0) {
      let otherMsg = stale ? `\n\n*Other Workspaces* _(${ageLabel})_` : `\n\n*Other Workspaces*`;

      for (let i = 0; i < otherWorkspaces.length; i++) {
        const ws = otherWorkspaces[i];

        // Em-dash separator between workspace sections (not before the first)
        if (i > 0) {
          otherMsg += `\n———————————`;
        }

        otherMsg += `\n\n*${ws.name}*`;

        // Sort projects: active first, then alphabetical
        const sorted = [...ws.projects].sort((a, b) => {
          const aActive = a.isRunning || a.autoMode ? 1 : 0;
          const bActive = b.isRunning || b.autoMode ? 1 : 0;
          if (aActive !== bActive) return bActive - aActive;
          return (a.name || "").localeCompare(b.name || "");
        });

        const wsHasActive = sorted.some((p) => p.isRunning || p.autoMode);
        const wsHasOffline = sorted.some((p) => !p.isRunning && !p.autoMode);
        const wsShowGroups = wsHasActive && wsHasOffline;
        let wsActiveHeaderDone = false;
        let wsOfflineHeaderDone = false;

        for (const proj of sorted) {
          const isActive = proj.isRunning || proj.autoMode;

          if (wsShowGroups && isActive && !wsActiveHeaderDone) {
            otherMsg += `\n── Active ──`;
            wsActiveHeaderDone = true;
          }
          if (wsShowGroups && !isActive && !wsOfflineHeaderDone) {
            otherMsg += `\n── Offline ──`;
            wsOfflineHeaderDone = true;
          }

          const dot = isActive ? "●" : "○";
          otherMsg += `\n${dot} *${proj.name}*\n`;
          if (proj.milestone) {
            otherMsg += `  ${proj.milestone}`;
            if (proj.slice) otherMsg += ` / ${proj.slice}`;
            otherMsg += "\n";
          }
          if (proj.phase) otherMsg += `  Phase: ${proj.phase}\n`;
          if (proj.nextAction) otherMsg += `  ${proj.nextAction}\n`;
        }
      }
      return localMsg + otherMsg;
    }
  }

  return localMsg;
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
      allowed_updates: ["message", "callback_query"],
    });

    if (!result.ok || !result.result) {
      if (!result.ok) console.error("[watcher] getUpdates not ok:", result.description || JSON.stringify(result));
      // Back off on error to prevent tight spin loop
      await new Promise((r) => setTimeout(r, 5000));
      return;
    }

    if (result.result.length > 0) {
      console.log(`[watcher] got ${result.result.length} update(s)`);
    }

    for (const update of result.result) {
      lastUpdateId = update.update_id;

      // Handle callback_query (inline button presses)
      if (update.callback_query) {
        const cb = update.callback_query;
        const cbChatId = String(cb.message?.chat?.id || "");
        if (cbChatId !== CHAT_ID) continue;

        if (cb.data === "live_stop") {
          if (liveFeed) {
            const project = liveFeed.project;
            const msgId = liveFeed.messageId;
            const lastOut = liveFeed.lastContent || "";
            stopLiveFeed();
            const stopHeader = `📺 <b>${escapeHtml(project)}</b> — stopped`;
            const stopBody = `${stopHeader}\n<pre>${escapeHtml(lastOut)}</pre>`;
            await editMessageText(cbChatId, msgId, stopBody);
            await answerCallbackQuery(cb.id, "Live feed stopped");
          } else {
            await answerCallbackQuery(cb.id, "No active live feed");
          }
        } else if (cb.data === "live_sessions") {
          if (liveFeed) {
            const project = liveFeed.project;
            const msgId = liveFeed.messageId;
            const lastOut = liveFeed.lastContent || "";
            stopLiveFeed();
            const stopHeader = `📺 <b>${escapeHtml(project)}</b> — stopped`;
            const stopBody = `${stopHeader}\n<pre>${escapeHtml(lastOut)}</pre>`;
            await editMessageText(cbChatId, msgId, stopBody);
          }
          await answerCallbackQuery(cb.id);
          await sendSessionList(cbChatId);
        } else if (cb.data.startsWith("live_select:")) {
          const projectName = cb.data.slice("live_select:".length);
          await answerCallbackQuery(cb.id, `Starting ${projectName}...`);
          await startLiveFeed(projectName, cbChatId);
        }
        continue;
      }

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = String(msg.chat.id);
      if (chatId !== CHAT_ID) {
        console.log(`[watcher] ignoring msg from chat ${chatId} (expected ${CHAT_ID})`);
        continue;
      }

      const text = msg.text.trim();
      const textLower = text.toLowerCase();
      const botName = (await getBotUsername()).toLowerCase();

      console.log(`[watcher] msg from ${chatId}: "${text}" (bot: ${botName})`);

      if (textLower === "/status" || textLower === `/status@${botName}`) {
        try {
          const statusMsg = buildStatusMessage();
          await sendMessage(statusMsg, chatId);
        } catch (err) {
          console.error("[watcher] /status error:", err.message);
          await sendMessage("Error building status.", chatId);
        }
      } else if (
        textLower === "/live stop" ||
        textLower === `/live stop@${botName}` ||
        textLower === `/live@${botName} stop`
      ) {
        if (liveFeed) {
          const project = liveFeed.project;
          const msgId = liveFeed.messageId;
          const lastOut = liveFeed.lastContent || "";
          stopLiveFeed();
          const stopHeader = `📺 <b>${escapeHtml(project)}</b> — stopped`;
          const stopBody = `${stopHeader}\n<pre>${escapeHtml(lastOut)}</pre>`;
          await editMessageText(chatId, msgId, stopBody);
          await sendMessage(`Live feed stopped for *${project}*.`, chatId);
        } else {
          await sendMessage("No active live feed.", chatId);
        }
      } else if (
        textLower.startsWith("/live ") ||
        textLower.startsWith(`/live@${botName} `)
      ) {
        // Extract project name from /live <project>
        const parts = text.split(/\s+/);
        const projectArg = parts.length > 1 ? parts.slice(1).join(" ") : "";
        if (!projectArg) {
          await sendMessage("Usage: /live <project> or /live stop", chatId);
        } else {
          await startLiveFeed(projectArg, chatId);
        }
      } else if (textLower === "/live" || textLower === `/live@${botName}`) {
        await sendSessionList(chatId);
      } else if (textLower === "/help" || textLower === `/help@${botName}`) {
        await sendMessage(
          `*GSD Watcher — ${WORKSPACE}*\n\n` +
            `/status — Show all project statuses\n` +
            `/live — Show active sessions to stream\n` +
            `/live <project> — Stream tmux output live\n` +
            `/live stop — Stop the live feed\n` +
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
            `*${proj.name}* on *${WORKSPACE}*\nMilestone complete: ${state.milestone || "?"}`
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

  // Verify token before entering the poll loop
  try {
    const me = await telegramRequest("getMe", {});
    if (!me.ok) {
      console.error(`[gsd-watcher] FATAL: Bot token is invalid (${me.description || "Unauthorized"}). Redeploy from GSD Control app with a valid token.`);
      process.exit(1);
    }
    console.log(`[gsd-watcher] Authenticated as @${me.result.username}`);
  } catch (err) {
    console.error(`[gsd-watcher] FATAL: Cannot reach Telegram API: ${err.message}`);
    process.exit(1);
  }

  // Register bot commands so Telegram shows them in the / menu
  try {
    await telegramRequest("setMyCommands", {
      commands: [
        { command: "status", description: "Show all project statuses" },
        { command: "live", description: "Stream tmux terminal output" },
        { command: "help", description: "Show available commands" },
      ],
    });
    console.log("[gsd-watcher] Bot commands registered");
  } catch (err) {
    console.error("[gsd-watcher] Failed to register commands:", err.message);
  }

  await sendMessage(
    `*GSD Watcher started* on *${WORKSPACE}*\nSend /status for project info.`
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

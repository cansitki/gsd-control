import type { GSDStatus, GSDEvent } from "./types";

const PATTERNS = {
  milestoneComplete: /Milestone (M\d+(?:\/S\d+)?) complete/,
  autoStop:
    /Auto-mode stopped.*Session: \$([\d,.]+) · ([\d.]+[MKk]?) tokens · (\d+) units/,
  cost: /\$([\d,.]+)/,
  tokenUsage: /R([\d.]+[MKk]) W([\d.]+[MKk])/,
  progress: /(\d+)\/(\d+) slices · task (\d+)\/(\d+)/,
  contextWindow: /([\d.]+)%\/([\d.]+[MKk])/,
  cacheHit: /(\d+)%hit/,
  taskComplete: /\* (T\d+): (.+)/,
  rateLimit: /rate.limit|429|limit.*reset/i,
  error: /error|fatal|crash|stuck|loop detected/i,
  gitBranch: /\((\w[\w\-/.]*)\)/,
  milestone: /(?:Active Milestone:|►\s*\w+\s+)(M\d+(?:\/S\d+)?)/,
  timeElapsed: /(\d+[hm]\s*\d*[ms]?\s*\d*s?)/,
  timeRemaining: /~(\d+[hm]\s*\d*[ms]?)\s*left/,
  autoMode: /AUTO|auto-mode|auto mode/i,
  completing: /► completing\s+(M\d+(?:\/S\d+)?)/,
  complete: /COMPLETE/,
  progressPercent: /(\d+)%/,
};

export function parseGSDLine(line: string): Partial<GSDStatus> {
  const updates: Partial<GSDStatus> = {};

  const costMatch = line.match(PATTERNS.cost);
  if (costMatch) {
    updates.cost = parseFloat(costMatch[1].replace(",", ""));
  }

  const tokenMatch = line.match(PATTERNS.tokenUsage);
  if (tokenMatch) {
    updates.tokensRead = tokenMatch[1];
    updates.tokensWrite = tokenMatch[2];
  }

  const progressMatch = line.match(PATTERNS.progress);
  if (progressMatch) {
    updates.sliceCurrent = parseInt(progressMatch[1]);
    updates.sliceTotal = parseInt(progressMatch[2]);
    updates.taskCurrent = parseInt(progressMatch[3]);
    updates.taskTotal = parseInt(progressMatch[4]);
  }

  const contextMatch = line.match(PATTERNS.contextWindow);
  if (contextMatch) {
    updates.contextUsagePercent = parseFloat(contextMatch[1]);
    updates.contextUsageMax = contextMatch[2];
  }

  const cacheMatch = line.match(PATTERNS.cacheHit);
  if (cacheMatch) {
    updates.cacheHitRate = parseInt(cacheMatch[1]);
  }

  const milestoneMatch = line.match(PATTERNS.milestone);
  if (milestoneMatch) {
    updates.milestone = milestoneMatch[1];
  }

  const completingMatch = line.match(PATTERNS.completing);
  if (completingMatch) {
    updates.milestone = completingMatch[1];
    updates.phase = "completing";
  }

  if (PATTERNS.complete.test(line)) {
    updates.phase = "complete";
  }

  const timeRemainingMatch = line.match(PATTERNS.timeRemaining);
  if (timeRemainingMatch) {
    updates.timeRemaining = timeRemainingMatch[1];
  }

  if (PATTERNS.autoMode.test(line)) {
    updates.autoMode = true;
  }

  return updates;
}

export function detectEvent(
  line: string,
  workspace: string,
  project: string
): GSDEvent | null {
  const milestoneComplete = line.match(PATTERNS.milestoneComplete);
  if (milestoneComplete) {
    const autoStopMatch = line.match(PATTERNS.autoStop);
    return {
      type: "milestone_complete",
      workspace,
      project,
      message: `Milestone ${milestoneComplete[1]} complete`,
      data: {
        milestone: milestoneComplete[1],
        cost: autoStopMatch ? autoStopMatch[1] : null,
        tokens: autoStopMatch ? autoStopMatch[2] : null,
        units: autoStopMatch ? autoStopMatch[3] : null,
      },
      timestamp: Date.now(),
    };
  }

  const autoStop = line.match(PATTERNS.autoStop);
  if (autoStop) {
    return {
      type: "auto_stop",
      workspace,
      project,
      message: `Auto-mode stopped. Cost: $${autoStop[1]}, Tokens: ${autoStop[2]}`,
      data: {
        cost: autoStop[1],
        tokens: autoStop[2],
        units: autoStop[3],
      },
      timestamp: Date.now(),
    };
  }

  if (PATTERNS.rateLimit.test(line)) {
    return {
      type: "rate_limit",
      workspace,
      project,
      message: `Rate limit hit`,
      data: {},
      timestamp: Date.now(),
    };
  }

  if (PATTERNS.error.test(line) && !PATTERNS.rateLimit.test(line)) {
    return {
      type: "error",
      workspace,
      project,
      message: line.trim().substring(0, 200),
      data: {},
      timestamp: Date.now(),
    };
  }

  const taskMatch = line.match(PATTERNS.taskComplete);
  if (taskMatch) {
    return {
      type: "task_complete",
      workspace,
      project,
      message: `${taskMatch[1]}: ${taskMatch[2]}`,
      data: { taskId: taskMatch[1], description: taskMatch[2] },
      timestamp: Date.now(),
    };
  }

  return null;
}

export function emptyStatus(): GSDStatus {
  return {
    milestone: null,
    slice: null,
    phase: null,
    taskCurrent: null,
    taskTotal: null,
    sliceCurrent: null,
    sliceTotal: null,
    cost: null,
    tokensRead: null,
    tokensWrite: null,
    timeElapsed: null,
    timeRemaining: null,
    contextUsagePercent: null,
    contextUsageMax: null,
    cacheHitRate: null,
    autoMode: false,
    gitBranch: null,
    lastCommitMessage: null,
    lastTaskDescription: null,
    progressPercent: null,
  };
}

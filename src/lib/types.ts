export interface WorkspaceConfig {
  coderName: string;
  displayName: string;
  projects: ProjectConfig[];
}

export interface ProjectConfig {
  path: string;
  displayName: string;
}

export interface GSDStatus {
  milestone: string | null;
  slice: string | null;
  phase: string | null;
  taskCurrent: number | null;
  taskTotal: number | null;
  sliceCurrent: number | null;
  sliceTotal: number | null;
  cost: number | null;
  tokensRead: string | null;
  tokensWrite: string | null;
  timeElapsed: string | null;
  timeRemaining: string | null;
  contextUsagePercent: number | null;
  contextUsageMax: string | null;
  cacheHitRate: number | null;
  autoMode: boolean;
  gitBranch: string | null;
  lastCommitMessage: string | null;
  lastTaskDescription: string | null;
  progressPercent: number | null;
}

export interface TmuxSessionInfo {
  name: string;
  idle: number;
  attached: boolean;
}

export interface GSDSession {
  id: string;
  workspace: string;
  project: string;
  projectPath: string;
  displayName: string;
  status: GSDStatus;
  isRunning: boolean;
  lastUpdated: number;
  logs: string[];
  tmuxSessions?: TmuxSessionInfo[];
  terminalPreview?: string[];
}

export interface SSHConnection {
  host: string;
  user: string;
  keyPath: string;
  status: "disconnected" | "connecting" | "connected" | "error" | "reconnecting";
  error: string | null;
}

export type BlockType = "terminal" | "browser" | "explorer";

export interface Block {
  id: string;
  type: BlockType;
  title: string;
  workspace: string;
  project: string;
  tmuxSession?: string;
  url?: string;
  remotePath?: string;
  isActive: boolean;
}

export interface SSHProfile {
  id: string;
  name: string;
  host: string;
  user: string;
  coderUser: string;
  // Key is stored in secrets vault, referenced by profile ID
  hasKey: boolean;
}

export interface AppConfig {
  sshProfiles: SSHProfile[];
  activeProfileId: string;
  telegram: {
    botToken: string;
    chatId: string;
  };
  notifications: {
    milestoneComplete: boolean;
    autoStop: boolean;
    errors: boolean;
    silentStop: boolean;
    rateLimitHit: boolean;
  };
  costAlertThreshold: number | null;
  githubToken: string;
}

export interface DateRange {
  preset: 'today' | 'week' | 'month' | 'all' | 'custom';
  start?: string; // YYYY-MM-DD
  end?: string;   // YYYY-MM-DD
}

export type DebugLevel = "off" | "normal" | "extreme";

export type ViewMode = "dashboard" | "terminal" | "logs" | "settings";

export interface GSDEvent {
  type:
    | "milestone_complete"
    | "auto_stop"
    | "error"
    | "silent_stop"
    | "rate_limit"
    | "task_complete"
    | "progress";
  workspace: string;
  project: string;
  message: string;
  data: Record<string, string | number | null>;
  timestamp: number;
}

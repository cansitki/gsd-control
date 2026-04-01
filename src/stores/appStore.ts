import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  SSHConnection,
  GSDSession,
  TerminalTab,
  ViewMode,
  AppConfig,
  GSDEvent,
  WorkspaceConfig,
  ProjectConfig,
} from "../lib/types";
import { emptyStatus } from "../lib/logParser";

interface AppState {
  // Connection
  connection: SSHConnection;
  setConnectionStatus: (
    status: SSHConnection["status"],
    error?: string
  ) => void;

  // Hydration
  _hasHydrated: boolean;
  _setHasHydrated: (v: boolean) => void;

  // Workspaces
  workspaces: WorkspaceConfig[];
  addProject: (coderName: string, project: ProjectConfig) => void;
  removeProject: (coderName: string, projectPath: string) => void;

  // Sessions
  sessions: Record<string, GSDSession>;
  updateSession: (id: string, updates: Partial<GSDSession>) => void;
  setSession: (session: GSDSession) => void;

  // Terminal
  terminalTabs: TerminalTab[];
  activeTerminalId: string | null;
  terminalLayout: "tabs" | "grid-2" | "grid-4" | "grid-6";
  addTerminalTab: (tab: TerminalTab) => void;
  removeTerminalTab: (id: string) => void;
  setActiveTerminal: (id: string) => void;
  updateTerminalTab: (id: string, updates: Partial<TerminalTab>) => void;
  setTerminalLayout: (layout: "tabs" | "grid-2" | "grid-4" | "grid-6") => void;

  // View
  currentView: ViewMode;
  setCurrentView: (view: ViewMode) => void;
  selectedProject: string | null;
  setSelectedProject: (id: string | null) => void;

  // Events
  events: GSDEvent[];
  addEvent: (event: GSDEvent) => void;

  // Config
  config: AppConfig;
  updateConfig: (updates: Partial<AppConfig>) => void;

  // Debug — always on
  debugLogs: string[];
  addDebugLog: (log: string) => void;
  clearDebugLogs: () => void;

  // Polling
  lastPollTime: number;
  setLastPollTime: (time: number) => void;
  workspaceHealth: Record<string, 'ok' | 'error'>;
  setWorkspaceHealth: (workspace: string, status: 'ok' | 'error') => void;
}

const DEFAULT_CONFIG: AppConfig = {
  sshProfiles: [],
  activeProfileId: "",
  telegram: {
    botToken: "",
    chatId: "",
  },
  notifications: {
    milestoneComplete: true,
    autoStop: true,
    errors: true,
    silentStop: true,
    rateLimitHit: true,
  },
  costAlertThreshold: null,
  githubToken: "",
};

const WORKSPACES: WorkspaceConfig[] = [];

export const useAppStore = create<AppState>()(persist((set) => ({
  connection: {
    host: "",
    user: "",
    keyPath: "",
    status: "disconnected",
    error: null,
  },
  setConnectionStatus: (status, error) =>
    set((state) => ({
      connection: { ...state.connection, status, error: error ?? null },
    })),

  // Hydration tracking — false until zustand finishes rehydrating from localStorage
  _hasHydrated: false,
  _setHasHydrated: (v) => set({ _hasHydrated: v }),

  workspaces: WORKSPACES,
  addProject: (coderName, project) =>
    set((state) => {
      const exists = state.workspaces.some((ws) => ws.coderName === coderName);
      if (exists) {
        return {
          workspaces: state.workspaces.map((ws) =>
            ws.coderName === coderName
              ? { ...ws, projects: [...ws.projects, project] }
              : ws
          ),
        };
      } else {
        // Create workspace with this project
        return {
          workspaces: [
            ...state.workspaces,
            { coderName, displayName: coderName, projects: [project] },
          ],
        };
      }
    }),
  removeProject: (coderName, projectPath) =>
    set((state) => ({
      workspaces: state.workspaces.map((ws) =>
        ws.coderName === coderName
          ? { ...ws, projects: ws.projects.filter((p) => p.path !== projectPath) }
          : ws
      ),
    })),

  sessions: {},
  updateSession: (id, updates) =>
    set((state) => ({
      sessions: {
        ...state.sessions,
        [id]: { ...state.sessions[id], ...updates },
      },
    })),
  setSession: (session) =>
    set((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
    })),

  terminalTabs: [],
  activeTerminalId: null,
  terminalLayout: "tabs",
  addTerminalTab: (tab) =>
    set((state) => ({
      terminalTabs: [...state.terminalTabs, tab],
      activeTerminalId: tab.id,
    })),
  removeTerminalTab: (id) =>
    set((state) => ({
      terminalTabs: state.terminalTabs.filter((t) => t.id !== id),
      activeTerminalId:
        state.activeTerminalId === id
          ? state.terminalTabs[0]?.id ?? null
          : state.activeTerminalId,
    })),
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  updateTerminalTab: (id, updates) =>
    set((state) => ({
      terminalTabs: state.terminalTabs.map((t) =>
        t.id === id ? { ...t, ...updates } : t
      ),
    })),
  setTerminalLayout: (layout) => set({ terminalLayout: layout }),

  currentView: "dashboard",
  setCurrentView: (view) => set({ currentView: view }),
  selectedProject: null,
  setSelectedProject: (id) => set({ selectedProject: id }),

  events: [],
  addEvent: (event) =>
    set((state) => ({
      events: [event, ...state.events].slice(0, 500),
    })),

  config: DEFAULT_CONFIG,
  updateConfig: (updates) =>
    set((state) => ({
      config: { ...state.config, ...updates },
    })),

  // Debug — always on, rolling log buffer
  debugLogs: [],
  addDebugLog: (log) =>
    set((state) => ({
      debugLogs: [...state.debugLogs, log].slice(-5000),
    })),
  clearDebugLogs: () => set({ debugLogs: [] }),

  // Polling
  lastPollTime: 0,
  setLastPollTime: (time) => set({ lastPollTime: time }),
  workspaceHealth: {},
  setWorkspaceHealth: (workspace, status) =>
    set((state) => ({
      workspaceHealth: { ...state.workspaceHealth, [workspace]: status },
    })),
}), {
  name: "gsd-control-v2",
  version: 2,
  storage: createJSONStorage(() => localStorage),
  onRehydrateStorage: () => (state) => {
    state?._setHasHydrated(true);
  },
  partialize: (state) => ({
    config: {
      sshProfiles: state.config.sshProfiles,
      activeProfileId: state.config.activeProfileId,
      telegram: {
        botToken: "", // stored in Stronghold
        chatId: "", // stored in Stronghold
      },
      notifications: state.config.notifications,
      costAlertThreshold: state.config.costAlertThreshold,
      githubToken: "", // stored in Stronghold
    },
    workspaces: state.workspaces,
    currentView: state.currentView,
    selectedProject: state.selectedProject,
    terminalLayout: state.terminalLayout,
  }),
}));

export function createSessionId(workspace: string, project: string): string {
  return `${workspace}:${project}`;
}

export function createEmptySession(
  workspace: string,
  project: string,
  projectPath: string,
  displayName: string
): GSDSession {
  return {
    id: createSessionId(workspace, project),
    workspace,
    project,
    projectPath,
    displayName,
    status: emptyStatus(),
    isRunning: false,
    lastUpdated: Date.now(),
    logs: [],
    tmuxSessions: [],
    terminalPreview: [],
  };
}

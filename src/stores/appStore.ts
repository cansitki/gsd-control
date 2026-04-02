import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  SSHConnection,
  GSDSession,
  Block,
  ViewMode,
  AppConfig,
  GSDEvent,
  WorkspaceConfig,
  ProjectConfig,
  DebugLevel,
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
  addWorkspace: (workspace: WorkspaceConfig) => void;
  removeWorkspace: (coderName: string) => void;
  updateWorkspace: (coderName: string, updates: Partial<WorkspaceConfig>) => void;
  addProject: (coderName: string, project: ProjectConfig) => void;
  removeProject: (coderName: string, projectPath: string) => void;

  // Sessions
  sessions: Record<string, GSDSession>;
  updateSession: (id: string, updates: Partial<GSDSession>) => void;
  setSession: (session: GSDSession) => void;

  // Blocks
  blocks: Block[];
  activeBlockId: string | null;
  blockLayout: "tabs" | "grid-2" | "grid-4" | "grid-6";
  addBlock: (block: Block) => void;
  removeBlock: (id: string) => void;
  setActiveBlock: (id: string) => void;
  updateBlock: (id: string, updates: Partial<Block>) => void;
  setBlockLayout: (layout: "tabs" | "grid-2" | "grid-4" | "grid-6") => void;

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

  // Debug
  debugLevel: DebugLevel;
  setDebugLevel: (level: DebugLevel) => void;

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
  addWorkspace: (workspace) =>
    set((state) => ({
      workspaces: [...state.workspaces, workspace],
    })),
  removeWorkspace: (coderName) =>
    set((state) => ({
      workspaces: state.workspaces.filter((ws) => ws.coderName !== coderName),
    })),
  updateWorkspace: (coderName, updates) =>
    set((state) => ({
      workspaces: state.workspaces.map((ws) =>
        ws.coderName === coderName ? { ...ws, ...updates } : ws
      ),
    })),
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

  blocks: [],
  activeBlockId: null,
  blockLayout: "tabs",
  addBlock: (block) =>
    set((state) => ({
      blocks: [...state.blocks, block],
      activeBlockId: block.id,
    })),
  removeBlock: (id) =>
    set((state) => {
      const remaining = state.blocks.filter((b) => b.id !== id);
      return {
        blocks: remaining,
        activeBlockId:
          state.activeBlockId === id
            ? remaining[0]?.id ?? null
            : state.activeBlockId,
      };
    }),
  setActiveBlock: (id) => set({ activeBlockId: id }),
  updateBlock: (id, updates) =>
    set((state) => ({
      blocks: state.blocks.map((b) =>
        b.id === id ? { ...b, ...updates } : b
      ),
    })),
  setBlockLayout: (layout) => set({ blockLayout: layout }),

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

  // Debug
  debugLevel: "normal",
  setDebugLevel: (level) => set({ debugLevel: level }),

  // Polling
  lastPollTime: 0,
  setLastPollTime: (time) => set({ lastPollTime: time }),
  workspaceHealth: {},
  setWorkspaceHealth: (workspace, status) =>
    set((state) => ({
      workspaceHealth: { ...state.workspaceHealth, [workspace]: status },
    })),
}), {
  name: "gsd-control-v3",
  version: 4,
  storage: createJSONStorage(() => localStorage),
  migrate: (persistedState: unknown, _version: number) => {
    const state = persistedState as Partial<AppState> & Record<string, unknown>;
    if (_version < 3) {
      state.debugLevel = "normal";
    }
    if (_version < 4) {
      // Rename terminalLayout → blockLayout
      if ('terminalLayout' in state) {
        state.blockLayout = state.terminalLayout as AppState['blockLayout'];
        delete state.terminalLayout;
      }
    }
    return state as Partial<AppState>;
  },
  onRehydrateStorage: () => (state) => {
    state?._setHasHydrated(true);
  },
  partialize: (state) => ({
    config: {
      sshProfiles: state.config.sshProfiles,
      activeProfileId: state.config.activeProfileId,
      telegram: {
        botToken: "", // stored in secrets vault
        chatId: "", // stored in secrets vault
      },
      notifications: state.config.notifications,
      costAlertThreshold: state.config.costAlertThreshold,
      githubToken: "", // stored in secrets vault
    },
    workspaces: state.workspaces,
    currentView: state.currentView,
    selectedProject: state.selectedProject,
    blockLayout: state.blockLayout,
    debugLevel: state.debugLevel,
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

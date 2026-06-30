import { createContext, useContext } from "react";

import type { RunStatus } from "@/types/runs";

// Progress state for a single run
export interface RunProgressState {
  runId: string;
  runName: string;
  status: RunStatus;
  progress: number;
  message: string;
  logs: string[];
  startedAt?: string;
  updatedAt: number;
}

// Context value type
export interface ActiveRunContextValue {
  /** Currently active/running runs */
  activeRuns: RunProgressState[];

  /** Whether there are any active runs */
  hasActiveRuns: boolean;

  /** Get progress for a specific run */
  getRunProgress: (runId: string) => RunProgressState | undefined;

  /** Manually refresh active runs list */
  refreshActiveRuns: () => void;

  /** Whether the floating widget is minimized */
  isMinimized: boolean;

  /** Toggle minimized state */
  toggleMinimized: () => void;

  /** Currently selected run in the widget (for multi-run support) */
  selectedRunId: string | null;

  /** Select a run to show details for */
  selectRun: (runId: string | null) => void;
}

export const ActiveRunContext = createContext<ActiveRunContextValue | undefined>(undefined);

export function useActiveRuns() {
  const context = useContext(ActiveRunContext);
  if (!context) {
    throw new Error("useActiveRuns must be used within an ActiveRunProvider");
  }
  return context;
}

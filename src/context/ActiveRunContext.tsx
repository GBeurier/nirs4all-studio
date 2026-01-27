/**
 * ActiveRunContext - Global state for tracking active training runs
 *
 * Provides:
 * - List of currently running jobs
 * - Current progress/logs for each run
 * - WebSocket connections to active runs
 * - Methods to track/untrack runs
 *
 * This enables the floating run widget to appear on any page.
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getActiveRuns, getRun } from "@/api/client";
import type { Run, RunStatus } from "@/types/runs";

// WebSocket message types
interface WsMessage {
  type: string;
  channel: string;
  data: {
    job_id?: string;
    progress?: number;
    message?: string;
    log?: string;
    level?: string;
    metrics?: Record<string, number>;
    result?: Record<string, unknown>;
    error?: string;
  };
  timestamp: string;
}

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
interface ActiveRunContextValue {
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

const ActiveRunContext = createContext<ActiveRunContextValue | undefined>(undefined);

export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const [runProgressMap, setRunProgressMap] = useState<Map<string, RunProgressState>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [wsConnections, setWsConnections] = useState<Map<string, WebSocket>>(new Map());

  // Fetch active runs periodically
  const { data: activeRunsData, refetch: refreshActiveRuns } = useQuery({
    queryKey: ["activeRuns"],
    queryFn: getActiveRuns,
    refetchInterval: 3000, // Poll every 3 seconds
    staleTime: 1000,
  });

  // Connect WebSocket for a specific run
  const connectToRun = useCallback((runId: string, runName: string, status: RunStatus) => {
    // Already connected
    if (wsConnections.has(runId)) return;

    // Only connect for running/queued runs
    if (status !== "running" && status !== "queued") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "subscribe",
          channel: `job:${runId}`,
          data: {},
        }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          if (message.channel === `job:${runId}`) {
            setRunProgressMap((prev) => {
              const existing = prev.get(runId);
              if (!existing) return prev;

              const newState = { ...existing };

              // Handle progress updates
              if (message.type === "job_progress" && message.data) {
                if (message.data.progress !== undefined) {
                  newState.progress = message.data.progress;
                }
                if (message.data.message) {
                  newState.message = message.data.message;
                }
              }

              // Handle log messages
              if (message.data?.log) {
                const newLogs = [...newState.logs, message.data.log];
                newState.logs = newLogs.slice(-50); // Keep last 50 logs
              }

              // Handle completion
              if (message.type === "job_completed") {
                newState.status = "completed";
                newState.progress = 100;
              } else if (message.type === "job_failed") {
                newState.status = "failed";
              }

              newState.updatedAt = Date.now();
              const updated = new Map(prev);
              updated.set(runId, newState);
              return updated;
            });
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        setWsConnections((prev) => {
          const updated = new Map(prev);
          updated.delete(runId);
          return updated;
        });
      };

      ws.onerror = () => {
        ws.close();
      };

      setWsConnections((prev) => {
        const updated = new Map(prev);
        updated.set(runId, ws);
        return updated;
      });
    } catch {
      // WebSocket not available
    }
  }, [wsConnections]);

  // Cleanup WebSocket for completed/failed runs
  const disconnectFromRun = useCallback((runId: string) => {
    const ws = wsConnections.get(runId);
    if (ws) {
      ws.close();
      setWsConnections((prev) => {
        const updated = new Map(prev);
        updated.delete(runId);
        return updated;
      });
    }
  }, [wsConnections]);

  // Sync active runs with our progress map
  useEffect(() => {
    if (!activeRunsData?.runs) return;

    const activeRuns = activeRunsData.runs;
    const activeRunIds = new Set(activeRuns.map(r => r.id));

    // Update progress map
    setRunProgressMap((prev) => {
      const updated = new Map(prev);

      // Add/update active runs
      for (const run of activeRuns) {
        const existing = prev.get(run.id);
        if (existing) {
          // Update status if changed
          if (existing.status !== run.status) {
            updated.set(run.id, {
              ...existing,
              status: run.status,
              updatedAt: Date.now(),
            });
          }
        } else {
          // Add new run
          updated.set(run.id, {
            runId: run.id,
            runName: run.name,
            status: run.status,
            progress: 0,
            message: "Starting...",
            logs: [],
            startedAt: run.started_at,
            updatedAt: Date.now(),
          });
        }

        // Connect WebSocket
        connectToRun(run.id, run.name, run.status);
      }

      // Update status and remove completed/failed runs
      for (const [runId, state] of updated) {
        if (!activeRunIds.has(runId)) {
          // Run is no longer in active list - it has completed or failed
          if (state.status === "running" || state.status === "queued") {
            // Update status to completed (or failed via WebSocket)
            updated.set(runId, {
              ...state,
              status: "completed",
              progress: 100,
              updatedAt: Date.now(),
            });
          }

          // Remove from map after 5 seconds (allow brief display of completion)
          const elapsed = Date.now() - state.updatedAt;
          if (elapsed > 5000 && state.status !== "running" && state.status !== "queued") {
            updated.delete(runId);
            disconnectFromRun(runId);
          }
        }
      }

      return updated;
    });
  }, [activeRunsData, connectToRun, disconnectFromRun]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsConnections.forEach((ws) => ws.close());
    };
  }, [wsConnections]);

  // Convert map to array, sorted by update time
  const activeRuns = Array.from(runProgressMap.values())
    .filter((r) => r.status === "running" || r.status === "queued")
    .sort((a, b) => b.updatedAt - a.updatedAt);

  // Auto-select first run if none selected
  useEffect(() => {
    if (activeRuns.length > 0 && !selectedRunId) {
      setSelectedRunId(activeRuns[0].runId);
    } else if (activeRuns.length === 0) {
      setSelectedRunId(null);
    }
  }, [activeRuns, selectedRunId]);

  const value: ActiveRunContextValue = {
    activeRuns,
    hasActiveRuns: activeRuns.length > 0,
    getRunProgress: useCallback(
      (runId: string) => runProgressMap.get(runId),
      [runProgressMap]
    ),
    refreshActiveRuns,
    isMinimized,
    toggleMinimized: useCallback(() => setIsMinimized((prev) => !prev), []),
    selectedRunId,
    selectRun: setSelectedRunId,
  };

  return (
    <ActiveRunContext.Provider value={value}>
      {children}
    </ActiveRunContext.Provider>
  );
}

export function useActiveRuns() {
  const context = useContext(ActiveRunContext);
  if (!context) {
    throw new Error("useActiveRuns must be used within an ActiveRunProvider");
  }
  return context;
}

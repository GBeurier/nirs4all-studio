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

// Derive the same overall progress + step message the WebSocket feeds into the
// progress map, but from a polled Run object. This is the fallback path used
// while a run's WebSocket is down (3s poll): the poll must advance the same
// progress/message fields the WS writes, not just status, or the widget freezes.
function deriveRunProgress(run: Run): { progress: number; message: string } {
  const pipelines = run.datasets.flatMap((d) => d.pipelines);
  const total = run.total_pipelines ?? pipelines.length;
  const completed = pipelines.filter((p) => p.status === "completed").length;
  const running = pipelines.find((p) => p.status === "running");

  const baseProgress = total > 0 ? (completed / total) * 100 : 0;
  const runningProgress = running?.progress ?? 0;
  const runningContribution = total > 0 ? (runningProgress / 100) * (100 / total) : 0;
  const progress = Math.min(100, Math.round(baseProgress + runningContribution));

  const message = running
    ? running.current_branch
      ? `${running.pipeline_name} — ${running.current_branch}`
      : running.pipeline_name
    : run.status === "queued"
      ? "Queued..."
      : "Working...";

  return { progress, message };
}

export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const [runProgressMap, setRunProgressMap] = useState<Map<string, RunProgressState>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [wsConnections, setWsConnections] = useState<Map<string, WebSocket>>(new Map());
  const [liveWsRunIds, setLiveWsRunIds] = useState<Set<string>>(new Set());

  // Whether every active run currently has a live WebSocket feeding it updates.
  // When this is true, the WebSocket is the real-time driver and polling is only a
  // slow heartbeat; when false (WS dropped or not yet connected) we fall back to a
  // faster poll so progress still advances.
  const [allRunsHaveLiveWs, setAllRunsHaveLiveWs] = useState(true);

  // Fetch active runs as a fallback heartbeat. WebSocket messages are the primary
  // driver of progress/logs/status (see connectToRun below); polling only discovers
  // newly-started runs and cleans up finished ones. While every active run has a
  // live WS we poll slowly (20s); if a WS has dropped we poll faster (3s) as a
  // backstop so progress still advances. With no active run we keep a slow 20s
  // discovery heartbeat so a run started elsewhere still surfaces the widget.
  const { data: activeRunsData, refetch: refreshActiveRuns } = useQuery({
    queryKey: ["activeRuns"],
    queryFn: getActiveRuns,
    refetchInterval: () => {
      if (runProgressMap.size > 0 && !allRunsHaveLiveWs) return 3000;
      return 20000;
    },
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
        setLiveWsRunIds((prev) => {
          if (prev.has(runId)) return prev;
          const updated = new Set(prev);
          updated.add(runId);
          return updated;
        });
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
        setLiveWsRunIds((prev) => {
          if (!prev.has(runId)) return prev;
          const updated = new Set(prev);
          updated.delete(runId);
          return updated;
        });
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
          // The WebSocket is the primary driver of progress/message; while its
          // socket is live, leave those fields to the WS path and only reconcile
          // status here. But when this run has no live WS the poll is the only
          // source of fresh data — then advance progress/message too, otherwise
          // the widget freezes at the last WS value (the 3s fallback poll exists
          // precisely to keep progress moving during a WS outage).
          const hasLiveWs = liveWsRunIds.has(run.id);
          if (hasLiveWs) {
            if (existing.status !== run.status) {
              updated.set(run.id, {
                ...existing,
                status: run.status,
                updatedAt: Date.now(),
              });
            }
          } else {
            const { progress, message } = deriveRunProgress(run);
            if (
              existing.status !== run.status ||
              existing.progress !== progress ||
              existing.message !== message
            ) {
              updated.set(run.id, {
                ...existing,
                status: run.status,
                progress,
                message,
                updatedAt: Date.now(),
              });
            }
          }
        } else {
          // Add new run
          const { progress, message } = deriveRunProgress(run);
          updated.set(run.id, {
            runId: run.id,
            runName: run.name,
            status: run.status,
            progress,
            message: message || "Starting...",
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
  }, [activeRunsData, connectToRun, disconnectFromRun, liveWsRunIds]);

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

  // Track whether every active run has a live WebSocket. This gates the polling
  // heartbeat (slow when all live, fast fallback when any WS has dropped) so we
  // never lose progress updates if a socket disconnects.
  useEffect(() => {
    const allLive = activeRuns.every((run) => liveWsRunIds.has(run.runId));
    setAllRunsHaveLiveWs((prev) => (prev === allLive ? prev : allLive));
  }, [activeRuns, liveWsRunIds]);

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

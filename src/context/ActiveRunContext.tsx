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
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
  ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { getActiveRuns } from "@/api/runs";
import type { RunStatus } from "@/types/runs";
import {
  ActiveRunContext,
  type ActiveRunContextValue,
  type RunProgressState,
} from "@/context/useActiveRuns";
import { getWebSocketBaseUrl } from "@/lib/websocket";

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

export function ActiveRunProvider({ children }: { children: ReactNode }) {
  const [runProgressMap, setRunProgressMap] = useState<Map<string, RunProgressState>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const wsConnectionsRef = useRef<Map<string, WebSocket | null>>(new Map());

  // Fetch active runs periodically
  const { data: activeRunsData, refetch: refreshActiveRuns } = useQuery({
    queryKey: ["activeRuns"],
    queryFn: getActiveRuns,
    refetchInterval: 3000, // Poll every 3 seconds
    staleTime: 1000,
  });

  // Connect WebSocket for a specific run
  const connectToRun = useCallback((runId: string, _runName: string, status: RunStatus) => {
    // Already connected
    if (wsConnectionsRef.current.has(runId)) return;

    // Only connect for running/queued runs
    if (status !== "running" && status !== "queued") return;

    // Mark as pending to prevent duplicate async connections
    wsConnectionsRef.current.set(runId, null);

    getWebSocketBaseUrl().then((baseUrl) => {
      // Check if disconnected while resolving URL
      if (!wsConnectionsRef.current.has(runId)) return;

      const wsUrl = `${baseUrl}/ws`;

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

                if (newState.progress === existing.progress
                    && newState.message === existing.message
                    && newState.status === existing.status
                    && newState.logs === existing.logs) return prev;

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
          wsConnectionsRef.current.delete(runId);
        };

        ws.onerror = () => {
          ws.close();
        };

        wsConnectionsRef.current.set(runId, ws);
      } catch {
        wsConnectionsRef.current.delete(runId);
      }
    }).catch(() => {
      wsConnectionsRef.current.delete(runId);
    });
  }, []);

  // Cleanup WebSocket for completed/failed runs
  const disconnectFromRun = useCallback((runId: string) => {
    const ws = wsConnectionsRef.current.get(runId);
    wsConnectionsRef.current.delete(runId);
    ws?.close();
  }, []);

  // Sync active runs with our progress map
  useEffect(() => {
    if (!activeRunsData?.runs) return;

    const activeRuns = activeRunsData.runs;
    const activeRunIds = new Set(activeRuns.map(r => r.id));

    // Connection side effects must not run inside a React state updater.
    for (const run of activeRuns) connectToRun(run.id, run.name, run.status);
    for (const runId of wsConnectionsRef.current.keys()) {
      if (!activeRunIds.has(runId)) disconnectFromRun(runId);
    }

    // Update progress map
    setRunProgressMap((prev) => {
      const updated = new Map(prev);

      // Add/update active runs
      for (const run of activeRuns) {
        const existing = prev.get(run.id);
        if (existing) {
          // Update status if changed
          if (existing.status !== run.status || existing.runName !== run.name) {
            updated.set(run.id, {
              ...existing,
              status: run.status,
              runName: run.name,
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

          }
        }
      }

      return updated.size === prev.size
        && Array.from(updated).every(([id, state]) => prev.get(id) === state)
        ? prev : updated;
    });
  }, [activeRunsData, connectToRun, disconnectFromRun]);

  // Cleanup on unmount
  useEffect(() => {
    const wsConnections = wsConnectionsRef.current;
    return () => {
      const connections = Array.from(wsConnections.values());
      wsConnections.clear();
      connections.forEach((ws) => {
        if (ws) ws.close();
      });
    };
  }, []);

  // Convert map to array, sorted by update time
  const activeRuns = useMemo(() => Array.from(runProgressMap.values())
    .filter((r) => r.status === "running" || r.status === "queued")
    .sort((a, b) => b.updatedAt - a.updatedAt), [runProgressMap]);

  // Auto-select first run if none selected
  useEffect(() => {
    if (activeRuns.length > 0 && !activeRuns.some((run) => run.runId === selectedRunId)) {
      setSelectedRunId(activeRuns[0].runId);
    } else if (activeRuns.length === 0) {
      setSelectedRunId(null);
    }
  }, [activeRuns, selectedRunId]);

  const getRunProgress = useCallback(
    (runId: string) => runProgressMap.get(runId), [runProgressMap],
  );
  const toggleMinimized = useCallback(() => setIsMinimized((prev) => !prev), []);
  const value = useMemo<ActiveRunContextValue>(() => ({
    activeRuns,
    hasActiveRuns: activeRuns.length > 0,
    getRunProgress,
    refreshActiveRuns,
    isMinimized,
    toggleMinimized,
    selectedRunId,
    selectRun: setSelectedRunId,
  }), [activeRuns, getRunProgress, refreshActiveRuns, isMinimized, toggleMinimized, selectedRunId]);

  return (
    <ActiveRunContext.Provider value={value}>
      {children}
    </ActiveRunContext.Provider>
  );
}

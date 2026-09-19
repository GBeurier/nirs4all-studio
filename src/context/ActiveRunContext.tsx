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
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getActiveRuns, getRun } from "@/api/runs";
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
  const queryClient = useQueryClient();
  const previousActiveIds = useRef(new Set<string>());
  const refreshResults = useCallback(() => {
    for (const key of ["results-summary", "aggregated-predictions", "dataset-all-chains", "runs"]) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
    void queryClient.invalidateQueries({
      predicate: (query) => query.queryKey[0] === "workspaces" && query.queryKey[2] === "scores",
    });
  }, [queryClient]);
  const [runProgressMap, setRunProgressMap] = useState<Map<string, RunProgressState>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const wsConnectionsRef = useRef<Map<string, WebSocket | null>>(new Map());
  const terminalChecksRef = useRef(new Map<string, symbol>());

  const resolveTerminalStatus = useCallback((runId: string) => {
    if (terminalChecksRef.current.has(runId)) return;
    const token = Symbol(runId);
    terminalChecksRef.current.set(runId, token);

    void queryClient.fetchQuery({
      queryKey: ["run-terminal-status", runId],
      queryFn: async () => {
        const run = await getRun(runId);
        if (run.status === "running" || run.status === "queued") {
          throw new Error("The final run status has not been persisted yet");
        }
        return run;
      },
      retry: 2,
      retryDelay: 1500,
      staleTime: 0,
    }).then((run) => {
      if (terminalChecksRef.current.get(runId) !== token) return;
      const error = run.datasets.flatMap(dataset => dataset.pipelines)
        .find(pipeline => pipeline.error_message)?.error_message;
      refreshResults();
      setRunProgressMap((prev) => {
        const existing = prev.get(runId);
        if (!existing) return prev;
        const updated = new Map(prev);
        updated.set(runId, {
          ...existing,
          status: run.status,
          progress: run.status === "completed" ? 100 : existing.progress,
          message: error || (run.status === "completed" ? "Run completed" : run.status === "partial" ? "Run partially completed" : "Run failed"),
          updatedAt: Date.now(),
        });
        return updated;
      });
    }).catch((error: unknown) => {
      if (terminalChecksRef.current.get(runId) !== token) return;
      setRunProgressMap((prev) => {
        const existing = prev.get(runId);
        if (!existing || (existing.status !== "running" && existing.status !== "queued")) return prev;
        const updated = new Map(prev);
        updated.set(runId, {
          ...existing,
          message: `Unable to confirm final run status: ${error instanceof Error ? error.message : "request failed"}. Open run details to retry.`,
          updatedAt: Date.now(),
        });
        return updated;
      });
    });
  }, [queryClient, refreshResults]);

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
              if (["job_completed", "job_failed", "job_cancelled"].includes(message.type)) {
                refreshResults();
                resolveTerminalStatus(runId);
              }
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
                  const resultStatus = message.data?.result?.status;
                  if (resultStatus === "completed" || resultStatus === "failed" || resultStatus === "partial") {
                    newState.status = resultStatus;
                    if (resultStatus === "completed") newState.progress = 100;
                  }
                  newState.message = "Confirming final run status...";
                } else if (message.type === "job_failed") {
                  newState.status = "failed";
                  newState.message = message.data?.error || message.data?.message || "Run failed";
                } else if (message.type === "job_cancelled") {
                  // The persisted Run contract represents cancellation as a
                  // failed run with a cancellation reason, not as completion.
                  newState.status = "failed";
                  newState.message = message.data?.error || message.data?.message || "Run cancelled";
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
  }, [refreshResults, resolveTerminalStatus]);

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
    const disappeared = [...previousActiveIds.current].filter(id => !activeRunIds.has(id));
    if (disappeared.length) refreshResults();
    for (const runId of disappeared) resolveTerminalStatus(runId);
    for (const runId of activeRunIds) {
      if (!previousActiveIds.current.has(runId)) terminalChecksRef.current.delete(runId);
    }
    previousActiveIds.current = activeRunIds;

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
          // Absence from the active list is not proof of success. The bounded
          // detail request above supplies the persisted terminal status.
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
  }, [activeRunsData, connectToRun, disconnectFromRun, refreshResults, resolveTerminalStatus]);

  // Cleanup on unmount
  useEffect(() => {
    const wsConnections = wsConnectionsRef.current;
    const terminalChecks = terminalChecksRef.current;
    return () => {
      for (const runId of terminalChecks.keys()) {
        void queryClient.cancelQueries({ queryKey: ["run-terminal-status", runId] });
      }
      terminalChecks.clear();
      const connections = Array.from(wsConnections.values());
      wsConnections.clear();
      connections.forEach((ws) => {
        if (ws) ws.close();
      });
    };
  }, [queryClient]);

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

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
import { Link } from "react-router-dom";
import { getActiveRuns, getWorkspaceExecutionJobRecord } from "@/api/runs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { RunStatus } from "@/types/runs";
import {
  ActiveRunContext,
  type ActiveRunContextValue,
  type RunProgressState,
} from "@/context/useActiveRuns";
import { getWebSocketBaseUrl } from "@/lib/websocket";
import { invalidatePredictionRelatedQueries } from "@/lib/prediction-deletion";

// WebSocket message types
interface WsMessage {
  type: string;
  channel: string;
  data: {
    job_id?: string;
    progress?: number;
    progress_unavailable?: boolean;
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
  const [runProgressMap, setRunProgressMap] = useState<Map<string, RunProgressState>>(new Map());
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const wsConnectionsRef = useRef<Map<string, WebSocket | null>>(new Map());
  const notifiedFailures = useRef(new Set<string>());
  const resolvingRuns = useRef(new Set<string>());
  const [failures, setFailures] = useState<Array<{ runId: string; runName: string; error: string }>>([]);
  const reportFailure = useCallback((runId: string, runName: string, error?: string | null) => {
    if (error === "Cancelled" || notifiedFailures.current.has(runId)) return;
    notifiedFailures.current.add(runId);
    setFailures((previous) => [...previous, {
      runId, runName, error: error?.trim() || "The run failed without an error description from the backend.",
    }]);
  }, []);

  // Fetch active runs periodically
  const { data: activeRunsData, dataUpdatedAt: activeRunsUpdatedAt, refetch: refreshActiveRuns } = useQuery({
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

    const path = `/ws/job/${encodeURIComponent(runId)}`;
    getWebSocketBaseUrl(path).then((baseUrl) => {
      // Check if disconnected while resolving URL
      if (!wsConnectionsRef.current.has(runId)) return;

      const wsUrl = `${baseUrl}${path}`;

      try {
        const ws = new WebSocket(wsUrl);

        // The job endpoint subscribes automatically to its exact channel.

        ws.onmessage = (event) => {
          try {
            const message: WsMessage = JSON.parse(event.data);
            if (message.channel === `job:${runId}`) {
              if (["job_completed", "job_failed"].includes(message.type)) {
                void invalidatePredictionRelatedQueries(queryClient);
              }
              if (message.type === "job_failed") {
                reportFailure(runId, _runName, message.data?.error);
              }
              setRunProgressMap((prev) => {
                const existing = prev.get(runId);
                if (!existing) return prev;

                const newState = { ...existing };

                // Handle progress updates
                if (message.type === "job_progress" && message.data) {
                  if (message.data.progress !== undefined) {
                    newState.progress = message.data.progress;
                    if (message.data.progress > 0) newState.progressUnavailable = false;
                  }
                  if (typeof message.data.progress_unavailable === "boolean") {
                    newState.progressUnavailable = message.data.progress_unavailable;
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
                  newState.progressUnavailable = false;
                } else if (message.type === "job_failed") {
                  newState.status = "failed";
                  newState.message = message.data?.error || "Run failed";
                }

                if (newState.progressUnavailable === existing.progressUnavailable
                    && newState.progress === existing.progress
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
  }, [reportFailure, queryClient]);

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
          // Polling restores progress even when the WebSocket was attached late.
          const progress = typeof run.progress === "number" && Number.isFinite(run.progress)
            ? run.progress : existing.progress;
          const progressUnavailable = typeof run.progress_unavailable === "boolean"
            ? run.progress_unavailable : existing.progressUnavailable;
          const message = run.progress_message ?? existing.message;
          if (existing.status !== run.status || existing.runName !== run.name
              || existing.progress !== progress || existing.message !== message
              || existing.progressUnavailable !== progressUnavailable) {
            updated.set(run.id, {
              ...existing,
              status: run.status,
              runName: run.name,
              progress, progressUnavailable, message,
              updatedAt: Date.now(),
            });
          }
        } else {
          // Add new run
          updated.set(run.id, {
            runId: run.id,
            runName: run.name,
            status: run.status,
            progress: run.progress ?? 0,
            progressUnavailable: run.progress_unavailable ?? (run.progress == null),
            message: run.progress_message || "Starting...",
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

  // An absent active run can have failed before the WebSocket subscribed.
  // Read its authoritative terminal status instead of assuming success.
  useEffect(() => {
    if (!activeRunsData?.runs) return;
    const activeIds = new Set(activeRunsData.runs.map((run) => run.id));
    for (const [runId, state] of runProgressMap) {
      if (activeIds.has(runId) || resolvingRuns.current.has(runId)
          || (state.status !== "running" && state.status !== "queued")) continue;
      resolvingRuns.current.add(runId);
      void getWorkspaceExecutionJobRecord(runId).then((record) => {
        if (!["completed", "failed", "cancelled"].includes(record.status)) return;
        void invalidatePredictionRelatedQueries(queryClient);
        const status = record.status === "completed" ? "completed" : "failed";
        if (record.status === "failed") {
          reportFailure(runId, state.runName || record.run_name, record.error);
        }
        setRunProgressMap((previous) => {
          const existing = previous.get(runId);
          if (!existing || (existing.status !== "running" && existing.status !== "queued")) return previous;
          const updated = new Map(previous);
          updated.set(runId, {
            ...existing, status,
            progress: status === "completed" ? 100 : existing.progress,
            progressUnavailable: status === "completed" ? false : existing.progressUnavailable,
            message: record.error || existing.message, updatedAt: Date.now(),
          });
          return updated;
        });
      }).catch(() => {
        // Retry on the next active-run poll; a read failure is not success.
      }).finally(() => resolvingRuns.current.delete(runId));
    }
  }, [activeRunsData, activeRunsUpdatedAt, runProgressMap, reportFailure, queryClient]);

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
      <Dialog open={failures.length > 0} onOpenChange={(open) => {
        if (!open) setFailures((previous) => previous.slice(1));
      }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run failed: {failures[0]?.runName}</DialogTitle>
            <DialogDescription>The execution stopped. The backend reported the following error.</DialogDescription>
          </DialogHeader>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-sm">{failures[0]?.error}</pre>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailures((previous) => previous.slice(1))}>Close</Button>
            <Button asChild><Link to={`/runs/${encodeURIComponent(failures[0]?.runId || "")}`} onClick={() => setFailures((previous) => previous.slice(1))}>View run details</Link></Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ActiveRunContext.Provider>
  );
}

/**
 * RunProgress Page - Real-time run execution monitoring (Run A implementation)
 *
 * This page shows live progress for a single run with:
 * - Step-by-step pipeline visualization
 * - Real-time metrics as they become available
 * - Logs panel
 * - Model export options when complete
 *
 * Orchestration only: the WebSocket protocol layer (types, reducer, connect/
 * reconnect hook) lives in @/lib/run-progress and the presentational
 * subcomponents live in @/components/runs.
 */

import { useState, useEffect, useCallback, useReducer, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getRun, getRunExecutionJobRecord, stopRun, getPipelineLogs } from "@/api/runs";
import { ReconnectingIndicator, ErrorState, LoadingState } from "@/components/ui/state-display";
import type { Run } from "@/types/runs";
import {
  buildRunLogLines,
  buildRunExecutionProgressDisplayData,
  buildRunProgressDisplayData,
} from "@/lib/run-progress/pageData";
import {
  initialRunProgressState,
  runProgressReducer,
  useRunWebSocket,
  type ProgressState,
  type WsMessage,
} from "@/lib/run-progress";
import {
  downloadTextFile,
  sanitizeFilename,
} from "@/components/runs";
import {
  PipelinesColumn,
  ProgressOverviewCard,
  RunProgressHeader,
  RunSidePanel,
  RunStatsGrid,
} from "@/components/runs/RunProgressSections";

function isNotFoundApiError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "status" in error
    && (error as { status?: unknown }).status === 404,
  );
}

export default function RunProgress() {
  const { id: runId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [isStopping, setIsStopping] = useState(false);
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const [persistedLogs, setPersistedLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [wsReconnecting, setWsReconnecting] = useState<{ attempt: number; max: number } | null>(null);
  const [currentProgress, setCurrentProgress] = useState<ProgressState | null>(null);
  const [progressState, dispatchProgress] = useReducer(runProgressReducer, initialRunProgressState);
  const { granular: granularProgress, refit: refitState } = progressState;

  // Fetch run data with polling for active runs
  const { data: run, isLoading, error, refetch } = useQuery({
    queryKey: ["run", runId],
    queryFn: () => getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => {
      const data = query.state.data as Run | undefined;
      // Poll every 1 second for active runs (faster updates)
      if (data?.status === "running" || data?.status === "queued") {
        return 1000;
      }
      return false;
    },
  });

  const { data: executionJobRecord = null } = useQuery({
    queryKey: ["run", runId, "execution-job-record"],
    queryFn: async () => {
      try {
        return await getRunExecutionJobRecord(runId!);
      } catch (err) {
        if (isNotFoundApiError(err)) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!runId,
    retry: false,
    refetchInterval: (query) => {
      const record = query.state.data;
      if (!record || record.status === "running" || record.status === "pending") {
        return 1000;
      }
      return false;
    },
  });

  // WebSocket updates
  const handleWsUpdate = useCallback(
    (message: WsMessage) => {
      // Invalidate query on WebSocket update to refresh data
      queryClient.invalidateQueries({ queryKey: ["run", runId] });

      // Handle completion - show toast
      if (message.type === "job_completed") {
        toast.success("Run completed successfully!");
      } else if (message.type === "job_failed") {
        toast.error(`Run failed: ${message.data?.error || "Unknown error"}`);
      }

      // Fold the message into granular + refit state via the pure reducer.
      dispatchProgress(message);
    },
    [queryClient, runId]
  );

  // Handle streaming logs from WebSocket
  const handleStreamingLog = useCallback((log: string) => {
    setStreamingLogs((prev) => {
      // Avoid duplicates and limit log size
      if (prev.includes(log)) return prev;
      const newLogs = [...prev, log];
      return newLogs.slice(-100); // Keep last 100 logs
    });
  }, []);

  // Handle progress updates from WebSocket
  const handleProgress = useCallback((state: ProgressState) => {
    setCurrentProgress(state);
  }, []);

  // Handle WebSocket reconnecting
  const handleReconnecting = useCallback((attempt: number, maxAttempts: number) => {
    setWsReconnecting({ attempt, max: maxAttempts });
  }, []);

  // Handle WebSocket connected
  const handleConnected = useCallback(() => {
    setWsReconnecting(null);
  }, []);

  useRunWebSocket(runId || "", handleWsUpdate, handleStreamingLog, handleProgress, handleReconnecting, handleConnected);

  // Reset streaming logs and progress when run changes
  useEffect(() => {
    setStreamingLogs([]);
    setPersistedLogs([]);
    setLogsError(null);
    setCurrentProgress(null);
    dispatchProgress({ type: "reset" });
  }, [runId]);

  const loadPersistedLogs = useCallback(async () => {
    if (!runId || !run) return;
    setIsLoadingLogs(true);
    setLogsError(null);

    try {
      const pipelineEntries = run.datasets.flatMap((dataset) =>
        dataset.pipelines.map((pipeline) => ({
          datasetName: dataset.dataset_name,
          pipelineId: pipeline.id,
          pipelineName: pipeline.pipeline_name,
        }))
      );

      const logChunks = await Promise.all(
        pipelineEntries.map(async (entry) => {
          const response = await getPipelineLogs(runId, entry.pipelineId);
          const logs = response.logs || [];
          return logs.map(
            (log) => `[${entry.datasetName}] [${entry.pipelineName}] ${log}`
          );
        })
      );

      const merged = logChunks.flat();
      setPersistedLogs([...new Set(merged)]);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setIsLoadingLogs(false);
    }
  }, [runId, run]);

  // Keep a ref to the latest loader so the polling interval always reads fresh
  // run data without re-subscribing (and recreating the interval) every poll.
  const loadPersistedLogsRef = useRef(loadPersistedLogs);
  loadPersistedLogsRef.current = loadPersistedLogs;

  // Stop run handler
  const handleStop = async () => {
    if (!runId) return;
    setIsStopping(true);
    try {
      await stopRun(runId);
      toast.success("Run stopped");
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
    } catch (err) {
      toast.error("Failed to stop run");
    } finally {
      setIsStopping(false);
    }
  };

  // Poll persisted logs on a stable 5s cadence. Depend on run.status (a string)
  // rather than the whole `run` object - react-query returns a fresh `run`
  // reference every 1s poll, which previously re-ran this effect every second,
  // clearing/recreating the interval and re-fetching far more often than 5s.
  const runStatus = run?.status;
  useEffect(() => {
    if (!runStatus || !runId) return;
    void loadPersistedLogsRef.current();

    if (runStatus === "running" || runStatus === "queued") {
      const intervalId = setInterval(() => {
        void loadPersistedLogsRef.current();
      }, 5000);
      return () => clearInterval(intervalId);
    }

    return undefined;
  }, [runStatus, runId]);

  if (isLoading) {
    return (
      <div className="p-6">
        <LoadingState message="Loading run details..." />
      </div>
    );
  }

  if (error || !run) {
    return (
      <div className="p-6">
        <ErrorState
          title="Run Not Found"
          message={
            error instanceof Error
              ? error.message
              : "The run you're looking for doesn't exist or has been deleted."
          }
          onRetry={() => refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline">
            <Link to="/runs">Back to Runs</Link>
          </Button>
        </div>
      </div>
    );
  }

  const {
    totalPipelineCount,
    pipelineIndexById,
    completedCount,
    failedCount,
    currentPipeline,
    overallProgress,
    progressOverviewPrimaryText,
    progressOverviewSecondaryText,
    summaryPipeline,
    summaryMetrics,
    summaryLabel,
    summaryPrimaryText,
    summarySecondaryText,
    summaryVariantText,
  } = buildRunProgressDisplayData(run, granularProgress.variantDescription);
  const executionProgressDisplay = buildRunExecutionProgressDisplayData(run, executionJobRecord);
  const progressOverviewText = executionJobRecord
    ? executionProgressDisplay.message
    : progressOverviewPrimaryText;
  const progressOverviewDetailText = executionJobRecord
    ? progressOverviewPrimaryText
    : progressOverviewSecondaryText;
  const effectiveOverallProgress = executionJobRecord
    ? executionProgressDisplay.progress
    : overallProgress;
  const allLogs = buildRunLogLines({ run, persistedLogs, streamingLogs });

  const handleExportLogs = () => {
    if (allLogs.length === 0) {
      return;
    }

    downloadTextFile(
      `${allLogs.join("\n")}${allLogs.length > 0 ? "\n" : ""}`,
      `${sanitizeFilename(run.name)}_${sanitizeFilename(run.id)}_logs.txt`
    );
  };

  const isActiveRun = run.status === "running" || run.status === "queued";

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <RunProgressHeader run={run} isStopping={isStopping} onStop={handleStop} />

      {/* WebSocket reconnecting indicator */}
      {wsReconnecting && isActiveRun && (
        <ReconnectingIndicator
          message="Connection lost. Reconnecting..."
          attempt={wsReconnecting.attempt}
          maxAttempts={wsReconnecting.max}
        />
      )}

      {/* Progress overview for running runs */}
      {isActiveRun && (
        <ProgressOverviewCard
          primaryText={progressOverviewText}
          secondaryText={progressOverviewDetailText}
          overallProgress={effectiveOverallProgress}
        />
      )}

      {/* Stats row */}
      <RunStatsGrid
        datasetCount={run.datasets.length}
        totalPipelines={run.total_pipelines || 0}
        completedCount={completedCount}
        failedCount={failedCount}
      />

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <PipelinesColumn
          run={run}
          pipelineIndexById={pipelineIndexById}
          totalPipelineCount={totalPipelineCount}
          currentPipeline={currentPipeline}
          currentProgress={currentProgress}
          granularProgress={granularProgress}
          refitState={refitState}
        />

        <RunSidePanel
          run={run}
          summaryPipeline={summaryPipeline}
          summaryMetrics={summaryMetrics}
          summaryLabel={summaryLabel}
          summaryPrimaryText={summaryPrimaryText}
          summarySecondaryText={summarySecondaryText}
          summaryVariantText={summaryVariantText}
          logs={allLogs}
          isLoadingLogs={isLoadingLogs}
          logsError={logsError}
          onRefreshLogs={loadPersistedLogs}
          onExportLogs={handleExportLogs}
        />
      </div>
    </div>
  );
}

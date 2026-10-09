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
import i18next from "i18next";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { getRunExecutionJobRecord, getWorkspaceExecutionJobRecord, stopRun } from "@/api/runs";
import { getN4AWorkspaceRunDetail, getWorkspaceRunPipelineLogs } from "@/api/linkedWorkspaces";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import { ReconnectingIndicator, ErrorState, LoadingState } from "@/components/ui/state-display";
import type { Run } from "@/types/runs";
import {
  buildRunLogLines,
  buildRunFromExecutionJobRecord,
  buildRunFromWorkspaceDetail,
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
  getExecutionJobRecordRefetchInterval,
  getRunDetailRefetchInterval,
  WS_INVALIDATE_THROTTLE_MS,
} from "@/lib/run-progress/polling";
import {
  downloadTextFile,
  sanitizeFilename,
} from "@/components/runs";
import { invalidatePredictionRelatedQueries } from "@/lib/prediction-deletion";
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
  const { t } = useTranslation();
  const { id: runId } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { data: workspacesData } = useLinkedWorkspacesQuery();
  const workspaceId = workspacesData?.active_workspace_id;
  const executionJobId = runId?.startsWith("run_native_") ?? false;
  const [isStopping, setIsStopping] = useState(false);
  const [streamingLogs, setStreamingLogs] = useState<string[]>([]);
  const [persistedLogs, setPersistedLogs] = useState<string[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [logsError, setLogsError] = useState<string | null>(null);
  const [wsReconnecting, setWsReconnecting] = useState<{ attempt: number; max: number } | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const invalidateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInvalidateRef = useRef(0);
  const [currentProgress, setCurrentProgress] = useState<ProgressState | null>(null);
  const [progressState, dispatchProgress] = useReducer(runProgressReducer, initialRunProgressState);
  const { granular: granularProgress, refit: refitState } = progressState;

  // Fetch run data with polling for active runs
  const { data: runDetail, isLoading, error, refetch } = useQuery({
    queryKey: ["run", runId, workspaceId],
    queryFn: async () => buildRunFromWorkspaceDetail(await getN4AWorkspaceRunDetail(workspaceId!, runId!)),
    enabled: !!runId && !!workspaceId && !executionJobId,
    refetchInterval: (query) => getRunDetailRefetchInterval((query.state.data as Run | undefined)?.status, wsConnected),
  });

  const { data: executionJobRecord = null } = useQuery({
    queryKey: ["run", runId, "execution-job-record"],
    queryFn: async () => {
      try {
        return await getRunExecutionJobRecord(runId!);
      } catch (err) {
        if (isNotFoundApiError(err)) {
          try {
            return await getWorkspaceExecutionJobRecord(runId!);
          } catch (jobError) {
            if (isNotFoundApiError(jobError)) return null;
            throw jobError;
          }
        }
        throw err;
      }
    },
    enabled: !!runId && executionJobId,
    retry: false,
    refetchInterval: (query) => getExecutionJobRecordRefetchInterval({
      record: query.state.data,
      queryStatus: query.state.status,
      dataUpdateCount: query.state.dataUpdateCount,
      wsConnected,
    }),
  });

  const run = runDetail ?? (executionJobRecord
    ? buildRunFromExecutionJobRecord(executionJobRecord) : undefined);

  // WebSocket updates
  const handleWsUpdate = useCallback(
    (message: WsMessage) => {
      // Refresh run data on WebSocket updates, throttled so progress bursts do not become request storms.
      // Terminal messages refresh immediately.
      const isTerminal = message.type === "job_completed" || message.type === "job_failed";
      const invalidate = () => {
        invalidateTimerRef.current = null;
        lastInvalidateRef.current = Date.now();
        void queryClient.invalidateQueries({ queryKey: ["run", runId] });
      };
      if (isTerminal) {
        if (invalidateTimerRef.current) clearTimeout(invalidateTimerRef.current);
        invalidate();
      } else if (!invalidateTimerRef.current) {
        const wait = WS_INVALIDATE_THROTTLE_MS - (Date.now() - lastInvalidateRef.current);
        if (wait <= 0) invalidate();
        else invalidateTimerRef.current = setTimeout(invalidate, wait);
      }

      // Handle completion - show toast
      if (message.type === "job_completed") {
        void invalidatePredictionRelatedQueries(queryClient);
        toast.success(i18next.t("runs.progress.completedToast"));
      } else if (message.type === "job_failed") {
        void invalidatePredictionRelatedQueries(queryClient);
        toast.error(i18next.t("runs.progress.failedToast", { error: message.data?.error || i18next.t("runs.unknownError") }));
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
    setWsConnected(false);
    setWsReconnecting({ attempt, max: maxAttempts });
  }, []);

  // Handle WebSocket connected
  const handleConnected = useCallback(() => {
    setWsConnected(true);
    setWsReconnecting(null);
  }, []);

  useRunWebSocket(run?.status === "running" || run?.status === "queued" ? runId || "" : "", handleWsUpdate, handleStreamingLog, handleProgress, handleReconnecting, handleConnected);

  // Reset streaming logs and progress when run changes
  useEffect(() => {
    setStreamingLogs([]);
    setPersistedLogs([]);
    setLogsError(null);
    setCurrentProgress(null);
    setWsConnected(false);
    dispatchProgress({ type: "reset" });
    return () => {
      if (invalidateTimerRef.current) {
        clearTimeout(invalidateTimerRef.current);
        invalidateTimerRef.current = null;
      }
    };
  }, [runId]);

  const loadPersistedLogs = useCallback(async () => {
    if (!runId || !run || !workspaceId) return;
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
          if (!executionJobId && runDetail?.datasets.flatMap(dataset => dataset.pipelines)
            .find(pipeline => pipeline.id === entry.pipelineId)?.logs?.length === 0) return [];
          const response = await getWorkspaceRunPipelineLogs(workspaceId, runId, entry.pipelineId);
          const logs = response.logs || [];
          return logs.map(
            (log) => `[${entry.datasetName}] [${entry.pipelineName}] ${log.message ?? log.event ?? ""}`
          );
        })
      );

      const merged = logChunks.flat();
      setPersistedLogs([...new Set(merged)]);
    } catch (err) {
      setLogsError(err instanceof Error ? err.message : i18next.t("runs.progress.logsLoadFailed"));
    } finally {
      setIsLoadingLogs(false);
    }
    }, [runId, run, workspaceId, executionJobId, runDetail]);

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
      toast.success(t("runs.progress.stopped"));
      queryClient.invalidateQueries({ queryKey: ["run", runId] });
    } catch (err) {
      toast.error(t("runs.progress.stopFailed"));
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

  if (isLoading && !run) {
    return (
      <div className="p-6">
        <LoadingState message={t("runs.progress.loading")} />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6">
        <ErrorState
          title={t("runs.progress.notFound")}
          message={
            error instanceof Error
              ? error.message
              : t("runs.progress.notFoundHint")
          }
          onRetry={() => refetch()}
        />
        <div className="mt-4 flex justify-center">
          <Button asChild variant="outline">
            <Link to="/runs">{t("runs.progress.backToRuns")}</Link>
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

      {(run.status === "failed" || executionJobRecord?.status === "failed") && (
        <Alert variant="destructive">
          <AlertTitle>{t("runs.progress.failedTitle")}</AlertTitle>
          <AlertDescription className="mt-2 whitespace-pre-wrap break-words font-mono">
            {executionJobRecord?.error || run.error || t("runs.progress.noErrorDescription")}
          </AlertDescription>
        </Alert>
      )}

      {/* WebSocket reconnecting indicator */}
      {wsReconnecting && isActiveRun && (
        <ReconnectingIndicator
          message={t("runs.progress.reconnecting")}
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
          progressUnavailable={executionProgressDisplay.progressUnavailable}
        />
      )}

      <RunStatsGrid
        datasetCount={run.datasets.length}
        totalPipelines={run.total_pipelines || 0}
        completedCount={completedCount}
        failedCount={failedCount}
      />

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

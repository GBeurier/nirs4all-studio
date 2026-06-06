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

import { useState, useEffect, useCallback, useMemo, useReducer, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Square,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Database,
  Layers,
} from "lucide-react";
import { toast } from "sonner";
import { getRun, stopRun, getPipelineLogs } from "@/api/runs";
import { ReconnectingIndicator, ErrorState, LoadingState } from "@/components/ui/state-display";
import type { Run } from "@/types/runs";
import {
  buildPipelineCompactSummary,
  buildPipelinePrimarySummary,
  formatPipelineVariantLabel,
  getPipelineDisplayMetrics,
} from "@/lib/run-progress-display";
import {
  initialRunProgressState,
  runProgressReducer,
  useRunWebSocket,
  type ProgressState,
  type WsMessage,
} from "@/lib/run-progress";
import {
  LogsPanel,
  MetricsCard,
  PipelineProgress,
  RefitPhaseIndicator,
  StatusBadge,
  downloadTextFile,
  sanitizeFilename,
} from "@/components/runs";

export default function RunProgress() {
  const { id: runId } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  const derivedLogs = useMemo(() => {
    if (!run) return [] as string[];
    const logs: string[] = [];

    run.datasets.forEach((dataset, datasetIndex) => {
      logs.push(`[INFO] Dataset ${datasetIndex + 1}/${run.datasets.length}: ${dataset.dataset_name}`);

      dataset.pipelines.forEach((pipeline, pipelineIndex) => {
        logs.push(
          `[INFO] Pipeline ${pipelineIndex + 1}/${dataset.pipelines.length}: ${pipeline.pipeline_name} (model=${pipeline.model})`
        );

        if (pipeline.fold_metrics) {
          const folds = Object.values(pipeline.fold_metrics);
          if (folds.length > 0) {
            const avg = folds.reduce(
              (acc, metric) => {
                return {
                  r2: acc.r2 + (metric.r2 ?? 0),
                  rmse: acc.rmse + (metric.rmse ?? 0),
                  mae: acc.mae + (metric.mae ?? 0),
                  rpd: acc.rpd + (metric.rpd ?? 0),
                };
              },
              { r2: 0, rmse: 0, mae: 0, rpd: 0 } as { r2: number; rmse: number; mae: number; rpd: number }
            );

            const foldCount = folds.length;
            const avgR2 = avg.r2 / foldCount;
            const avgRmse = avg.rmse / foldCount;
            const avgMae = avg.mae / foldCount;
            const avgRpd = avg.rpd / foldCount;

            const parts: string[] = [];
            if (!Number.isNaN(avgR2) && avgR2 > 0) parts.push(`R2=${avgR2.toFixed(4)}`);
            if (!Number.isNaN(avgRmse) && avgRmse > 0) parts.push(`RMSE=${avgRmse.toFixed(4)}`);
            if (!Number.isNaN(avgMae) && avgMae > 0) parts.push(`MAE=${avgMae.toFixed(4)}`);
            if (!Number.isNaN(avgRpd) && avgRpd > 0) parts.push(`RPD=${avgRpd.toFixed(3)}`);

            if (parts.length > 0) {
              logs.push(`[INFO] Fold averages (${foldCount} folds): ${parts.join(" | ")}`);
            }
          }
        }

        if (pipeline.metrics) {
          const parts: string[] = [];
          if (pipeline.metrics.r2 != null) parts.push(`R2=${pipeline.metrics.r2.toFixed(4)}`);
          if (pipeline.metrics.rmse != null && pipeline.metrics.rmse > 0) parts.push(`RMSE=${pipeline.metrics.rmse.toFixed(4)}`);
          if (pipeline.metrics.mae != null && pipeline.metrics.mae > 0) parts.push(`MAE=${pipeline.metrics.mae.toFixed(4)}`);
          if (pipeline.metrics.rpd != null && pipeline.metrics.rpd > 0) parts.push(`RPD=${pipeline.metrics.rpd.toFixed(3)}`);
          if (parts.length > 0) {
            logs.push(`[INFO] Final metrics: ${parts.join(" | ")}`);
          }
        }
      });
    });

    return logs;
  }, [run]);

  // Poll persisted logs on a stable 5s cadence. Depend on run.status (a string)
  // rather than the whole `run` object — react-query returns a fresh `run`
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

  // Aggregate pipeline info
  const allPipelines = run.datasets.flatMap(d => d.pipelines);
  const totalPipelineCount = run.total_pipelines || allPipelines.length;
  const pipelineIndexById = new Map<string, number>();
  allPipelines.forEach((pipeline, index) => {
    pipelineIndexById.set(pipeline.id, index + 1);
  });
  const completedCount = allPipelines.filter(p => p.status === "completed").length;
  const failedCount = allPipelines.filter(p => p.status === "failed").length;
  const currentPipeline =
    allPipelines.find(p => p.status === "running") ||
    allPipelines.find(p => p.status === "queued") ||
    null;
  const currentPipelineIndex = currentPipeline ? (pipelineIndexById.get(currentPipeline.id) ?? null) : null;

  // Calculate overall progress more accurately
  // Use running pipeline progress + completed pipelines
  const baseProgress = totalPipelineCount
    ? (completedCount / totalPipelineCount) * 100
    : 0;
  const runningProgress = currentPipeline?.status === "running" ? currentPipeline.progress || 0 : 0;
  const runningContribution = totalPipelineCount
    ? (runningProgress / 100) * (100 / totalPipelineCount)
    : 0;
  const overallProgress = baseProgress + runningContribution;

  // Collect all logs - combine persisted logs with streaming logs
  const runtimeLogs = allPipelines.flatMap(p => p.logs || []);
  const allLogs = [...new Set([
    ...derivedLogs,
    ...persistedLogs,
    ...runtimeLogs,
    ...streamingLogs,
  ])];

  // Get best metrics from completed pipelines
  const completedPipelines = allPipelines.filter(p => p.status === "completed" && p.metrics);
  const bestPipeline = completedPipelines.length > 0
    ? completedPipelines.reduce((best, p) =>
        (p.metrics?.r2 ?? 0) > (best.metrics?.r2 ?? 0) ? p : best
      )
    : null;
  const bestPipelineIndex = bestPipeline ? (pipelineIndexById.get(bestPipeline.id) ?? null) : null;
  const summaryPipeline = run.status === "running" || run.status === "queued"
    ? currentPipeline
    : bestPipeline;
  const summaryPipelineIndex = summaryPipeline?.id === currentPipeline?.id
    ? currentPipelineIndex
    : bestPipelineIndex;
  const summaryMetrics = summaryPipeline ? getPipelineDisplayMetrics(summaryPipeline) : undefined;
  const summaryLabel = run.status === "running" || run.status === "queued"
    ? "Current pipeline"
    : "Best completed";
  const summaryPrimaryText = summaryPipeline
    ? buildPipelinePrimarySummary(summaryPipelineIndex, totalPipelineCount, summaryPipeline)
    : undefined;
  const summarySecondaryText = summaryPipeline
    ? buildPipelineCompactSummary(summaryPipeline)
    : undefined;
  const summaryVariantText = summaryPipeline
    ? formatPipelineVariantLabel(
        summaryPipeline.variant_choices,
        summaryPipeline.id === currentPipeline?.id
          ? granularProgress.variantDescription ?? summaryPipeline.variant_description
          : summaryPipeline.variant_description
      )
    : null;

  const handleExportLogs = () => {
    if (allLogs.length === 0) {
      return;
    }

    downloadTextFile(
      `${allLogs.join("\n")}${allLogs.length > 0 ? "\n" : ""}`,
      `${sanitizeFilename(run.name)}_${sanitizeFilename(run.id)}_logs.txt`
    );
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/runs">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{run.name}</h1>
              <StatusBadge status={run.status} />
            </div>
            <p className="text-muted-foreground text-sm">
              {run.description || `Started ${new Date(run.created_at).toLocaleString()}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(run.status === "running" || run.status === "queued") && (
            <Button
              variant="destructive"
              onClick={handleStop}
              disabled={isStopping}
            >
              {isStopping ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Square className="h-4 w-4 mr-2" />
              )}
              Stop Run
            </Button>
          )}
        </div>
      </div>

      {/* WebSocket reconnecting indicator */}
      {wsReconnecting && (run.status === "running" || run.status === "queued") && (
        <ReconnectingIndicator
          message="Connection lost. Reconnecting..."
          attempt={wsReconnecting.attempt}
          maxAttempts={wsReconnecting.max}
        />
      )}

      {/* Progress overview for running runs */}
      {(run.status === "running" || run.status === "queued") && (
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-start gap-2 text-sm min-w-0">
                <Layers className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="font-medium text-foreground">
                    {currentPipeline
                      ? buildPipelinePrimarySummary(currentPipelineIndex, totalPipelineCount, currentPipeline)
                      : `${Math.min(completedCount + 1, totalPipelineCount)}/${totalPipelineCount}`}
                  </div>
                  {currentPipeline && (
                    <div className="text-xs text-muted-foreground truncate">
                      {buildPipelineCompactSummary(currentPipeline)}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-sm font-medium">{Math.round(overallProgress)}%</span>
            </div>
            <Progress value={overallProgress} className="h-3" />
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Database className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold">{run.datasets.length}</p>
              <p className="text-xs text-muted-foreground">Datasets</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Layers className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-2xl font-bold">{run.total_pipelines || 0}</p>
              <p className="text-xs text-muted-foreground">Pipelines</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-chart-1/10">
              <CheckCircle2 className="h-5 w-5 text-chart-1" />
            </div>
            <div>
              <p className="text-2xl font-bold">{completedCount}</p>
              <p className="text-xs text-muted-foreground">Completed</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <AlertCircle className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-bold">{failedCount}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Pipelines column */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold">Pipelines</h2>
          {run.datasets.map(dataset => (
            <div key={dataset.dataset_id} className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <Database className="h-4 w-4" />
                {dataset.dataset_name}
              </div>
              {dataset.pipelines.map(pipeline => (
                <PipelineProgress
                  key={pipeline.id}
                  pipeline={pipeline}
                  pipelineIndex={pipelineIndexById.get(pipeline.id) ?? null}
                  totalPipelines={totalPipelineCount}
                  currentStepMessage={pipeline.id === currentPipeline?.id && pipeline.status === "running" ? currentProgress?.message : undefined}
                  granularProgress={pipeline.id === currentPipeline?.id && pipeline.status === "running" ? granularProgress : undefined}
                />
              ))}
            </div>
          ))}

          {/* Refit phase indicator - shown after CV phase completes */}
          {refitState.status !== "idle" && (
            <RefitPhaseIndicator refit={refitState} />
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-4">
          {/* Summary metrics */}
          {summaryPipeline && (
            <MetricsCard
              metrics={summaryMetrics}
              label={summaryLabel}
              primaryText={summaryPrimaryText}
              secondaryText={summarySecondaryText}
              variantText={summaryVariantText}
              pendingMessage={
                run.status === "running" || run.status === "queued"
                  ? "Metrics will appear here after the first completed fit for the current pipeline."
                  : undefined
              }
            />
          )}

          {/* Logs */}
          <LogsPanel
            logs={allLogs}
            isLive={run.status === "running"}
            isLoading={isLoadingLogs}
            errorMessage={logsError}
            onRefresh={loadPersistedLogs}
            onExport={handleExportLogs}
          />

          {/* Run info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Run Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Run ID</span>
                <code className="text-xs bg-muted px-1 py-0.5 rounded">{run.id}</code>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Created</span>
                <span>{new Date(run.created_at).toLocaleString()}</span>
              </div>
              {run.started_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Started</span>
                  <span>{new Date(run.started_at).toLocaleString()}</span>
                </div>
              )}
              {run.completed_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Completed</span>
                  <span>{new Date(run.completed_at).toLocaleString()}</span>
                </div>
              )}
              {run.duration && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Duration</span>
                  <span>{run.duration}</span>
                </div>
              )}
              {run.cv_folds && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">CV Folds</span>
                  <span>{run.cv_folds}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";
import type { PipelineRun, Run, RunMetrics, RunStatus } from "@/types/runs";
import type { WorkspaceRunDetail } from "@/types/enriched-runs";
import {
  buildPipelineCompactSummary,
  buildPipelinePrimarySummary,
  formatPipelineVariantLabel,
  getPipelineDisplayMetrics,
  type DisplayMetrics,
} from "@/lib/run-progress-display";

export interface RunProgressDisplayData {
  allPipelines: PipelineRun[];
  totalPipelineCount: number;
  pipelineIndexById: Map<string, number>;
  completedCount: number;
  failedCount: number;
  currentPipeline: PipelineRun | null;
  currentPipelineIndex: number | null;
  overallProgress: number;
  progressOverviewPrimaryText: string;
  progressOverviewSecondaryText: string | null;
  summaryPipeline: PipelineRun | null;
  summaryMetrics: DisplayMetrics | undefined;
  summaryLabel: string;
  summaryPrimaryText: string | undefined;
  summarySecondaryText: string | undefined;
  summaryVariantText: string | null;
}

export type RunExecutionProgressDisplayStatus = ExecutionJobRecord["status"] | RunStatus;

export interface RunExecutionProgressDisplayData {
  status: RunExecutionProgressDisplayStatus;
  progress: number;
  progressUnavailable?: boolean;
  message: string;
}

export interface BuildRunLogLinesInput {
  run: Pick<Run, "datasets" | "error">;
  persistedLogs: readonly string[];
  streamingLogs: readonly string[];
}

/** A job can fail before the scientific library writes a stored run. */
export function buildRunFromExecutionJobRecord(record: ExecutionJobRecord): Run {
  const legacy = record.request.legacyConfig;
  const config = legacy && typeof legacy === "object" && !Array.isArray(legacy)
    ? legacy as Record<string, unknown> : record.request;
  const ids = Array.isArray(config.dataset_ids) ? config.dataset_ids : [];
  return {
    id: record.run_id || record.job_id,
    name: typeof config.name === "string" && config.name.trim()
      ? config.name : record.run_name || record.job_id,
    status: record.status === "pending" ? "queued"
      : record.status === "cancelled" ? "failed"
      : record.status as RunStatus,
    created_at: record.created_at,
    started_at: record.started_at ?? undefined,
    completed_at: record.completed_at ?? undefined,
    error: record.error,
    datasets: ids.filter((id): id is string => typeof id === "string")
      .map((id) => ({ dataset_id: id, dataset_name: id, pipelines: [] })),
  };
}

/** Present a stored owner's detail through the progress page's existing view. */
export function buildRunFromWorkspaceDetail(detail: WorkspaceRunDetail): Run {
  const status = (value: string | null): RunStatus =>
    value === "completed" || value === "running" || value === "queued" || value === "partial"
      ? value : "failed";
  return {
    id: detail.run_id, name: detail.name, status: status(detail.status),
    created_at: detail.created_at, completed_at: detail.completed_at ?? undefined,
    error: detail.error, engine: detail.engine, engine_requested: detail.engine_requested,
    engine_diagnostics: detail.engine_diagnostics, allow_fallback: detail.allow_fallback,
    fallback_policy: detail.fallback_policy,
    total_pipelines: detail.pipelines.length,
    datasets: detail.datasets.map(dataset => ({
      dataset_id: dataset.linked_dataset_id ?? "", dataset_name: dataset.name,
      pipelines: detail.pipelines.filter(pipeline => pipeline.dataset_name === dataset.name).map(pipeline => ({
        id: pipeline.pipeline_id, pipeline_id: pipeline.pipeline_id, pipeline_name: pipeline.name,
        model: pipeline.name, preprocessing: "", split_strategy: pipeline.splitter_class ?? "",
        status: status(pipeline.status), progress: pipeline.status === "completed" ? 100 : 0,
        val_score: pipeline.best_val, test_score: pipeline.best_test, score_metric: pipeline.metric,
        metrics: { score: pipeline.best_test, score_metric: pipeline.metric },
        completed_at: pipeline.completed_at ?? undefined, error_message: pipeline.error ?? undefined,
        logs: pipeline.log_count === 0 ? [] : undefined,
        engine: pipeline.engine, engine_requested: pipeline.engine_requested,
        allow_fallback: pipeline.allow_fallback, fallback_policy: pipeline.fallback_policy,
      })),
    })),
  };
}

const LEGACY_RUN_STATUS_MESSAGES: Record<RunStatus, string> = {
  queued: "Run queued",
  running: "Run running",
  completed: "Run completed",
  failed: "Run failed",
  partial: "Run partially completed",
};

function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(100, Math.max(0, progress));
}

function nonBlankString(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function formatStatusFallbackMessage(prefix: string, status: string): string {
  const normalizedStatus = status.replace(/[_-]+/g, " ").trim();
  return normalizedStatus ? `${prefix} ${normalizedStatus}` : `${prefix} progress unavailable`;
}

function buildExecutionJobRecordMessage(record: ExecutionJobRecord): string {
  const error = nonBlankString(record.error);
  if ((record.status === "failed" || record.status === "cancelled") && error) {
    return error;
  }

  return nonBlankString(record.progress_message)
    ?? error
    ?? formatStatusFallbackMessage("Job", record.status);
}

function formatFoldAverageMetricParts(metrics: RunMetrics): string[] {
  const parts: string[] = [];
  if (metrics.r2 != null && metrics.r2 > 0) parts.push(`R2=${metrics.r2.toFixed(4)}`);
  if (metrics.rmse != null && metrics.rmse > 0) parts.push(`RMSE=${metrics.rmse.toFixed(4)}`);
  if (metrics.mae != null && metrics.mae > 0) parts.push(`MAE=${metrics.mae.toFixed(4)}`);
  if (metrics.rpd != null && metrics.rpd > 0) parts.push(`RPD=${metrics.rpd.toFixed(3)}`);
  return parts;
}

function formatFinalMetricParts(metrics: RunMetrics): string[] {
  const parts: string[] = [];
  if (metrics.r2 != null) parts.push(`R2=${metrics.r2.toFixed(4)}`);
  if (metrics.rmse != null && metrics.rmse > 0) parts.push(`RMSE=${metrics.rmse.toFixed(4)}`);
  if (metrics.mae != null && metrics.mae > 0) parts.push(`MAE=${metrics.mae.toFixed(4)}`);
  if (metrics.rpd != null && metrics.rpd > 0) parts.push(`RPD=${metrics.rpd.toFixed(3)}`);
  return parts;
}

function averageFoldMetrics(folds: RunMetrics[]): RunMetrics {
  const foldCount = folds.length;
  return {
    r2: folds.reduce((sum, metric) => sum + (metric.r2 ?? 0), 0) / foldCount,
    rmse: folds.reduce((sum, metric) => sum + (metric.rmse ?? 0), 0) / foldCount,
    mae: folds.reduce((sum, metric) => sum + (metric.mae ?? 0), 0) / foldCount,
    rpd: folds.reduce((sum, metric) => sum + (metric.rpd ?? 0), 0) / foldCount,
  };
}

export function buildRunDerivedLogs(run: Pick<Run, "datasets">): string[] {
  const logs: string[] = [];

  run.datasets.forEach((dataset, datasetIndex) => {
    logs.push(`[INFO] Dataset ${datasetIndex + 1}/${run.datasets.length}: ${dataset.dataset_name}`);

    dataset.pipelines.forEach((pipeline, pipelineIndex) => {
      logs.push(
        `[INFO] Pipeline ${pipelineIndex + 1}/${dataset.pipelines.length}: ${pipeline.pipeline_name} (model=${pipeline.model})`,
      );

      const folds = Object.values(pipeline.fold_metrics ?? {});
      if (folds.length > 0) {
        const parts = formatFoldAverageMetricParts(averageFoldMetrics(folds));
        if (parts.length > 0) {
          logs.push(`[INFO] Fold averages (${folds.length} folds): ${parts.join(" | ")}`);
        }
      }

      if (pipeline.metrics) {
        const parts = formatFinalMetricParts(pipeline.metrics);
        if (parts.length > 0) {
          logs.push(`[INFO] Final metrics: ${parts.join(" | ")}`);
        }
      }
    });
  });

  return logs;
}

export function buildRunLogLines({
  run,
  persistedLogs,
  streamingLogs,
}: BuildRunLogLinesInput): string[] {
  const runtimeLogs = run.datasets.flatMap((dataset) =>
    dataset.pipelines.flatMap((pipeline) => pipeline.logs ?? []),
  );

  return [...new Set([
    ...(run.error ? [`[ERROR] ${run.error}`] : []),
    ...buildRunDerivedLogs(run),
    ...persistedLogs,
    ...runtimeLogs,
    ...streamingLogs,
  ])];
}

export function buildRunProgressDisplayData(
  run: Run,
  granularVariantDescription?: string | null,
): RunProgressDisplayData {
  const allPipelines = run.datasets.flatMap((dataset) => dataset.pipelines);
  const totalPipelineCount = run.total_pipelines || allPipelines.length;
  const pipelineIndexById = new Map<string, number>();
  allPipelines.forEach((pipeline, index) => {
    pipelineIndexById.set(pipeline.id, index + 1);
  });

  const completedCount = allPipelines.filter((pipeline) => pipeline.status === "completed").length;
  const failedCount = allPipelines.filter((pipeline) => pipeline.status === "failed").length;
  const currentPipeline = allPipelines.find((pipeline) => pipeline.status === "running")
    || allPipelines.find((pipeline) => pipeline.status === "queued")
    || null;
  const currentPipelineIndex = currentPipeline ? (pipelineIndexById.get(currentPipeline.id) ?? null) : null;

  const baseProgress = totalPipelineCount
    ? (completedCount / totalPipelineCount) * 100
    : 0;
  const runningProgress = currentPipeline?.status === "running" ? currentPipeline.progress || 0 : 0;
  const runningContribution = totalPipelineCount
    ? (runningProgress / 100) * (100 / totalPipelineCount)
    : 0;
  const overallProgress = baseProgress + runningContribution;

  const completedPipelines = allPipelines.filter((pipeline) => pipeline.status === "completed" && pipeline.metrics);
  const bestPipeline = completedPipelines.length > 0
    ? completedPipelines.reduce((best, pipeline) =>
        (pipeline.metrics?.r2 ?? 0) > (best.metrics?.r2 ?? 0) ? pipeline : best,
      )
    : null;
  const bestPipelineIndex = bestPipeline ? (pipelineIndexById.get(bestPipeline.id) ?? null) : null;
  const isActiveRun = run.status === "running" || run.status === "queued";
  const summaryPipeline = isActiveRun ? currentPipeline : bestPipeline;
  const summaryPipelineIndex = summaryPipeline?.id === currentPipeline?.id
    ? currentPipelineIndex
    : bestPipelineIndex;
  const summaryMetrics = summaryPipeline ? getPipelineDisplayMetrics(summaryPipeline) : undefined;
  const summaryLabel = isActiveRun ? "Current pipeline" : "Best completed";
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
          ? granularVariantDescription ?? summaryPipeline.variant_description
          : summaryPipeline.variant_description,
      )
    : null;

  return {
    allPipelines,
    totalPipelineCount,
    pipelineIndexById,
    completedCount,
    failedCount,
    currentPipeline,
    currentPipelineIndex,
    overallProgress,
    progressOverviewPrimaryText: currentPipeline
      ? buildPipelinePrimarySummary(currentPipelineIndex, totalPipelineCount, currentPipeline)
      : `${Math.min(completedCount + 1, totalPipelineCount)}/${totalPipelineCount}`,
    progressOverviewSecondaryText: currentPipeline
      ? buildPipelineCompactSummary(currentPipeline)
      : null,
    summaryPipeline,
    summaryMetrics,
    summaryLabel,
    summaryPrimaryText,
    summarySecondaryText,
    summaryVariantText,
  };
}

function buildLegacyRunProgressMessage(
  run: Run,
  displayData: RunProgressDisplayData,
): string {
  if ((run.status === "running" || run.status === "queued") && displayData.totalPipelineCount > 0) {
    const parts = [
      displayData.progressOverviewPrimaryText,
      displayData.progressOverviewSecondaryText,
    ].filter((part): part is string => Boolean(part));
    if (parts.length > 0) {
      return parts.join(" · ");
    }
  }

  return LEGACY_RUN_STATUS_MESSAGES[run.status] ?? formatStatusFallbackMessage("Run", run.status);
}

function getLegacyRunProgress(run: Run, overallProgress: number): number {
  if (run.status === "completed") return 100;
  return clampProgress(overallProgress);
}

export function buildRunExecutionProgressDisplayData(
  run: Run,
  executionJobRecord?: ExecutionJobRecord | null,
): RunExecutionProgressDisplayData {
  if (executionJobRecord) {
    return {
      status: executionJobRecord.status,
      progress: executionJobRecord.status === "completed"
        ? 100
        : clampProgress(executionJobRecord.progress),
      ...(executionJobRecord.status !== "completed" && executionJobRecord.progress_unavailable
        ? { progressUnavailable: true } : {}),
      message: buildExecutionJobRecordMessage(executionJobRecord),
    };
  }

  const displayData = buildRunProgressDisplayData(run);
  return {
    status: run.status,
    progress: getLegacyRunProgress(run, displayData.overallProgress),
    ...(run.status !== "completed" && run.progress_unavailable ? { progressUnavailable: true } : {}),
    message: buildLegacyRunProgressMessage(run, displayData),
  };
}

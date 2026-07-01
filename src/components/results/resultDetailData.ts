import type { PipelineRun, RunStatus } from "@/types/runs";
import {
  buildRuntimeResultStatusView,
  getRuntimeResultEmptyMessage,
} from "@/ui/runtime";
import {
  buildPipelineRunArtifactRefs,
  buildResultArtifactPresentationReadModel,
  buildResultArtifactRepositoryProvenanceItems,
  buildResultArtifactSourceScopeGroupItems,
  buildResultArtifactSourceScopeReadModel,
  type ResultArtifactRef,
} from "@/lib/resultArtifacts";

export type ResultDetailTab = "results" | "json" | "logs";

export interface ResultPipelineJsonPayload {
  name: string;
  model: string;
  preprocessing: string;
  split_strategy: string;
  status: RunStatus;
  metrics: PipelineRun["metrics"];
  val_score: number | null | undefined;
  test_score: number | null | undefined;
  has_refit: boolean | undefined;
  is_final_model: boolean | undefined;
  started_at: string | undefined;
  completed_at: string | undefined;
  artifact_refs: ResultArtifactRef[];
}

export type ResultQuickFactIcon = "model" | "preprocessing" | "split";

export interface ResultHeaderStatusData {
  label: string;
  colorClass: string;
  bgClass: string;
  iconClass: string;
  badgeVariant: "default" | "secondary";
  progress: number | null;
}

export interface ResultQuickFactData {
  id: "model" | "preprocessing" | "split";
  label: string;
  value: string;
  icon: ResultQuickFactIcon;
}

export type ResultMetricCardIcon = "target" | "trophy" | "trending" | "bar";
export type ResultMetricCardVariant = "default" | "primary" | "secondary";

export interface ResultMetricCardData {
  id: string;
  label: string;
  value: number;
  format: number;
  icon: ResultMetricCardIcon;
  variant: ResultMetricCardVariant;
}

export interface ResultExecutionTimeRow {
  id: "started" | "completed";
  label: string;
  value: string;
}

export type ResultRelatedLinkIcon = "predictions" | "runs";

export interface ResultRelatedLinkData {
  id: "predictions" | "runs";
  label: string;
  to: string;
  icon: ResultRelatedLinkIcon;
}

export interface ResultArtifactSummaryGroupData {
  id: string;
  label: string;
  sourceLabel: string;
  scopeLabel: string;
  artifactCountLabel: string;
  artifactLabels: string[];
}

export interface ResultArtifactSummaryCountData {
  id: string;
  label: string;
  artifactCountLabel: string;
}

export interface ResultArtifactRepositoryProvenanceData {
  id: string;
  label: string;
  sourceLabel: string;
  contentAddressLabel: string | null;
  detailLabels: string[];
}

export interface ResultArtifactSummaryData {
  totalCount: number;
  totalCountLabel: string;
  kindItems: ResultArtifactSummaryCountData[];
  statusItems: ResultArtifactSummaryCountData[];
  groups: ResultArtifactSummaryGroupData[];
  repositoryItems: ResultArtifactRepositoryProvenanceData[];
}

export type ResultLogLineTone = "default" | "info" | "error";

export interface ResultLogLineData {
  id: string;
  text: string;
  tone: ResultLogLineTone;
}

export function hasResultMetrics(pipeline: PipelineRun): boolean {
  return !!pipeline.metrics
    || pipeline.score != null
    || pipeline.val_score != null
    || pipeline.test_score != null;
}

export function getResultEmptyMetricsMessage(status: RunStatus): string {
  return getRuntimeResultEmptyMessage(status, {
    queued: "Waiting to start...",
    running: "Results will appear when training completes",
    fallback: "No results available",
  });
}

export function buildResultHeaderStatus(pipeline: PipelineRun): ResultHeaderStatusData {
  const status = buildRuntimeResultStatusView(pipeline.status, pipeline.progress);
  return {
    label: status.label,
    colorClass: status.colorClass,
    bgClass: status.bgClass,
    iconClass: status.iconClass,
    badgeVariant: status.badgeVariant,
    progress: status.progress,
  };
}

export function buildResultQuickFacts(pipeline: PipelineRun): ResultQuickFactData[] {
  return [
    {
      id: "model",
      label: "Model",
      value: pipeline.model,
      icon: "model",
    },
    {
      id: "preprocessing",
      label: "Preprocessing",
      value: pipeline.preprocessing,
      icon: "preprocessing",
    },
    {
      id: "split",
      label: "Split",
      value: pipeline.split_strategy,
      icon: "split",
    },
  ];
}

export function buildResultScoreMetricCards(pipeline: PipelineRun): ResultMetricCardData[] {
  const cards: ResultMetricCardData[] = [];

  if (pipeline.val_score != null) {
    cards.push({
      id: "cv_score",
      label: "CV Score",
      value: pipeline.val_score,
      format: 4,
      icon: "target",
      variant: "secondary",
    });
  }

  if (pipeline.test_score != null) {
    cards.push({
      id: "final_score",
      label: "Final Score",
      value: pipeline.test_score,
      format: 4,
      icon: "trophy",
      variant: "primary",
    });
  }

  return cards;
}

export function buildResultMetricCards(pipeline: PipelineRun): ResultMetricCardData[] {
  const cards: ResultMetricCardData[] = [];

  if (pipeline.score != null && pipeline.val_score == null) {
    cards.push({
      id: "score",
      label: (pipeline.score_metric || "Score").toUpperCase(),
      value: pipeline.score,
      format: 4,
      icon: "target",
      variant: "primary",
    });
  }

  if (pipeline.metrics?.r2 != null) {
    cards.push({
      id: "r2",
      label: "R² Score",
      value: pipeline.metrics.r2,
      format: 4,
      icon: "target",
      variant: "primary",
    });
  }

  if (pipeline.metrics?.rmse != null && pipeline.metrics.rmse > 0) {
    cards.push({
      id: "rmse",
      label: "RMSE",
      value: pipeline.metrics.rmse,
      format: 4,
      icon: "trending",
      variant: "secondary",
    });
  }

  if (pipeline.metrics?.mae !== undefined) {
    cards.push({
      id: "mae",
      label: "MAE",
      value: pipeline.metrics.mae,
      format: 4,
      icon: "bar",
      variant: "default",
    });
  }

  if (pipeline.metrics?.rpd !== undefined) {
    cards.push({
      id: "rpd",
      label: "RPD",
      value: pipeline.metrics.rpd,
      format: 2,
      icon: "trending",
      variant: "default",
    });
  }

  if (pipeline.metrics?.nrmse !== undefined) {
    cards.push({
      id: "nrmse",
      label: "nRMSE",
      value: pipeline.metrics.nrmse,
      format: 4,
      icon: "bar",
      variant: "default",
    });
  }

  return cards;
}

export function buildResultExecutionTimeRows(pipeline: PipelineRun): ResultExecutionTimeRow[] {
  const rows: ResultExecutionTimeRow[] = [];
  if (pipeline.started_at) {
    rows.push({ id: "started", label: "Started", value: pipeline.started_at });
  }
  if (pipeline.completed_at) {
    rows.push({ id: "completed", label: "Completed", value: pipeline.completed_at });
  }
  return rows;
}

export function buildResultRelatedLinks(pipeline: PipelineRun, datasetName: string): ResultRelatedLinkData[] {
  return [
    {
      id: "predictions",
      label: "Predictions",
      to: `/predictions?dataset=${encodeURIComponent(datasetName)}&config=${encodeURIComponent(pipeline.pipeline_name)}`,
      icon: "predictions",
    },
    {
      id: "runs",
      label: "Runs",
      to: "/runs",
      icon: "runs",
    },
  ];
}

export function buildResultArtifactSummary(pipeline: PipelineRun): ResultArtifactSummaryData {
  const refs = buildPipelineRunArtifactRefs(pipeline);
  const presentation = buildResultArtifactPresentationReadModel(refs);
  const sourceScope = buildResultArtifactSourceScopeReadModel(refs);
  const groups = buildResultArtifactSourceScopeGroupItems(sourceScope.groups).map(group => ({
    id: group.id,
    label: group.label,
    sourceLabel: group.sourceLabel,
    scopeLabel: group.scopeLabel,
    artifactCountLabel: group.artifactCountLabel,
    artifactLabels: group.refs.map(ref => ref.label),
  }));
  const repositoryItems = buildResultArtifactRepositoryProvenanceItems(refs).map(item => ({
    id: item.id,
    label: item.label,
    sourceLabel: item.sourceLabel,
    contentAddressLabel: item.contentAddressLabel,
    detailLabels: item.detailLabels.length > 0 ? item.detailLabels : [item.sourceLabel],
  }));

  return {
    totalCount: presentation.totalArtifactCount,
    totalCountLabel: presentation.totalArtifactCountLabel,
    kindItems: presentation.kindItems.map(item => ({
      id: item.id,
      label: item.label,
      artifactCountLabel: item.artifactCountLabel,
    })),
    statusItems: presentation.statusItems.map(item => ({
      id: item.id,
      label: item.label,
      artifactCountLabel: item.artifactCountLabel,
    })),
    groups,
    repositoryItems,
  };
}

export function getResultExportModelLabel(hasRefit: boolean | undefined): string {
  return hasRefit ? "Export Final Model (.n4a)" : "Export Model (.n4a)";
}

export function getResultExportModelDescription(hasRefit: boolean | undefined): string | null {
  return hasRefit ? "Exports the refit model trained on the full dataset" : null;
}

export function getResultLogLineTone(log: string): ResultLogLineTone {
  if (log.includes("[ERROR]")) return "error";
  if (log.includes("[INFO]")) return "info";
  return "default";
}

export function buildResultLogRows(logs: readonly string[]): ResultLogLineData[] {
  return logs.map((log, index) => ({
    id: `${index}-${log}`,
    text: log,
    tone: getResultLogLineTone(log),
  }));
}

export function buildResultPipelineJsonPayload(pipeline: PipelineRun): ResultPipelineJsonPayload {
  return {
    name: pipeline.pipeline_name,
    model: pipeline.model,
    preprocessing: pipeline.preprocessing,
    split_strategy: pipeline.split_strategy,
    status: pipeline.status,
    metrics: pipeline.metrics,
    val_score: pipeline.val_score,
    test_score: pipeline.test_score,
    has_refit: pipeline.has_refit,
    is_final_model: pipeline.is_final_model,
    started_at: pipeline.started_at,
    completed_at: pipeline.completed_at,
    artifact_refs: buildPipelineRunArtifactRefs(pipeline),
  };
}

export function buildResultPipelineJson(pipeline: PipelineRun): string {
  return JSON.stringify(buildResultPipelineJsonPayload(pipeline), null, 2);
}

export function getResultExecutionLogs(pipeline: PipelineRun): string[] {
  if (pipeline.logs && pipeline.logs.length > 0) return pipeline.logs;

  if (pipeline.status === "queued") return ["[INFO] Waiting in queue..."];
  if (pipeline.status === "failed") {
    return [
      "[INFO] Starting pipeline execution...",
      "[INFO] Loading dataset...",
      "[INFO] Dataset loaded: 250 samples, 1024 features",
      "[INFO] Applying SNV preprocessing...",
      "[ERROR] Failed to process spectrum at index 142",
      "[ERROR] ValueError: Invalid spectrum values detected",
      "[ERROR] Pipeline execution failed",
    ];
  }

  return [
    "[INFO] Starting pipeline execution...",
    "[INFO] Loading dataset...",
    "[INFO] Dataset loaded: 250 samples, 1024 features",
    `[INFO] Applying ${pipeline.preprocessing} preprocessing...`,
    "[INFO] Preprocessing complete",
    `[INFO] Training ${pipeline.model} model...`,
    `[INFO] Using ${pipeline.split_strategy} validation strategy`,
    "[INFO] Model training complete",
    pipeline.status === "running"
      ? `[INFO] Cross-validation in progress... ${pipeline.progress}%`
      : `[INFO] Final R² score: ${pipeline.metrics?.r2?.toFixed(4)}`,
  ];
}

import type { PipelineRun, RunStatus } from "@/types/runs";
import {
  buildRuntimeResultStatusView,
  getRuntimeResultEmptyMessage,
} from "@/ui/runtime";
import {
  createConformalCoverageOptions,
  createConformalCoverageStrip,
  createConformalGuaranteeViewForArtifact,
  createConformalIntervalSummaryRows,
  createConformalMetricRows,
  isCalibratedRunResultArtifact,
  isConformalMetricSet,
  type CalibratedRunResultArtifact,
  type ConformalCoverageOption,
  type ConformalCoverageStripSegment,
  type ConformalGuaranteeView,
  type ConformalIntervalSummaryRow,
  type ConformalMetricRow,
  type ConformalMetricSet,
} from "@/ui/conformal";
import {
  createRobustnessGuaranteeView,
  createRobustnessSummaryCards,
  getRobustnessSpectralReplay,
  isRobustnessSummaryArtifact,
  type RobustnessSummaryArtifact,
  type RobustnessSummaryCard,
  type RobustnessSpectralReplay,
} from "@/ui/robustness";
import {
  createTuningSummaryCard,
  createTuningSummaryTrialRows,
  createTuningStudySummary,
  createTuningTrialRows,
  isTuningResultArtifact,
  isTuningSummaryArtifact,
  type TuningResultArtifact,
  type TuningStudySummary,
  type TuningSummaryArtifact,
  type TuningTrialRow,
} from "@/ui/tuning";
import {
  buildPipelineRunArtifactRefs,
  buildResultArtifactPresentationReadModel,
  buildResultArtifactRepositoryProvenanceItems,
  buildResultArtifactSourceScopeGroupItems,
  buildResultArtifactSourceScopeReadModel,
  formatResultArtifactCountLabel,
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

export interface ResultNativeResultsSummaryData {
  artifactCount: number;
  artifactCountLabel: string;
  hasNativeResults: boolean;
}

export interface ResultConformalSummaryData {
  coverageStrip: ConformalCoverageStripSegment[];
  coverages: ConformalCoverageOption[];
  fingerprint: string | null;
  guarantee: ConformalGuaranteeView;
  intervals: ConformalIntervalSummaryRow[];
  metrics: ConformalMetricRow[];
  method: string;
  nPredictions: number;
  unit: string;
}

export interface ResultRobustnessSummaryData {
  fingerprint: string;
  guarantee: ConformalGuaranteeView;
  mode: RobustnessSummaryArtifact["mode"];
  reportVersion: number;
  sliceBy: string[];
  spectralReplay: RobustnessSpectralReplay | null;
  cards: RobustnessSummaryCard[];
}

export interface ResultRobustnessLaunchScenarioData {
  distribution: string | null;
  executionScope: "baseline" | "prediction_replay" | "spectral_replay";
  kind: string;
  label: string;
  requiresSpectralReplay: boolean;
  severity: number | null;
}

export interface ResultRobustnessExecutionDiagnosticData {
  blockers: string[];
  message: string;
  requiresPredictor: boolean;
  requiresPredictions: boolean;
  requiresSpectra: boolean;
  requiresTruth: boolean;
  status: string;
}

export interface ResultRobustnessLaunchPlanData {
  execution: ResultRobustnessExecutionDiagnosticData | null;
  mode: string;
  scenarioCount: number;
  scenarios: ResultRobustnessLaunchScenarioData[];
  sliceBy: string[];
}

export interface ResultTuningSummaryData {
  persistence: ResultTuningPersistenceData | null;
  study: TuningStudySummary;
  trials: TuningTrialRow[];
}

export interface ResultTuningPersistenceData {
  optimizerStateResumeSupported: boolean | null;
  resume: boolean | null;
  storageConfigured: boolean | null;
  studyName: string | null;
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
    || pipeline.test_score != null
    || buildResultConformalSummary(pipeline) != null
    || buildResultRobustnessSummary(pipeline) != null
    || buildResultRobustnessLaunchPlan(pipeline) != null
    || buildResultTuningSummary(pipeline) != null;
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

function isNativeResultArtifactRef(ref: ResultArtifactRef): boolean {
  const source = typeof ref.metadata?.source === "string" ? ref.metadata.source : null;
  return (
    ref.source === "native-results"
    || ref.source === "result-repository"
    || ref.source === "cluster-run"
    || ref.kind === "repository_entry"
    || source === "native_results"
    || source === "native_result_refs"
    || source === "rt_result"
  );
}

export function buildResultNativeResultsSummary(pipeline: PipelineRun): ResultNativeResultsSummaryData {
  const nativeRefs = buildPipelineRunArtifactRefs(pipeline).filter(isNativeResultArtifactRef);
  return {
    artifactCount: nativeRefs.length,
    artifactCountLabel: formatResultArtifactCountLabel(nativeRefs.length),
    hasNativeResults: nativeRefs.length > 0,
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nestedValue(source: unknown, keys: readonly string[]): unknown {
  let current: unknown = source;
  for (const key of keys) {
    const record = readRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function collectRobustnessSummaryCandidates(pipeline: PipelineRun): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const directCandidates = [
    record.robustness_summary,
    record.robustnessSummary,
    record.robustness_summary_artifact,
    record.robustnessSummaryArtifact,
    nestedValue(record.robustness, ["summary_artifact"]),
    nestedValue(record.robustness, ["summaryArtifact"]),
    nestedValue(record.native_results, ["robustness_summary"]),
    nestedValue(record.native_results, ["robustnessSummary"]),
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.robustness_summary,
      metadata.robustnessSummary,
      metadata.robustness_summary_artifact,
      metadata.robustnessSummaryArtifact,
      metadata.summary_artifact,
      metadata.summaryArtifact,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function collectRobustnessLaunchPlanCandidates(pipeline: PipelineRun): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const directCandidates = [
    record.robustness_plan,
    record.robustnessPlan,
    nestedValue(record.robustness, ["launch_plan"]),
    nestedValue(record.robustness, ["launchPlan"]),
    record.robustness,
    nestedValue(record.native_results, ["robustness_plan"]),
    nestedValue(record.native_results, ["robustnessPlan"]),
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.robustness_plan,
      metadata.robustnessPlan,
      metadata.robustness_launch_plan,
      metadata.robustnessLaunchPlan,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function collectRobustnessExecutionCandidates(pipeline: PipelineRun): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const directCandidates = [
    record.robustness_execution,
    record.robustnessExecution,
    nestedValue(record.robustness, ["execution"]),
    nestedValue(record.native_results, ["robustness_execution"]),
    nestedValue(record.native_results, ["robustnessExecution"]),
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.robustness_execution,
      metadata.robustnessExecution,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function collectConformalResultCandidates(pipeline: PipelineRun): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const directCandidates = [
    record.calibrated_result,
    record.calibratedResult,
    record.conformal_result,
    record.conformalResult,
    record.conformal_calibrated_result,
    record.conformalCalibratedResult,
    nestedValue(record.conformal, ["calibrated_result"]),
    nestedValue(record.conformal, ["calibratedResult"]),
    nestedValue(record.native_results, ["calibrated_result"]),
    nestedValue(record.native_results, ["calibratedResult"]),
    nestedValue(record.native_results, ["conformal_result"]),
    nestedValue(record.native_results, ["conformalResult"]),
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.calibrated_result,
      metadata.calibratedResult,
      metadata.conformal_result,
      metadata.conformalResult,
      metadata.conformal_calibrated_result,
      metadata.conformalCalibratedResult,
      metadata.calibrated_result_artifact,
      metadata.calibratedResultArtifact,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function collectConformalMetricCandidates(pipeline: PipelineRun, artifact: CalibratedRunResultArtifact): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const artifactMetadata = artifact.metadata;
  const artifactPayload = artifact.artifact;
  const directCandidates = [
    record.conformal_metrics,
    record.conformalMetrics,
    record.conformal_metric_sets,
    record.conformalMetricSets,
    nestedValue(record.conformal, ["metrics"]),
    nestedValue(record.conformal, ["metric_sets"]),
    nestedValue(record.conformal, ["metricSets"]),
    nestedValue(record.native_results, ["conformal_metrics"]),
    nestedValue(record.native_results, ["conformalMetrics"]),
    artifactMetadata.conformal_metrics,
    artifactMetadata.conformalMetrics,
    artifactMetadata.conformal_metric_sets,
    artifactMetadata.conformalMetricSets,
    artifactMetadata.metric_sets,
    artifactMetadata.metricSets,
    artifactPayload.conformal_metrics,
    artifactPayload.conformalMetrics,
    artifactPayload.metric_sets,
    artifactPayload.metricSets,
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.conformal_metrics,
      metadata.conformalMetrics,
      metadata.conformal_metric_sets,
      metadata.conformalMetricSets,
      metadata.metric_sets,
      metadata.metricSets,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function extractConformalMetricSets(candidates: readonly unknown[]): ConformalMetricSet[] {
  const metrics: ConformalMetricSet[] = [];
  for (const candidate of candidates) {
    if (isConformalMetricSet(candidate)) {
      metrics.push(candidate);
      continue;
    }
    if (Array.isArray(candidate)) {
      metrics.push(...candidate.filter(isConformalMetricSet));
    }
  }
  return metrics;
}

function collectTuningResultCandidates(pipeline: PipelineRun): unknown[] {
  const record = pipeline as PipelineRun & Record<string, unknown>;
  const directCandidates = [
    record.tuning_result,
    record.tuningResult,
    nestedValue(record.tuning, ["result"]),
    nestedValue(record.tuning, ["summary"]),
    nestedValue(record.tuning, ["tuning_result"]),
    nestedValue(record.tuning, ["tuningResult"]),
    nestedValue(record.tuning, ["tuning_summary"]),
    nestedValue(record.tuning, ["tuningSummary"]),
    nestedValue(record.native_results, ["tuning_result"]),
    nestedValue(record.native_results, ["tuningResult"]),
    nestedValue(record.native_results, ["tuning_summary"]),
    nestedValue(record.native_results, ["tuningSummary"]),
  ];

  const artifactCandidates = buildPipelineRunArtifactRefs(pipeline).flatMap(ref => {
    const metadata = ref.metadata ?? {};
    return [
      metadata.tuning_result,
      metadata.tuningResult,
      metadata.tuning_result_artifact,
      metadata.tuningResultArtifact,
      metadata.tuning_summary,
      metadata.tuningSummary,
      metadata.tuning_summary_artifact,
      metadata.tuningSummaryArtifact,
    ];
  });

  return [...directCandidates, ...artifactCandidates].filter(candidate => candidate != null);
}

function adaptTuningSummaryArtifact(artifact: TuningSummaryArtifact): ResultTuningSummaryData {
  const card = createTuningSummaryCard(artifact);
  const rows = createTuningSummaryTrialRows(artifact).map((row): TuningTrialRow => ({
    diagnostics: row.diagnostics,
    isBest: row.value !== null && row.value === card.bestValue,
    number: row.number,
    params: {},
    paramsLabel: "summary artifact",
    status: row.status,
    statusLabel: row.statusLabel,
    tone: row.tone,
    value: row.value,
    valueLabel: row.valueLabel,
  }));
  const study: TuningStudySummary = {
    bestParams: card.bestParams,
    bestValue: card.bestValue,
    bestValueLabel: card.bestValueLabel,
    completeTrials: card.completeTrials,
    direction: card.direction,
    failedTrials: card.failedTrials,
    fingerprint: card.fingerprint,
    metric: card.metric,
    nTrials: card.nTrials,
    optimizer: card.optimizer,
    pruner: card.pruner,
    prunedTrials: card.prunedTrials,
    runningTrials: card.runningTrials,
    sampler: card.sampler,
    searchSpaceSize: Object.keys(card.bestParams).length,
    seed: card.seed,
    studyName: card.studyName,
  };
  return {
    persistence: card.persistence
      ? {
          optimizerStateResumeSupported: card.optimizerStateResumeSupported,
          resume: card.resume,
          storageConfigured: card.storageConfigured,
          studyName: card.studyName,
        }
      : null,
    study,
    trials: rows,
  };
}

function tuningPersistenceFromResultArtifact(artifact: TuningResultArtifact): ResultTuningPersistenceData {
  return {
    optimizerStateResumeSupported: artifact.tuning.engine === "optuna",
    resume: artifact.tuning.resume,
    storageConfigured: artifact.tuning.storage !== null,
    studyName: artifact.tuning.study_name,
  };
}

export function buildResultConformalSummary(pipeline: PipelineRun): ResultConformalSummaryData | null {
  for (const candidate of collectConformalResultCandidates(pipeline)) {
    if (!isCalibratedRunResultArtifact(candidate)) continue;
    const artifact: CalibratedRunResultArtifact = candidate;
    const coverages = createConformalCoverageOptions(artifact);
    const intervals = createConformalIntervalSummaryRows(artifact);
    const metrics = createConformalMetricRows(
      extractConformalMetricSets(collectConformalMetricCandidates(pipeline, artifact)),
    );
    return {
      coverageStrip: createConformalCoverageStrip(coverages, intervals),
      coverages,
      fingerprint: artifact.fingerprint ?? null,
      guarantee: createConformalGuaranteeViewForArtifact(artifact),
      intervals,
      metrics,
      method: artifact.prediction.method,
      nPredictions: artifact.prediction.y_pred.length,
      unit: artifact.prediction.unit,
    };
  }

  return null;
}

export function buildResultTuningSummary(pipeline: PipelineRun): ResultTuningSummaryData | null {
  for (const candidate of collectTuningResultCandidates(pipeline)) {
    if (isTuningResultArtifact(candidate)) {
      return {
        persistence: tuningPersistenceFromResultArtifact(candidate),
        study: createTuningStudySummary(candidate),
        trials: createTuningTrialRows(candidate),
      };
    }
    if (isTuningSummaryArtifact(candidate)) {
      return adaptTuningSummaryArtifact(candidate);
    }
  }

  return null;
}

export function buildResultRobustnessSummary(pipeline: PipelineRun): ResultRobustnessSummaryData | null {
  for (const candidate of collectRobustnessSummaryCandidates(pipeline)) {
    if (!isRobustnessSummaryArtifact(candidate)) continue;
    return {
      fingerprint: candidate.fingerprint,
      guarantee: createRobustnessGuaranteeView(candidate),
      mode: candidate.mode,
      reportVersion: candidate.report_version,
      sliceBy: candidate.slice_by,
      spectralReplay: getRobustnessSpectralReplay(candidate),
      cards: createRobustnessSummaryCards(candidate),
    };
  }

  return null;
}

function formatScenarioKind(kind: string): string {
  return kind.replace(/_/g, " ");
}

const ROBUSTNESS_SPECTRAL_SCENARIO_KINDS = new Set([
  "spectral_noise",
  "spectral_offset",
  "spectral_scale",
  "spectral_slope",
  "spectral_shift",
]);

function getRobustnessScenarioExecutionScope(
  kind: string,
): ResultRobustnessLaunchScenarioData["executionScope"] {
  if (kind === "observed") return "baseline";
  if (ROBUSTNESS_SPECTRAL_SCENARIO_KINDS.has(kind)) return "spectral_replay";
  return "prediction_replay";
}

function normalizeRobustnessLaunchScenario(value: unknown): ResultRobustnessLaunchScenarioData | null {
  const record = readRecord(value);
  if (!record || typeof record.kind !== "string" || record.kind.trim().length === 0) {
    return null;
  }
  const severity = typeof record.severity === "number" && Number.isFinite(record.severity)
    ? record.severity
    : null;
  const distribution = typeof record.distribution === "string" && record.distribution.trim().length > 0
    ? record.distribution
    : null;
  const kind = record.kind.trim();
  const executionScope = getRobustnessScenarioExecutionScope(kind);

  return {
    distribution,
    executionScope,
    kind,
    label: formatScenarioKind(kind),
    requiresSpectralReplay: executionScope === "spectral_replay",
    severity,
  };
}

function normalizeRobustnessSliceBy(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(item => item.trim());
}

function normalizeRobustnessExecutionDiagnostic(value: unknown): ResultRobustnessExecutionDiagnosticData | null {
  const record = readRecord(value);
  if (!record || typeof record.status !== "string" || record.status.trim().length === 0) {
    return null;
  }

  return {
    blockers: Array.isArray(record.blockers)
      ? record.blockers.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [],
    message: typeof record.message === "string" && record.message.trim().length > 0
      ? record.message
      : "Robustness execution status is available.",
    requiresPredictor: record.requires_predictor === true || record.requiresPredictor === true,
    requiresPredictions: record.requires_predictions === true || record.requiresPredictions === true,
    requiresSpectra: record.requires_X === true || record.requiresX === true || record.requiresSpectra === true,
    requiresTruth: record.requires_y_true === true || record.requiresYTrue === true || record.requiresTruth === true,
    status: record.status,
  };
}

function buildResultRobustnessExecutionDiagnostic(pipeline: PipelineRun): ResultRobustnessExecutionDiagnosticData | null {
  for (const candidate of collectRobustnessExecutionCandidates(pipeline)) {
    const diagnostic = normalizeRobustnessExecutionDiagnostic(candidate);
    if (diagnostic) return diagnostic;
  }
  return null;
}

export function buildResultRobustnessLaunchPlan(pipeline: PipelineRun): ResultRobustnessLaunchPlanData | null {
  for (const candidate of collectRobustnessLaunchPlanCandidates(pipeline)) {
    const record = readRecord(candidate);
    if (!record || !Array.isArray(record.scenarios)) continue;

    const scenarios = record.scenarios
      .map(normalizeRobustnessLaunchScenario)
      .filter((scenario): scenario is ResultRobustnessLaunchScenarioData => scenario != null);
    if (scenarios.length === 0) continue;

    return {
      execution: buildResultRobustnessExecutionDiagnostic(pipeline),
      mode: typeof record.mode === "string" && record.mode.trim().length > 0 ? record.mode : "clean_frozen",
      scenarioCount: scenarios.length,
      scenarios,
      sliceBy: normalizeRobustnessSliceBy(record.slice_by ?? record.sliceBy),
    };
  }

  return null;
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

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildCanonicalPreviewSteps } from "@/lib/canonicalPipelinePreview";
import { computePipelineStats } from "@/lib/pipelineStats";
import { isClassificationTask } from "@/components/runs/modelDetailClassification";
import {
  getChainDetail,
  getChainPartitionDetail,
  getChainPipelineSteps,
  getPredictionArrays,
  computePredictionRobustnessReport,
  getPredictionRobustnessEvidence,
} from "@/api/aggregatedPredictions";
import type {
  ChainDetailResponse,
  ChainSummary,
  PartitionPrediction,
  PredictionArraysResponse,
  PredictionRobustnessEvidenceResponse,
  PredictionRobustnessReportRequest,
} from "@/types/aggregated-predictions";
import type { ScoreCardType } from "@/types/score-cards";
import { usePartitionsData } from "@/components/predictions/viewer/fetchPartitionData";
import { usePredictionChartConfig } from "@/components/predictions/viewer/usePredictionChartConfig";
import {
  buildFoldModelArtifactRefs,
  buildAttachedChainSummaryArtifactRefs,
  buildPredictionArraysArtifactRef,
  buildResultArtifactAuditItems,
  buildResultArtifactPresentationReadModel,
  buildResultArtifactSourceScopeGroupItems,
  buildResultArtifactSourceScopeReadModel,
  type ResultArtifactAuditItem,
  type ResultArtifactRef,
} from "@/lib/resultArtifacts";
import type {
  ChartConfig,
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from "@/components/predictions/viewer/types";
import { attachConformalIntervalsToSingleDataset } from "@/components/predictions/viewer/conformalChartData";
import {
  createConformalCoverageOptions,
  createConformalCoverageStrip,
  createConformalGuaranteeViewForArtifact,
  createConformalIntervalSummaryRows,
  createConformalMetricRows,
  createConformalPredictionRows,
  isCalibratedRunResultArtifact,
  isConformalMetricSet,
  type CalibratedRunResultArtifact,
  type ConformalCoverageOption,
  type ConformalCoverageStripSegment,
  type ConformalGuaranteeView,
  type ConformalIntervalSummaryRow,
  type ConformalMetricRow,
  type ConformalMetricSet,
  type ConformalPredictionRow,
} from "@/ui/conformal";
import {
  createRobustnessGuaranteeView,
  createRobustnessSummaryCards,
  getRobustnessSpectralReplay,
  getRobustnessScenarioDistributionOptionsFromRegistry,
  getRobustnessScenarioKindOptions,
  getRobustnessScenarioKindOptionsFromRegistry,
  isRobustnessSummaryArtifact,
  validateRobustnessScenarioDraft,
  type RobustnessScenarioDraft,
  type RobustnessScenarioDistribution,
  type RobustnessScenarioKind,
  type RobustnessScenarioKindOption,
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
import type { KeywordRegistryDocument } from "@/ui/keywordRegistry";
import {
  buildCvMetricRows,
  buildFoldGroups,
  buildPipelineTreeWithParams,
  formatBranchPath,
  parseGeneratorChoices,
  parseRecord,
  resolveInitialFoldId,
  resolvePrimaryCvMetric,
  residualSummary,
  summarize,
} from "./chainDetailData";

/** Lightweight metadata used to render the header before the ChainSummary
 *  fetch resolves (avoids a blank header during the opening animation). */
export interface ChainDetailMetaHint {
  modelName?: string | null;
  modelClass?: string | null;
  datasetName?: string | null;
  metric?: string | null;
  taskType?: string | null;
  preprocessings?: string | null;
  pipelineStatus?: string | null;
}

export interface ChainDetailFocus {
  cardType?: ScoreCardType | null;
  foldId?: string | null;
  predictionId?: string | null;
}

type OpenViewerHandler = (
  partitions: ViewerPartitionTarget[],
  header: ViewerHeader,
  kind: ChartKind,
) => void;

export interface ChainDetailArtifactSummaryCount {
  id: string;
  label: string;
  artifactCount: number;
  artifactCountLabel: string;
}

export interface ChainDetailArtifactProvenanceGroup {
  id: string;
  label: string;
  sourceLabel: string;
  scopeLabel: string;
  artifactCount: number;
  artifactCountLabel: string;
  artifactLabels: string[];
}

export interface ChainDetailArtifactSummary {
  refs: ResultArtifactRef[];
  totalCount: number;
  totalCountLabel: string;
  kindItems: ChainDetailArtifactSummaryCount[];
  statusItems: ChainDetailArtifactSummaryCount[];
  provenanceGroups: ChainDetailArtifactProvenanceGroup[];
  auditItems: ResultArtifactAuditItem[];
}

export interface ChainDetailConformalSummary {
  coverageStrip: ConformalCoverageStripSegment[];
  coverages: ConformalCoverageOption[];
  fingerprint: string | null;
  guarantee: ConformalGuaranteeView;
  intervals: ConformalIntervalSummaryRow[];
  metrics: ConformalMetricRow[];
  method: string;
  nPredictions: number;
  rows: ConformalPredictionRow[];
  unit: string;
}

export interface ChainDetailRobustnessSummary {
  fingerprint: string;
  guarantee: ConformalGuaranteeView;
  mode: RobustnessSummaryArtifact["mode"];
  reportVersion: number;
  sliceBy: string[];
  spectralReplay: RobustnessSpectralReplay | null;
  cards: RobustnessSummaryCard[];
}

export interface ChainDetailTuningSummary {
  persistence: ChainDetailTuningPersistence | null;
  study: TuningStudySummary;
  trials: TuningTrialRow[];
}

export interface ChainDetailTuningPersistence {
  optimizerStateResumeSupported: boolean | null;
  resume: boolean | null;
  storageConfigured: boolean | null;
  studyName: string | null;
}

export type ChainDetailRobustnessScenarioKind = RobustnessScenarioKind;

export interface ChainDetailRobustnessScenarioOption extends RobustnessScenarioKindOption {
  kind: ChainDetailRobustnessScenarioKind;
  description: string;
  severityLabel: string;
}

export interface ChainDetailRobustnessUnavailableScenario {
  kind: RobustnessScenarioKind;
  label: string;
  reason: string;
}

const CHAIN_DETAIL_STORED_PREDICTION_SCENARIOS = new Set<RobustnessScenarioKind>([
  "observed",
  "prediction_bias",
  "prediction_noise",
]);

const CHAIN_DETAIL_ROBUSTNESS_LABELS: Partial<Record<ChainDetailRobustnessScenarioKind, string>> = {
  observed: "Observed",
  prediction_bias: "Prediction bias",
  prediction_noise: "Prediction noise",
  spectral_noise: "Spectral noise",
  spectral_offset: "Spectral offset",
  spectral_scale: "Spectral scale",
  spectral_slope: "Spectral slope",
  spectral_shift: "Spectral shift",
};

const CHAIN_DETAIL_ROBUSTNESS_DESCRIPTIONS: Partial<Record<ChainDetailRobustnessScenarioKind, string>> = {
  observed: "Baseline audit on stored predictions.",
  prediction_bias: "Adds a deterministic offset to stored predictions.",
  prediction_noise: "Adds seeded normal or uniform noise to stored predictions.",
  spectral_noise: "Adds seeded normal or uniform noise to stored X/spectra and replays the saved predictor bundle.",
  spectral_offset: "Applies a deterministic offset to stored X/spectra and replays the saved predictor bundle.",
  spectral_scale: "Applies a multiplicative scale delta to stored X/spectra and replays the saved predictor bundle.",
  spectral_slope: "Applies a linear spectral ramp to stored X/spectra and replays the saved predictor bundle.",
  spectral_shift: "Applies a spectral shift to stored X/spectra and replays the saved predictor bundle.",
};

const CHAIN_DETAIL_ROBUSTNESS_SEVERITY_LABELS: Partial<Record<ChainDetailRobustnessScenarioKind, string>> = {
  observed: "Forced to 0",
  prediction_bias: "Offset",
  prediction_noise: "Severity",
  spectral_noise: "Severity",
  spectral_offset: "Offset",
  spectral_scale: "Scale delta",
  spectral_slope: "Ramp amplitude",
  spectral_shift: "Shift",
};

interface ChainDetailRobustnessScenarioAvailability {
  includeSpectralReplay?: boolean;
}

function isChainDetailScenarioAvailable(
  option: RobustnessScenarioKindOption,
  availability: ChainDetailRobustnessScenarioAvailability,
): boolean {
  if (CHAIN_DETAIL_STORED_PREDICTION_SCENARIOS.has(option.value) && !option.requiresExplicitPredictor) {
    return true;
  }
  return availability.includeSpectralReplay === true && option.requiresExplicitPredictor;
}

export const CHAIN_DETAIL_ROBUSTNESS_SCENARIO_OPTIONS: ChainDetailRobustnessScenarioOption[] =
  buildChainDetailRobustnessScenarioOptions();

export const CHAIN_DETAIL_ROBUSTNESS_UNAVAILABLE_SCENARIOS: ChainDetailRobustnessUnavailableScenario[] =
  buildChainDetailRobustnessUnavailableScenarios();

export function buildChainDetailRobustnessScenarioOptions(
  registry?: KeywordRegistryDocument | null,
  availability: ChainDetailRobustnessScenarioAvailability = {},
): ChainDetailRobustnessScenarioOption[] {
  const sourceOptions = registry
    ? getRobustnessScenarioKindOptionsFromRegistry(registry)
    : getRobustnessScenarioKindOptions();

  return sourceOptions
    .filter((option) => isChainDetailScenarioAvailable(option, availability))
    .map((option) => ({
      ...option,
      kind: option.value,
      label: registry
        ? option.label || CHAIN_DETAIL_ROBUSTNESS_LABELS[option.value] || option.value
        : CHAIN_DETAIL_ROBUSTNESS_LABELS[option.value] || option.label,
      description: CHAIN_DETAIL_ROBUSTNESS_DESCRIPTIONS[option.value]
        ?? "Native robustness scenario delegated to nirs4all.",
      severityLabel: CHAIN_DETAIL_ROBUSTNESS_SEVERITY_LABELS[option.value] ?? "Severity",
    }));
}

export function buildChainDetailRobustnessUnavailableScenarios(
  registry?: KeywordRegistryDocument | null,
  availability: ChainDetailRobustnessScenarioAvailability = {},
): ChainDetailRobustnessUnavailableScenario[] {
  const sourceOptions = registry
    ? getRobustnessScenarioKindOptionsFromRegistry(registry)
    : getRobustnessScenarioKindOptions();

  return sourceOptions
    .filter((option) => !isChainDetailScenarioAvailable(option, availability))
    .map((option) => ({
      kind: option.value,
      label: option.label,
      reason: option.requiresExplicitPredictor
        ? "Requires explicit spectra and a frozen predictor replay surface."
        : "Not exposed by the stored-prediction robustness endpoint yet.",
    }));
}

interface UseChainDetailPanelStateOptions {
  chainId: string;
  metric?: string | null;
  metaHint?: ChainDetailMetaHint;
  focus?: ChainDetailFocus;
  keywordRegistry?: KeywordRegistryDocument | null;
  onOpenViewer?: OpenViewerHandler;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function robustnessSummaryCandidates(summary: ChainSummary): unknown[] {
  const record = summary as ChainSummary & Record<string, unknown>;
  const direct = [
    record.robustness_summary,
    record.robustnessSummary,
  ];
  const refs = [
    ...(Array.isArray(record.artifact_refs) ? record.artifact_refs : []),
    ...(Array.isArray(record.artifactRefs) ? record.artifactRefs : []),
  ];
  const fromRefs = refs.flatMap((ref) => {
    const metadata = recordOrNull(recordOrNull(ref)?.metadata);
    if (!metadata) return [];
    return [
      metadata.robustness_summary,
      metadata.robustnessSummary,
      metadata.robustness_summary_artifact,
      metadata.robustnessSummaryArtifact,
      metadata.summary_artifact,
      metadata.summaryArtifact,
    ];
  });
  return [...direct, ...fromRefs].filter(candidate => candidate != null);
}

function conformalResultCandidates(summary: ChainSummary): unknown[] {
  const record = summary as ChainSummary & Record<string, unknown>;
  const direct = [
    record.calibrated_result,
    record.calibratedResult,
    record.conformal_result,
    record.conformalResult,
    record.conformal_calibrated_result,
    record.conformalCalibratedResult,
  ];
  const refs = [
    ...(Array.isArray(record.artifact_refs) ? record.artifact_refs : []),
    ...(Array.isArray(record.artifactRefs) ? record.artifactRefs : []),
  ];
  const fromRefs = refs.flatMap((ref) => {
    const metadata = recordOrNull(recordOrNull(ref)?.metadata);
    if (!metadata) return [];
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
  return [...direct, ...fromRefs].filter(candidate => candidate != null);
}

function conformalMetricCandidates(summary: ChainSummary, artifact: CalibratedRunResultArtifact): unknown[] {
  const record = summary as ChainSummary & Record<string, unknown>;
  const artifactMetadata = artifact.metadata;
  const artifactPayload = artifact.artifact;
  const direct = [
    record.conformal_metrics,
    record.conformalMetrics,
    record.conformal_metric_sets,
    record.conformalMetricSets,
    recordOrNull(record.conformal)?.metrics,
    recordOrNull(record.conformal)?.metric_sets,
    recordOrNull(record.conformal)?.metricSets,
    recordOrNull(record.native_results)?.conformal_metrics,
    recordOrNull(record.native_results)?.conformalMetrics,
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
  const refs = [
    ...(Array.isArray(record.artifact_refs) ? record.artifact_refs : []),
    ...(Array.isArray(record.artifactRefs) ? record.artifactRefs : []),
  ];
  const fromRefs = refs.flatMap((ref) => {
    const metadata = recordOrNull(recordOrNull(ref)?.metadata);
    if (!metadata) return [];
    return [
      metadata.conformal_metrics,
      metadata.conformalMetrics,
      metadata.conformal_metric_sets,
      metadata.conformalMetricSets,
      metadata.metric_sets,
      metadata.metricSets,
    ];
  });
  return [...direct, ...fromRefs].filter(candidate => candidate != null);
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

function tuningResultCandidates(summary: ChainSummary): unknown[] {
  const record = summary as ChainSummary & Record<string, unknown>;
  const direct = [
    record.tuning_result,
    record.tuningResult,
    recordOrNull(record.tuning)?.result,
    recordOrNull(record.tuning)?.summary,
    recordOrNull(record.tuning)?.tuning_result,
    recordOrNull(record.tuning)?.tuningResult,
    recordOrNull(record.tuning)?.tuning_summary,
    recordOrNull(record.tuning)?.tuningSummary,
    recordOrNull(record.native_results)?.tuning_result,
    recordOrNull(record.native_results)?.tuningResult,
    recordOrNull(record.native_results)?.tuning_summary,
    recordOrNull(record.native_results)?.tuningSummary,
  ];
  const refs = [
    ...(Array.isArray(record.artifact_refs) ? record.artifact_refs : []),
    ...(Array.isArray(record.artifactRefs) ? record.artifactRefs : []),
  ];
  const fromRefs = refs.flatMap((ref) => {
    const metadata = recordOrNull(recordOrNull(ref)?.metadata);
    if (!metadata) return [];
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
  return [...direct, ...fromRefs].filter(candidate => candidate != null);
}

function adaptChainTuningSummaryArtifact(artifact: TuningSummaryArtifact): ChainDetailTuningSummary {
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

function chainTuningPersistenceFromResultArtifact(artifact: TuningResultArtifact): ChainDetailTuningPersistence {
  return {
    optimizerStateResumeSupported: artifact.tuning.engine === "optuna",
    resume: artifact.tuning.resume,
    storageConfigured: artifact.tuning.storage !== null,
    studyName: artifact.tuning.study_name,
  };
}

function buildChainDetailConformalSummary(summary: ChainSummary): ChainDetailConformalSummary | null {
  for (const candidate of conformalResultCandidates(summary)) {
    if (!isCalibratedRunResultArtifact(candidate)) continue;
    const artifact: CalibratedRunResultArtifact = candidate;
    const coverages = createConformalCoverageOptions(artifact);
    const intervals = createConformalIntervalSummaryRows(artifact);
    return {
      coverageStrip: createConformalCoverageStrip(coverages, intervals),
      coverages,
      fingerprint: artifact.fingerprint ?? null,
      guarantee: createConformalGuaranteeViewForArtifact(artifact),
      intervals,
      metrics: createConformalMetricRows(
        extractConformalMetricSets(conformalMetricCandidates(summary, artifact)),
      ),
      method: artifact.prediction.method,
      nPredictions: artifact.prediction.y_pred.length,
      rows: createConformalPredictionRows(artifact),
      unit: artifact.prediction.unit,
    };
  }
  return null;
}

function buildChainDetailTuningSummary(summary: ChainSummary): ChainDetailTuningSummary | null {
  for (const candidate of tuningResultCandidates(summary)) {
    if (isTuningResultArtifact(candidate)) {
      return {
        persistence: chainTuningPersistenceFromResultArtifact(candidate),
        study: createTuningStudySummary(candidate),
        trials: createTuningTrialRows(candidate),
      };
    }
    if (isTuningSummaryArtifact(candidate)) {
      return adaptChainTuningSummaryArtifact(candidate);
    }
  }
  return null;
}

function resolveDefaultConformalCoverage(summary: ChainDetailConformalSummary | null): number | null {
  if (!summary) return null;
  return summary.coverages.find(option => option.selected && option.materialized)?.coverage
    ?? summary.coverages.find(option => option.materialized)?.coverage
    ?? summary.rows[0]?.intervals[0]?.coverage
    ?? null;
}

function buildChainDetailRobustnessSummary(summary: ChainSummary): ChainDetailRobustnessSummary | null {
  for (const candidate of robustnessSummaryCandidates(summary)) {
    const normalized = buildChainDetailRobustnessSummaryFromArtifact(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function buildChainDetailRobustnessSummaryFromArtifact(value: unknown): ChainDetailRobustnessSummary | null {
  if (!isRobustnessSummaryArtifact(value)) return null;
  return {
    fingerprint: value.fingerprint,
    guarantee: createRobustnessGuaranteeView(value),
    mode: value.mode,
    reportVersion: value.report_version,
    sliceBy: value.slice_by,
    spectralReplay: getRobustnessSpectralReplay(value),
    cards: createRobustnessSummaryCards(value),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return "Failed to compute native robustness report.";
}

function robustnessScenarioLabel(
  kind: ChainDetailRobustnessScenarioKind,
  options: readonly ChainDetailRobustnessScenarioOption[],
): string {
  return options.find((option) => option.kind === kind)?.label
    ?? CHAIN_DETAIL_ROBUSTNESS_LABELS[kind]
    ?? kind;
}

function buildRobustnessScenarioPayload(
  kind: ChainDetailRobustnessScenarioKind,
  severityInput: string,
  distribution: RobustnessScenarioDistribution,
  options: readonly ChainDetailRobustnessScenarioOption[] = CHAIN_DETAIL_ROBUSTNESS_SCENARIO_OPTIONS,
): {
  error: string | null;
  scenario: PredictionRobustnessReportRequest["robustness"]["scenarios"][number] | null;
} {
  const option = options.find((candidate) => candidate.kind === kind);
  if (!option) {
    return {
      error: "This robustness scenario is not available for the selected prediction evidence.",
      scenario: null,
    };
  }
  if (kind === "observed") {
    return { error: null, scenario: { kind: "observed", severity: 0 } };
  }
  const severity = Number(severityInput);
  if (!Number.isFinite(severity)) {
    return { error: "Severity must be a finite number.", scenario: null };
  }
  if ((kind === "prediction_noise" || kind === "spectral_noise") && severity < 0) {
    return { error: `${robustnessScenarioLabel(kind, options)} severity must be non-negative.`, scenario: null };
  }
  if (kind === "spectral_scale" && severity <= -1) {
    return { error: "Spectral scale severity must keep 1 + severity positive.", scenario: null };
  }
  const scenario: PredictionRobustnessReportRequest["robustness"]["scenarios"][number] = option.stochastic
    ? { kind, severity, distribution }
    : { kind, severity };
  const issues = validateRobustnessScenarioDraft(scenario);
  if (issues.length > 0) {
    return { error: issues[0].message, scenario: null };
  }
  return { error: null, scenario };
}

export function useChainDetailPanelState({
  chainId,
  metric,
  metaHint,
  focus,
  keywordRegistry,
  onOpenViewer,
}: UseChainDetailPanelStateOptions) {
  const [detail, setDetail] = useState<ChainDetailResponse | null>(null);
  const [partitionRows, setPartitionRows] = useState<PartitionPrediction[]>([]);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const [selectedFoldId, setSelectedFoldId] = useState<string>("");
  const [arrayData, setArrayData] = useState<PredictionArraysResponse | null>(null);
  const [loadingArrays, setLoadingArrays] = useState(false);
  const [previewKind, setPreviewKind] = useState<ChartKind>("scatter");
  const [pipelineSteps, setPipelineSteps] = useState<unknown[] | null>(null);
  const [selectedConformalCoverage, setSelectedConformalCoverage] = useState<number | null>(null);
  const [generatedRobustnessSummary, setGeneratedRobustnessSummary] = useState<ChainDetailRobustnessSummary | null>(null);
  const [generatedRobustnessId, setGeneratedRobustnessId] = useState<string | null>(null);
  const [computingRobustness, setComputingRobustness] = useState(false);
  const [robustnessActionError, setRobustnessActionError] = useState<string | null>(null);
  const [robustnessScenarioKind, setRobustnessScenarioKind] = useState<ChainDetailRobustnessScenarioKind>("observed");
  const [robustnessSeverity, setRobustnessSeverity] = useState("0.05");
  const [robustnessDistribution, setRobustnessDistribution] = useState<RobustnessScenarioDistribution>("normal");
  const [robustnessEvidence, setRobustnessEvidence] = useState<PredictionRobustnessEvidenceResponse | null>(null);
  const [loadingRobustnessEvidence, setLoadingRobustnessEvidence] = useState(false);

  const includeSpectralReplayScenarios = robustnessEvidence?.can_compute_spectral_report === true;
  const robustnessScenarioOptions = useMemo(
    () => buildChainDetailRobustnessScenarioOptions(keywordRegistry, {
      includeSpectralReplay: includeSpectralReplayScenarios,
    }),
    [includeSpectralReplayScenarios, keywordRegistry],
  );
  const robustnessUnavailableScenarios = useMemo(
    () => buildChainDetailRobustnessUnavailableScenarios(keywordRegistry, {
      includeSpectralReplay: includeSpectralReplayScenarios,
    }),
    [includeSpectralReplayScenarios, keywordRegistry],
  );
  const robustnessDistributionOptions = useMemo(
    () => getRobustnessScenarioDistributionOptionsFromRegistry(keywordRegistry, robustnessScenarioKind),
    [keywordRegistry, robustnessScenarioKind],
  );

  useEffect(() => {
    if (robustnessScenarioOptions.some((option) => option.kind === robustnessScenarioKind)) return;
    setRobustnessScenarioKind(robustnessScenarioOptions[0]?.kind ?? "observed");
  }, [robustnessScenarioKind, robustnessScenarioOptions]);
  useEffect(() => {
    const enabledOptions = robustnessDistributionOptions.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) return;
    if (enabledOptions.some((option) => option.value === robustnessDistribution)) return;
    setRobustnessDistribution(enabledOptions[0]?.value ?? "normal");
  }, [robustnessDistribution, robustnessDistributionOptions]);

  const prediction = useMemo<ChainSummary>(() => {
    const summary = detail?.summary;
    if (summary) return summary;
    const stub: ChainSummary = {
      run_id: "",
      pipeline_id: "",
      chain_id: chainId,
      model_name: metaHint?.modelName ?? null,
      model_class: metaHint?.modelClass ?? "",
      preprocessings: metaHint?.preprocessings ?? null,
      branch_path: null,
      source_index: null,
      model_step_idx: 0,
      metric: metaHint?.metric ?? metric ?? null,
      task_type: metaHint?.taskType ?? null,
      dataset_name: metaHint?.datasetName ?? null,
      best_params: null,
      cv_val_score: null,
      cv_test_score: null,
      cv_train_score: null,
      cv_fold_count: 0,
      cv_scores: null,
      final_test_score: null,
      final_train_score: null,
      final_scores: null,
      pipeline_status: metaHint?.pipelineStatus ?? null,
      fold_artifacts: null,
    };
    return stub;
  }, [detail, chainId, metric, metaHint]);

  const configDatasetKey = useMemo(
    () => `__current__::${prediction.dataset_name}`,
    [prediction.dataset_name],
  );
  const [sharedConfig] = usePredictionChartConfig({ datasetKey: configDatasetKey });
  const panelConfig = useMemo<ChartConfig>(
    () => ({
      ...sharedConfig,
      regressionLine: false,
      sigmaBand: false,
      confusionShowTotals: true,
    }),
    [sharedConfig],
  );

  const taskKind: "regression" | "classification" = useMemo(
    () => (isClassificationTask(prediction.task_type) ? "classification" : "regression"),
    [prediction.task_type],
  );

  useEffect(() => {
    setPreviewKind((current) => {
      if (taskKind === "classification") {
        return current === "confusion" || current === "distribution" ? current : "confusion";
      }
      return current === "confusion" ? "scatter" : current;
    });
  }, [taskKind]);

  useEffect(() => {
    let cancelled = false;
    setGeneratedRobustnessSummary(null);
    setGeneratedRobustnessId(null);
    setRobustnessActionError(null);
    async function load() {
      setLoadingSummary(true);
      try {
        const [chainDetail, partitions] = await Promise.all([
          getChainDetail(chainId, {
            metric: metric ?? undefined,
            dataset_name: metaHint?.datasetName ?? undefined,
          }),
          getChainPartitionDetail(chainId),
        ]);
        if (cancelled) return;
        setDetail(chainDetail);
        setPartitionRows(partitions.predictions);
      } catch (err) {
        if (!cancelled) console.error("Failed to load chain detail:", err);
      } finally {
        if (!cancelled) setLoadingSummary(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [chainId, metric, metaHint?.datasetName]);

  useEffect(() => {
    let cancelled = false;
    setPipelineSteps(null);
    getChainPipelineSteps(chainId)
      .then((result) => {
        if (!cancelled) setPipelineSteps(Array.isArray(result?.pipeline) ? result.pipeline : []);
      })
      .catch(() => {
        if (!cancelled) setPipelineSteps(null);
      });
    return () => {
      cancelled = true;
    };
  }, [chainId]);

  useEffect(() => {
    if (partitionRows.length === 0) return;
    setSelectedFoldId((current) => current && partitionRows.some((row) => row.fold_id === current)
      ? current
      : resolveInitialFoldId(partitionRows, focus, prediction));
  }, [partitionRows, focus, prediction]);

  const foldGroups = useMemo(() => buildFoldGroups(partitionRows), [partitionRows]);
  const selectedGroup = useMemo(
    () => foldGroups.find((group) => group.foldId === selectedFoldId) ?? null,
    [foldGroups, selectedFoldId],
  );
  const selectedPrediction = selectedGroup?.representative ?? null;
  const selectedFoldPartitions = useMemo(
    () => selectedGroup?.rows ?? [],
    [selectedGroup],
  );

  const robustnessScenarioValidation = useMemo(
    () => buildRobustnessScenarioPayload(
      robustnessScenarioKind,
      robustnessSeverity,
      robustnessDistribution,
      robustnessScenarioOptions,
    ),
    [robustnessDistribution, robustnessScenarioKind, robustnessScenarioOptions, robustnessSeverity],
  );

  const computeRobustnessReport = useCallback(async () => {
    if (!selectedPrediction || computingRobustness) return;
    const { error, scenario } = buildRobustnessScenarioPayload(
      robustnessScenarioKind,
      robustnessSeverity,
      robustnessDistribution,
      robustnessScenarioOptions,
    );
    if (error || !scenario) {
      setRobustnessActionError(error ?? "Invalid robustness scenario.");
      return;
    }
    setComputingRobustness(true);
    setRobustnessActionError(null);
    try {
      const response = await computePredictionRobustnessReport(selectedPrediction.prediction_id, {
        robustness: {
          mode: "clean_frozen",
          scenarios: [scenario],
        },
        name: `Studio ${robustnessScenarioLabel(robustnessScenarioKind, robustnessScenarioOptions)} robustness report`,
      });
      const summary = buildChainDetailRobustnessSummaryFromArtifact(response.summary_artifact);
      if (!summary) {
        throw new Error("Native robustness endpoint returned an invalid summary artifact.");
      }
      setGeneratedRobustnessSummary(summary);
      setGeneratedRobustnessId(response.robustness_id);
    } catch (error) {
      setRobustnessActionError(errorMessage(error));
    } finally {
      setComputingRobustness(false);
    }
  }, [
    computingRobustness,
    robustnessDistribution,
    robustnessScenarioKind,
    robustnessScenarioOptions,
    robustnessSeverity,
    selectedPrediction,
  ]);

  const attachedRobustnessSummary = useMemo(
    () => buildChainDetailRobustnessSummary(prediction),
    [prediction],
  );
  const robustnessSummary = generatedRobustnessSummary ?? attachedRobustnessSummary;
  const conformalSummary = useMemo(
    () => buildChainDetailConformalSummary(prediction),
    [prediction],
  );
  const tuningSummary = useMemo(
    () => buildChainDetailTuningSummary(prediction),
    [prediction],
  );
  useEffect(() => {
    setSelectedConformalCoverage(resolveDefaultConformalCoverage(conformalSummary));
  }, [conformalSummary]);

  useEffect(() => {
    if (!selectedPrediction) {
      setArrayData(null);
      return;
    }
    const predictionId = selectedPrediction.prediction_id;
    let cancelled = false;
    async function run() {
      setLoadingArrays(true);
      try {
        const data = await getPredictionArrays(predictionId);
        if (!cancelled) setArrayData(data);
      } catch {
        if (!cancelled) setArrayData(null);
      } finally {
        if (!cancelled) setLoadingArrays(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrediction]);

  useEffect(() => {
    if (!selectedPrediction) {
      setRobustnessEvidence(null);
      return;
    }
    const predictionId = selectedPrediction.prediction_id;
    let cancelled = false;
    async function run() {
      setLoadingRobustnessEvidence(true);
      try {
        const evidence = await getPredictionRobustnessEvidence(predictionId);
        if (!cancelled) setRobustnessEvidence(evidence);
      } catch {
        if (!cancelled) setRobustnessEvidence(null);
      } finally {
        if (!cancelled) setLoadingRobustnessEvidence(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrediction]);

  const baseChartTargets = useMemo<ViewerPartitionTarget[]>(
    () => selectedFoldPartitions.map((predictionRow) => ({
      predictionId: predictionRow.prediction_id,
      partition: (predictionRow.partition ?? "").toLowerCase(),
      label: predictionRow.partition ?? "",
      source: "aggregated" as const,
    })),
    [selectedFoldPartitions],
  );
  const chartTargets = useMemo<ViewerPartitionTarget[]>(() => {
    if (!conformalSummary || baseChartTargets.length !== 1) return baseChartTargets;
    return baseChartTargets.map(target => ({
      ...target,
      conformalRows: conformalSummary.rows,
      conformalCoverage: selectedConformalCoverage,
    }));
  }, [baseChartTargets, conformalSummary, selectedConformalCoverage]);

  const chartHeader = useMemo<ViewerHeader | null>(() => {
    if (!selectedPrediction) return null;
    return {
      datasetName: selectedPrediction.dataset_name ?? prediction.dataset_name ?? "",
      modelName: selectedPrediction.model_name ?? prediction.model_name ?? null,
      preprocessings: selectedPrediction.preprocessings ?? prediction.preprocessings ?? null,
      foldId: selectedPrediction.fold_id ?? null,
      taskType: selectedPrediction.task_type ?? prediction.task_type ?? null,
      valScore: selectedPrediction.val_score ?? null,
      testScore: selectedPrediction.test_score ?? null,
      trainScore: selectedPrediction.train_score ?? null,
      nSamples: selectedPrediction.n_samples ?? null,
      nFeatures: selectedPrediction.n_features ?? null,
    };
  }, [selectedPrediction, prediction]);

  const { data: chartDatasets, isLoading: chartsLoading, error: chartsError } = usePartitionsData({
    partitions: chartTargets,
    enabled: chartTargets.length > 0,
  });

  const handleCustomize = (kind: ChartKind) => {
    if (!chartHeader || chartTargets.length === 0) return;
    onOpenViewer?.(chartTargets, chartHeader, kind);
  };
  const canCustomize = !!onOpenViewer && !!chartHeader && chartTargets.length > 0;
  const chartBodyKey = `${previewKind}:${selectedGroup?.foldId ?? "none"}:${chartTargets.map((target) => target.predictionId).join("|")}`;

  const preprocessLabel = prediction.preprocessings || "None";
  const variantParams = useMemo(() => {
    const parsed = parseRecord(prediction.variant_params);
    return parsed && Object.keys(parsed).length > 0 ? parsed : null;
  }, [prediction.variant_params]);
  const bestParams = useMemo(() => {
    const fromSummary = parseRecord(prediction.best_params);
    if (fromSummary && Object.keys(fromSummary).length > 0) return fromSummary;
    const selectedRows = selectedGroup?.rows ?? [];
    for (const row of [...selectedRows, ...partitionRows]) {
      const candidate = parseRecord(row.best_params);
      if (candidate && Object.keys(candidate).length > 0) return candidate;
    }
    return null;
  }, [prediction.best_params, selectedGroup, partitionRows]);

  const previewPipelineSteps = useMemo(() => {
    if (!pipelineSteps || pipelineSteps.length === 0) return null;
    return buildCanonicalPreviewSteps(pipelineSteps);
  }, [pipelineSteps]);
  const pipelineStats = useMemo(
    () => (previewPipelineSteps ? computePipelineStats(previewPipelineSteps) : null),
    [previewPipelineSteps],
  );
  const pipelineTree = useMemo(
    () => (previewPipelineSteps ? buildPipelineTreeWithParams(previewPipelineSteps, 24) : null),
    [previewPipelineSteps],
  );

  const generatorChoices = useMemo(
    () => parseGeneratorChoices(detail?.pipeline?.generator_choices),
    [detail?.pipeline?.generator_choices],
  );
  const branchPathLabel = useMemo(() => formatBranchPath(prediction.branch_path), [prediction.branch_path]);

  const vectorSummaries = useMemo(
    () => chartDatasets.map((dataset) => ({
      dataset,
      observed: summarize(dataset.yTrue),
      predicted: summarize(dataset.yPred),
      residuals: residualSummary(dataset.yTrue, dataset.yPred),
    })),
    [chartDatasets],
  );

  const arrayArtifactRef = useMemo(
    () => arrayData
      ? buildPredictionArraysArtifactRef(arrayData, {
        runId: prediction.run_id,
        pipelineId: selectedPrediction?.pipeline_id ?? prediction.pipeline_id,
        chainId: selectedPrediction?.chain_id ?? prediction.chain_id,
        datasetName: selectedPrediction?.dataset_name ?? prediction.dataset_name,
        metric: selectedPrediction?.metric ?? prediction.metric,
      })
      : null,
    [arrayData, prediction, selectedPrediction],
  );

  const artifactSummary = useMemo<ChainDetailArtifactSummary>(() => {
    const refs = [
      ...buildAttachedChainSummaryArtifactRefs(prediction),
      ...buildFoldModelArtifactRefs(prediction.fold_artifacts, {
        runId: prediction.run_id,
        pipelineId: selectedPrediction?.pipeline_id ?? prediction.pipeline_id,
        chainId: prediction.chain_id,
        datasetName: prediction.dataset_name,
        metric: prediction.metric,
      }),
      ...(arrayArtifactRef ? [arrayArtifactRef] : []),
    ];
    const presentation = buildResultArtifactPresentationReadModel(refs);
    const provenance = buildResultArtifactSourceScopeReadModel(refs);

    return {
      refs: presentation.refs,
      totalCount: presentation.totalArtifactCount,
      totalCountLabel: presentation.totalArtifactCountLabel,
      kindItems: presentation.kindItems.map((item) => ({
        id: item.id,
        label: item.label,
        artifactCount: item.artifactCount,
        artifactCountLabel: item.artifactCountLabel,
      })),
      statusItems: presentation.statusItems.map((item) => ({
        id: item.id,
        label: item.label,
        artifactCount: item.artifactCount,
        artifactCountLabel: item.artifactCountLabel,
      })),
      provenanceGroups: buildResultArtifactSourceScopeGroupItems(provenance.groups).map((group) => ({
        id: group.id,
        label: group.label,
        sourceLabel: group.sourceLabel,
        scopeLabel: group.scopeLabel,
        artifactCount: group.artifactCount,
        artifactCountLabel: group.artifactCountLabel,
        artifactLabels: group.refs.map((ref) => ref.label),
      })),
      auditItems: buildResultArtifactAuditItems(refs),
    };
  }, [arrayArtifactRef, prediction, selectedPrediction]);

  const chartDatasetsWithConformal = useMemo(
    () => attachConformalIntervalsToSingleDataset(
      chartDatasets,
      conformalSummary?.rows ?? [],
      selectedConformalCoverage,
    ),
    [chartDatasets, conformalSummary, selectedConformalCoverage],
  );

  const cvMetricRows = useMemo(
    () => buildCvMetricRows(prediction.cv_scores, prediction.metric),
    [prediction.cv_scores, prediction.metric],
  );
  const primaryCvMetric = useMemo(
    () => resolvePrimaryCvMetric(prediction.metric, cvMetricRows),
    [prediction.metric, cvMetricRows],
  );
  const additionalCvMetricRows = useMemo(
    () => cvMetricRows.filter((row) => row.metric !== primaryCvMetric),
    [cvMetricRows, primaryCvMetric],
  );

  return {
    detail,
    prediction,
    loadingSummary,
    selectedFoldId,
    setSelectedFoldId,
    previewKind,
    setPreviewKind,
    panelConfig,
    taskKind,
    foldGroups,
    selectedGroup,
    selectedPrediction,
    selectedFoldPartitions,
    chartTargets,
    chartDatasets: chartDatasetsWithConformal,
    chartsLoading,
    chartsError,
    canCustomize,
    handleCustomize,
    chartBodyKey,
    preprocessLabel,
    variantParams,
    bestParams,
    pipelineStats,
    pipelineTree,
    generatorChoices,
    branchPathLabel,
    vectorSummaries,
    arrayData,
    arrayArtifactRef,
    artifactSummary,
    conformalSummary,
    tuningSummary,
    selectedConformalCoverage,
    setSelectedConformalCoverage,
    robustnessSummary,
    computeRobustnessReport,
    computingRobustness,
    generatedRobustnessId,
    robustnessActionError,
    robustnessScenarioKind,
    setRobustnessScenarioKind,
    robustnessScenarioOptions,
    robustnessUnavailableScenarios,
    robustnessSeverity,
    setRobustnessSeverity,
    robustnessDistribution,
    setRobustnessDistribution,
    robustnessDistributionOptions,
    robustnessEvidence,
    loadingRobustnessEvidence,
    robustnessScenarioValidationError: robustnessScenarioValidation.error,
    canComputeRobustness: !!selectedPrediction && !computingRobustness && !robustnessScenarioValidation.error,
    loadingArrays,
    additionalCvMetricRows,
  };
}

import { getInspectorFiniteScore, sortInspectorChainsByScore } from "@/lib/inspector/scoreAccess";
import { projectInspectorChainsMetricObservations } from "@/lib/inspector/metricObservationProjection";
import { buildResultAnalysisEntriesFromMetricRecords } from "@/lib/inspector/resultAnalysisMetricRecords";
import {
  normalizeFiniteScore,
  normalizeFoldCount,
  normalizeRecord,
  normalizeRequiredText,
  normalizeText,
  sortedValues,
} from "@/lib/inspector/resultAnalysisStoreNormalization";
import type { AggregatedPredictionsResponse, ChainSummary } from "@/types/aggregated-predictions";
import type { InspectorChainSummary, MetricObservation, ScoreColumn, ScoreRef } from "@/types/inspector";
import type { Result, ResultListResponse } from "@/types/runs";
import type { AvailableChain, AvailableModelsResponse, DatasetChains } from "@/types/shap";

export type ResultAnalysisStoreKind =
  | "inspector_chain_summaries"
  | "benchmark_export"
  | "result_repository";

export interface ResultAnalysisStoreSource {
  id: string;
  kind: ResultAnalysisStoreKind;
  label?: string;
}

export interface ResultAnalysisScopeSummary {
  totalChains: number;
  metrics: string[];
  taskTypes: string[];
  datasetNames: string[];
  runIds: string[];
  modelClasses: string[];
  pipelineIds: string[];
  hasMixedMetrics: boolean;
  hasMixedTaskTypes: boolean;
  hasRegression: boolean;
  hasClassification: boolean;
}

export interface ResultAnalysisStore {
  source: ResultAnalysisStoreSource;
  chains: readonly InspectorChainSummary[];
  chainIds: readonly string[];
  chainById: ReadonlyMap<string, InspectorChainSummary>;
  metricObservations: readonly MetricObservation[];
  metricObservationById: ReadonlyMap<string, MetricObservation>;
  scope: ResultAnalysisScopeSummary;
}

export interface ResultAnalysisBestScoreEntry {
  chain: InspectorChainSummary;
  score: number;
}

export interface BuildResultAnalysisStoreInput {
  chains: readonly InspectorChainSummary[];
  source?: Partial<ResultAnalysisStoreSource>;
}

export interface ResultAnalysisEntryDefaults {
  runId?: string;
  pipelineId?: string;
  pipelineName?: string | null;
  modelClass?: string;
  modelName?: string | null;
  preprocessings?: string | null;
  preprocessingSteps?: readonly string[];
  metric?: string | null;
  taskType?: string | null;
  datasetName?: string | null;
  pipelineStatus?: string | null;
  cvFoldCount?: number;
}

export interface ResultAnalysisChainEntry {
  chainId: string;
  runId?: string;
  pipelineId?: string;
  pipelineName?: string | null;
  modelClass?: string;
  modelName?: string | null;
  preprocessings?: string | null;
  preprocessingSteps?: readonly string[];
  branchPath?: unknown;
  sourceIndex?: number | null;
  metric?: string | null;
  taskType?: string | null;
  datasetName?: string | null;
  bestParams?: Record<string, unknown> | null;
  variantParams?: Record<string, unknown> | null;
  scores?: Partial<Record<ScoreColumn, number | null>>;
  cvFoldCount?: number;
  pipelineStatus?: string | null;
}

export type ResultAnalysisMetricScoreSlot =
  | ScoreColumn
  | "cv_val"
  | "cv_validation"
  | "validation"
  | "val"
  | "cv_test"
  | "test"
  | "cv_train"
  | "train"
  | "final_test"
  | "holdout"
  | "final_train";

export interface ResultAnalysisMetricRecord {
  resultId?: string;
  chainId?: string;
  runId?: string;
  pipelineId?: string;
  pipelineName?: string | null;
  modelClass?: string;
  modelName?: string | null;
  preprocessings?: string | null;
  preprocessingSteps?: readonly string[];
  branchPath?: unknown;
  sourceIndex?: number | null;
  metric?: string | null;
  metricVersion?: string | null;
  scoreColumn?: ResultAnalysisMetricScoreSlot;
  scoreRef?: ScoreRef;
  ref?: ScoreRef;
  score: unknown;
  taskType?: string | null;
  datasetName?: string | null;
  targetName?: string | null;
  bestParams?: Record<string, unknown> | null;
  variantParams?: Record<string, unknown> | null;
  cvFoldCount?: number;
  pipelineStatus?: string | null;
  split?: string | null;
  foldIndex?: number | null;
  randomSeed?: string | number | null;
  refit?: boolean | null;
  backend?: string | null;
  contentAddress?: string | null;
  sourceRef?: string | null;
  dimensions?: Record<string, unknown>;
}

export interface BuildResultAnalysisStoreFromEntriesInput {
  entries: readonly ResultAnalysisChainEntry[];
  source: ResultAnalysisStoreSource;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromMetricRecordsInput {
  records: readonly ResultAnalysisMetricRecord[];
  source: ResultAnalysisStoreSource;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromResultsInput {
  results: readonly Result[];
  source?: Partial<ResultAnalysisStoreSource>;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromResultListResponseInput {
  response: Pick<ResultListResponse, "workspace_id" | "results">;
  source?: Partial<ResultAnalysisStoreSource>;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromChainSummariesInput {
  summaries: readonly ChainSummary[];
  source?: Partial<ResultAnalysisStoreSource>;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromAggregatedPredictionsResponseInput {
  response: Pick<AggregatedPredictionsResponse, "predictions">;
  source?: Partial<ResultAnalysisStoreSource>;
  defaults?: ResultAnalysisEntryDefaults;
}

export interface BuildResultAnalysisStoreFromShapAvailableModelsInput {
  response: Pick<AvailableModelsResponse, "datasets">;
  source?: Partial<ResultAnalysisStoreSource>;
  defaults?: ResultAnalysisEntryDefaults;
}

function resolvePreprocessingLabel(
  entry: Pick<ResultAnalysisChainEntry, "preprocessings" | "preprocessingSteps">,
  defaults: ResultAnalysisEntryDefaults | undefined,
  preprocessingSteps: readonly string[],
): string | null {
  return normalizeText(entry.preprocessings)
    ?? normalizeText(defaults?.preprocessings)
    ?? (preprocessingSteps.length > 0 ? preprocessingSteps.join(" | ") : null);
}

function buildRepositoryResultSource(
  source: Partial<ResultAnalysisStoreSource> | undefined,
  fallbackId: string,
): ResultAnalysisStoreSource {
  return {
    id: normalizeRequiredText(source?.id, fallbackId),
    kind: source?.kind ?? "result_repository",
    label: source?.label,
  };
}

function buildRepositoryResultScores(result: Result): Partial<Record<ScoreColumn, number | null>> {
  const scores: Partial<Record<ScoreColumn, number | null>> = {};
  if (result.val_score !== undefined || result.best_score !== undefined) {
    scores.cv_val_score = result.val_score ?? result.best_score ?? null;
  }
  if (result.test_score !== undefined) {
    scores.final_test_score = result.test_score;
  }
  return scores;
}

function buildRepositoryResultVariantParams(result: Result, index: number): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    result_id: result.id,
    result_index: index,
  };

  if (result.run_id != null) metadata.run_id = result.run_id;
  if (result.template_id != null) metadata.template_id = result.template_id;
  if (result.created_at != null) metadata.created_at = result.created_at;
  if (result.schema_version != null) metadata.schema_version = result.schema_version;
  if (result.generator_choices != null) metadata.generator_choices = result.generator_choices;
  if (result.best_score != null) metadata.best_score = result.best_score;
  if (result.n_samples != null) metadata.n_samples = result.n_samples;
  if (result.n_features != null) metadata.n_features = result.n_features;
  if (result.predictions_count != null) metadata.predictions_count = result.predictions_count;
  if (result.artifact_count != null) metadata.artifact_count = result.artifact_count;
  if (result.manifest_path != null) metadata.manifest_path = result.manifest_path;
  if (result.has_refit != null) metadata.refit = result.has_refit;
  if (result.refit_model_id != null) metadata.refit_model_id = result.refit_model_id;

  return { result_metadata: metadata };
}

function toResultAnalysisEntryFromResult(result: Result, index: number): ResultAnalysisChainEntry {
  return {
    chainId: result.id,
    runId: result.run_id,
    pipelineId: result.pipeline_config_id,
    pipelineName: result.pipeline_config,
    modelClass: result.best_model,
    modelName: result.best_model,
    metric: result.metric,
    taskType: result.task_type,
    datasetName: result.dataset,
    variantParams: buildRepositoryResultVariantParams(result, index),
    scores: buildRepositoryResultScores(result),
  };
}

function buildChainSummaryVariantParams(summary: ChainSummary): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  if (summary.model_step_idx != null) metadata.model_step_idx = summary.model_step_idx;
  if (summary.cv_scores != null) metadata.cv_scores = summary.cv_scores;
  if (summary.score_maps != null) metadata.score_maps = summary.score_maps;
  if (summary.cv_source_chain_id != null) metadata.cv_source_chain_id = summary.cv_source_chain_id;
  if (summary.final_scores != null) metadata.final_scores = summary.final_scores;
  if (summary.final_agg_scores != null) metadata.final_agg_scores = summary.final_agg_scores;
  if (summary.final_agg_test_score != null) metadata.final_agg_test_score = summary.final_agg_test_score;
  if (summary.final_agg_train_score != null) metadata.final_agg_train_score = summary.final_agg_train_score;
  if (summary.fold_artifacts != null) metadata.fold_artifacts = summary.fold_artifacts;
  if (summary.synthetic_refit != null) metadata.synthetic_refit = summary.synthetic_refit;
  if (summary.is_refit_only != null) metadata.is_refit_only = summary.is_refit_only;

  const baseParams = normalizeRecord(summary.variant_params) ?? {};
  if (Object.keys(metadata).length === 0) {
    return Object.keys(baseParams).length > 0 ? baseParams : null;
  }
  return {
    ...baseParams,
    prediction_metadata: metadata,
  };
}

function inspectorChainPredictionMetadata(chain: InspectorChainSummary): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};

  if (chain.cv_scores != null) metadata.cv_scores = chain.cv_scores;
  if (chain.score_maps != null) metadata.score_maps = chain.score_maps;
  if (chain.final_scores != null) metadata.final_scores = chain.final_scores;
  if (chain.final_agg_scores != null) metadata.final_agg_scores = chain.final_agg_scores;
  if (chain.final_agg_test_score != null) metadata.final_agg_test_score = chain.final_agg_test_score;
  if (chain.final_agg_train_score != null) metadata.final_agg_train_score = chain.final_agg_train_score;

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function mergeInspectorChainPredictionMetadata(chain: InspectorChainSummary): InspectorChainSummary {
  const metadata = inspectorChainPredictionMetadata(chain);
  if (metadata == null) return chain;

  const baseParams = normalizeRecord(chain.variant_params) ?? {};
  const existingPredictionMetadata = normalizeRecord(baseParams.prediction_metadata) ?? {};
  return {
    ...chain,
    variant_params: {
      ...baseParams,
      prediction_metadata: {
        ...existingPredictionMetadata,
        ...metadata,
      },
    },
  };
}

function toResultAnalysisChainSummaryFromChainSummary(
  summary: ChainSummary,
  source: ResultAnalysisStoreSource,
  defaults?: ResultAnalysisEntryDefaults,
  index = 0,
): InspectorChainSummary {
  const preprocessingSteps = [...(defaults?.preprocessingSteps ?? [])];

  return {
    chain_id: normalizeRequiredText(summary.chain_id, `${source.id}-chain-${index + 1}`),
    run_id: normalizeRequiredText(summary.run_id ?? defaults?.runId, source.id),
    pipeline_id: normalizeRequiredText(summary.pipeline_id ?? defaults?.pipelineId, "external-pipeline"),
    pipeline_name: normalizeText(defaults?.pipelineName),
    model_class: normalizeRequiredText(summary.model_class ?? defaults?.modelClass, "UnknownModel"),
    model_name: normalizeText(summary.model_name ?? defaults?.modelName),
    preprocessings: normalizeText(summary.preprocessings ?? defaults?.preprocessings),
    preprocessing_steps: preprocessingSteps,
    branch_path: summary.branch_path ?? [],
    source_index: summary.source_index ?? null,
    metric: normalizeText(summary.metric ?? defaults?.metric),
    task_type: normalizeText(summary.task_type ?? defaults?.taskType),
    dataset_name: normalizeText(summary.dataset_name ?? defaults?.datasetName),
    best_params: normalizeRecord(summary.best_params),
    variant_params: buildChainSummaryVariantParams(summary),
    cv_val_score: normalizeFiniteScore(summary.cv_val_score),
    cv_test_score: normalizeFiniteScore(summary.cv_test_score),
    cv_train_score: normalizeFiniteScore(summary.cv_train_score),
    cv_fold_count: normalizeFoldCount(summary.cv_fold_count ?? defaults?.cvFoldCount),
    final_test_score: normalizeFiniteScore(summary.final_test_score ?? summary.final_agg_test_score),
    final_train_score: normalizeFiniteScore(summary.final_train_score ?? summary.final_agg_train_score),
    pipeline_status: normalizeText(summary.pipeline_status ?? defaults?.pipelineStatus),
  };
}

function buildShapAvailableChainVariantParams(
  dataset: DatasetChains,
  chain: AvailableChain,
): Record<string, unknown> {
  return {
    shap_metadata: {
      source: "shap_available_models",
      dataset_name: dataset.dataset_name,
      dataset_metric: dataset.metric,
      dataset_task_type: dataset.task_type,
      has_refit: chain.has_refit,
    },
  };
}

function toResultAnalysisEntryFromShapAvailableChain(
  dataset: DatasetChains,
  chain: AvailableChain,
): ResultAnalysisChainEntry {
  return {
    chainId: chain.chain_id,
    runId: chain.run_id,
    modelClass: chain.model_class,
    modelName: chain.model_name,
    preprocessings: chain.preprocessings,
    metric: chain.metric || dataset.metric,
    taskType: dataset.task_type,
    datasetName: chain.dataset_name || dataset.dataset_name,
    variantParams: buildShapAvailableChainVariantParams(dataset, chain),
    scores: {
      cv_val_score: chain.cv_val_score,
      final_test_score: chain.final_test_score,
    },
    cvFoldCount: chain.cv_fold_count,
  };
}

export function isResultAnalysisClassificationTask(taskType: string | null | undefined): boolean {
  return (
    taskType === "classification" ||
    taskType === "binary_classification" ||
    taskType === "multiclass_classification"
  );
}

export function isResultAnalysisRegressionTask(taskType: string | null | undefined): boolean {
  return taskType == null || taskType === "regression" || taskType === "continuous";
}

export function buildResultAnalysisScopeSummary(chains: readonly InspectorChainSummary[]): ResultAnalysisScopeSummary {
  const metrics = sortedValues(chains.map(chain => chain.metric));
  const taskTypes = sortedValues(chains.map(chain => chain.task_type));

  return {
    totalChains: chains.length,
    metrics,
    taskTypes,
    datasetNames: sortedValues(chains.map(chain => chain.dataset_name)),
    runIds: sortedValues(chains.map(chain => chain.run_id)),
    modelClasses: sortedValues(chains.map(chain => chain.model_class)),
    pipelineIds: sortedValues(chains.map(chain => chain.pipeline_id)),
    hasMixedMetrics: metrics.length > 1,
    hasMixedTaskTypes: taskTypes.length > 1,
    hasRegression: chains.some(chain => isResultAnalysisRegressionTask(chain.task_type)),
    hasClassification: chains.some(chain => isResultAnalysisClassificationTask(chain.task_type)),
  };
}

export function buildResultAnalysisStore({
  chains,
  source,
}: BuildResultAnalysisStoreInput): ResultAnalysisStore {
  const normalizedChains = chains.map(mergeInspectorChainPredictionMetadata);
  const chainById = new Map(normalizedChains.map(chain => [chain.chain_id, chain]));
  const metricObservations = projectInspectorChainsMetricObservations(normalizedChains);
  const metricObservationById = new Map(metricObservations.map(observation => [observation.id, observation]));

  return {
    source: {
      id: source?.id ?? "current-inspector-scope",
      kind: source?.kind ?? "inspector_chain_summaries",
      label: source?.label,
    },
    chains: normalizedChains,
    chainIds: normalizedChains.map(chain => chain.chain_id),
    chainById,
    metricObservations,
    metricObservationById,
    scope: buildResultAnalysisScopeSummary(normalizedChains),
  };
}

export function toResultAnalysisChainSummary(
  entry: ResultAnalysisChainEntry,
  source: ResultAnalysisStoreSource,
  defaults?: ResultAnalysisEntryDefaults,
  index = 0,
): InspectorChainSummary {
  const preprocessingSteps = [...(entry.preprocessingSteps ?? defaults?.preprocessingSteps ?? [])];
  const scores = entry.scores ?? {};

  return {
    chain_id: normalizeRequiredText(entry.chainId, `${source.id}-chain-${index + 1}`),
    run_id: normalizeRequiredText(entry.runId ?? defaults?.runId, source.id),
    pipeline_id: normalizeRequiredText(entry.pipelineId ?? defaults?.pipelineId, "external-pipeline"),
    pipeline_name: normalizeText(entry.pipelineName ?? defaults?.pipelineName),
    model_class: normalizeRequiredText(entry.modelClass ?? defaults?.modelClass, "UnknownModel"),
    model_name: normalizeText(entry.modelName ?? defaults?.modelName),
    preprocessings: resolvePreprocessingLabel(entry, defaults, preprocessingSteps),
    preprocessing_steps: preprocessingSteps,
    branch_path: entry.branchPath ?? [],
    source_index: entry.sourceIndex ?? null,
    metric: normalizeText(entry.metric ?? defaults?.metric),
    task_type: normalizeText(entry.taskType ?? defaults?.taskType),
    dataset_name: normalizeText(entry.datasetName ?? defaults?.datasetName),
    best_params: entry.bestParams ?? null,
    variant_params: entry.variantParams ?? null,
    cv_val_score: normalizeFiniteScore(scores.cv_val_score),
    cv_test_score: normalizeFiniteScore(scores.cv_test_score),
    cv_train_score: normalizeFiniteScore(scores.cv_train_score),
    cv_fold_count: normalizeFoldCount(entry.cvFoldCount ?? defaults?.cvFoldCount),
    final_test_score: normalizeFiniteScore(scores.final_test_score),
    final_train_score: normalizeFiniteScore(scores.final_train_score),
    pipeline_status: normalizeText(entry.pipelineStatus ?? defaults?.pipelineStatus),
  };
}

export function buildResultAnalysisStoreFromEntries({
  entries,
  source,
  defaults,
}: BuildResultAnalysisStoreFromEntriesInput): ResultAnalysisStore {
  return buildResultAnalysisStore({
    chains: entries.map((entry, index) => toResultAnalysisChainSummary(entry, source, defaults, index)),
    source,
  });
}

export function buildResultAnalysisStoreFromMetricRecords({
  records,
  source,
  defaults,
}: BuildResultAnalysisStoreFromMetricRecordsInput): ResultAnalysisStore {
  return buildResultAnalysisStoreFromEntries({
    entries: buildResultAnalysisEntriesFromMetricRecords(records, defaults),
    source,
    defaults,
  });
}

export function buildResultAnalysisStoreFromResults({
  results,
  source,
  defaults,
}: BuildResultAnalysisStoreFromResultsInput): ResultAnalysisStore {
  const resolvedSource = buildRepositoryResultSource(source, "result-repository");

  return buildResultAnalysisStoreFromEntries({
    entries: results.map(toResultAnalysisEntryFromResult),
    source: resolvedSource,
    defaults,
  });
}

export function buildResultAnalysisStoreFromResultListResponse({
  response,
  source,
  defaults,
}: BuildResultAnalysisStoreFromResultListResponseInput): ResultAnalysisStore {
  const resolvedSource = buildRepositoryResultSource(source, `workspace-${response.workspace_id}-results`);

  return buildResultAnalysisStoreFromResults({
    results: response.results,
    source: resolvedSource,
    defaults,
  });
}

export function buildResultAnalysisStoreFromChainSummaries({
  summaries,
  source,
  defaults,
}: BuildResultAnalysisStoreFromChainSummariesInput): ResultAnalysisStore {
  const resolvedSource = buildRepositoryResultSource(source, "aggregated-predictions");

  return buildResultAnalysisStore({
    chains: summaries.map((summary, index) =>
      toResultAnalysisChainSummaryFromChainSummary(summary, resolvedSource, defaults, index)
    ),
    source: resolvedSource,
  });
}

export function buildResultAnalysisStoreFromAggregatedPredictionsResponse({
  response,
  source,
  defaults,
}: BuildResultAnalysisStoreFromAggregatedPredictionsResponseInput): ResultAnalysisStore {
  return buildResultAnalysisStoreFromChainSummaries({
    summaries: response.predictions,
    source,
    defaults,
  });
}

export function buildResultAnalysisStoreFromShapAvailableModels({
  response,
  source,
  defaults,
}: BuildResultAnalysisStoreFromShapAvailableModelsInput): ResultAnalysisStore {
  const resolvedSource = buildRepositoryResultSource(source, "shap-available-models");

  return buildResultAnalysisStoreFromEntries({
    entries: response.datasets.flatMap(dataset => (
      dataset.chains.map(chain => toResultAnalysisEntryFromShapAvailableChain(dataset, chain))
    )),
    source: resolvedSource,
    defaults,
  });
}

export function getResultAnalysisChains(store: Pick<ResultAnalysisStore, "chains">): readonly InspectorChainSummary[] {
  return store.chains;
}

export function getResultAnalysisScope(store: Pick<ResultAnalysisStore, "scope">): ResultAnalysisScopeSummary {
  return store.scope;
}

export function getResultAnalysisMetricObservations(
  store: Pick<ResultAnalysisStore, "metricObservations">,
): readonly MetricObservation[] {
  return store.metricObservations;
}

export function getResultAnalysisMetricObservationById(
  store: Pick<ResultAnalysisStore, "metricObservationById">,
  id: string,
): MetricObservation | undefined {
  return store.metricObservationById.get(id);
}

export function getResultAnalysisBestScoreEntry(
  store: Pick<ResultAnalysisStore, "chains">,
  scoreColumn: ScoreColumn,
): ResultAnalysisBestScoreEntry | null {
  const scoredChains = store.chains.filter(chain => getInspectorFiniteScore(chain, scoreColumn) != null);
  if (scoredChains.length === 0) return null;

  const chain = sortInspectorChainsByScore(scoredChains, scoreColumn)[0];
  const score = getInspectorFiniteScore(chain, scoreColumn);
  if (score == null) return null;

  return { chain, score };
}

/**
 * Adapter functions that map existing API types to the unified ScoreCardRow.
 *
 * Each function maps a specific API response type into one or more ScoreCardRow
 * instances for uniform rendering across History, Results, and Predictions pages.
 */

import type { ScoreCardRow } from "@/types/score-cards";
import type { TopChainResult } from "@/types/enriched-runs";
import type { ChainSummary, PartitionPrediction } from "@/types/aggregated-predictions";
import type { PredictionRecord } from "@/types/linked-workspaces";
import {
  ALL_CLASSIFICATION_METRICS,
  ALL_REGRESSION_METRICS,
  extractScoreValue,
  isLowerBetter,
} from "@/lib/scores";
import { foldIdBase, safeNumber } from "@/lib/fold-utils";

// ============================================================================
// Helpers
// ============================================================================

type FoldVariant = "raw" | "aggregated";

const KNOWN_SCORE_METRIC_KEYS = [
  ...new Set([
    ...ALL_REGRESSION_METRICS.map(metric => metric.key),
    ...ALL_CLASSIFICATION_METRICS.map(metric => metric.key),
  ]),
];

/** Extract multi-metric scores from a {partition: {metric: value}} structure. */
function extractNestedScores(
  scores: Record<string, Record<string, number>> | null | undefined,
  partition: string,
): Record<string, number | null> {
  if (!scores) return {};
  const inner = scores[partition];
  if (!inner || typeof inner !== "object") return {};
  const result: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(inner)) {
    result[k] = safeNumber(v);
  }
  return result;
}

function parsePredictionJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value as Record<string, unknown> : null;
}

export function predictionRecordBestParams(pred: Pick<PredictionRecord, "best_params">): Record<string, unknown> | null {
  const parsed = parsePredictionJsonObject(pred.best_params);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

function predictionRecordScores(pred: Pick<PredictionRecord, "scores">): Record<string, unknown> | null {
  return parsePredictionJsonObject(pred.scores);
}

export function formatBestParams(params: Record<string, unknown> | null | undefined): string | null {
  if (!params || Object.keys(params).length === 0) return null;
  return Object.entries(params)
    .map(([k, v]) => `${k}=${typeof v === "number" ? (Number.isInteger(v) ? v : (v as number).toPrecision(4)) : String(v)}`)
    .join(", ");
}

function hasKeys(obj: Record<string, unknown> | null | undefined): boolean {
  return !!obj && Object.keys(obj).length > 0;
}

function hasMeaningfulBestParams(params: Record<string, unknown> | null | undefined): boolean {
  return !!params && Object.keys(params).length > 0;
}

function displayParams(chain: TopChainResult | null | undefined): Record<string, unknown> | null {
  if (!chain) return null;
  return (chain.variant_params ?? chain.best_params ?? null) as Record<string, unknown> | null;
}

function hasCvData(chain: TopChainResult): boolean {
  return (
    safeNumber(chain.avg_val_score) != null
    || safeNumber(chain.avg_test_score) != null
    || safeNumber(chain.avg_train_score) != null
    || chain.fold_count > 0
    || hasKeys(chain.scores?.val)
    || hasKeys(chain.scores?.test)
  );
}

function hasFinalData(chain: TopChainResult): boolean {
  return (
    safeNumber(chain.final_test_score) != null
    || safeNumber(chain.final_train_score) != null
    || hasKeys(chain.final_scores)
  );
}

function hasAggregatedRefitData(chain: TopChainResult): boolean {
  return (
    safeNumber(chain.final_agg_test_score) != null
    || safeNumber(chain.final_agg_train_score) != null
    || hasKeys(chain.final_agg_scores as Record<string, unknown> | null | undefined)
  );
}

function isStandaloneRefitChain(chain: Pick<TopChainResult, "is_refit_only"> | null | undefined): boolean {
  return chain?.is_refit_only === true;
}

function cvSourceChainId(chain: Pick<TopChainResult, "chain_id" | "cv_source_chain_id">): string {
  return chain.cv_source_chain_id ?? chain.chain_id;
}

function foldVariantSuffix(variant: FoldVariant): string {
  return variant === "aggregated" ? "_agg" : "";
}

function foldVariantId(baseFoldId: string, variant: FoldVariant): string {
  return `${baseFoldId}${foldVariantSuffix(variant)}`;
}

function predictionMatchesVariant(prediction: Pick<PartitionPrediction, "fold_id">, variant: FoldVariant): boolean {
  const isAgg = prediction.fold_id.endsWith("_agg");
  return variant === "aggregated" ? isAgg : !isAgg;
}

function compareNullableScores(
  a: number | null | undefined,
  b: number | null | undefined,
  lowerBetter: boolean,
): number {
  const aScore = safeNumber(a);
  const bScore = safeNumber(b);
  if (aScore == null && bScore == null) return 0;
  if (aScore == null) return 1;
  if (bScore == null) return -1;
  if (aScore === bScore) return 0;
  return lowerBetter ? aScore - bScore : bScore - aScore;
}

function compareRefitChains(a: TopChainResult, b: TopChainResult, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byFinal = compareNullableScores(a.final_test_score, b.final_test_score, lowerBetter);
  if (byFinal !== 0) return byFinal;
  const byCv = compareNullableScores(a.avg_val_score, b.avg_val_score, lowerBetter);
  if (byCv !== 0) return byCv;
  return a.chain_id.localeCompare(b.chain_id);
}

function compareCvChains(a: TopChainResult, b: TopChainResult, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byVal = compareNullableScores(a.avg_val_score, b.avg_val_score, lowerBetter);
  if (byVal !== 0) return byVal;
  const byTest = compareNullableScores(a.avg_test_score, b.avg_test_score, lowerBetter);
  if (byTest !== 0) return byTest;
  return a.chain_id.localeCompare(b.chain_id);
}

function compareRefitRows(a: ScoreCardRow, b: ScoreCardRow, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byTest = compareNullableScores(a.primaryTestScore, b.primaryTestScore, lowerBetter);
  if (byTest !== 0) return byTest;
  const byTrain = compareNullableScores(a.primaryTrainScore, b.primaryTrainScore, lowerBetter);
  if (byTrain !== 0) return byTrain;
  const byModel = a.modelName.localeCompare(b.modelName);
  if (byModel !== 0) return byModel;
  const byChain = a.chainId.localeCompare(b.chainId);
  if (byChain !== 0) return byChain;
  return (a.foldId ?? "").localeCompare(b.foldId ?? "");
}

function stableSerialize(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${stableSerialize(v)}`)
      .join(",")}}`;
  }
  return String(value);
}

function normalizeToken(value: string | null | undefined): string {
  return (value || "").trim().toLowerCase();
}

function normalizePreprocessings(value: string | null | undefined): string {
  return normalizeToken(value).replace(/\s+/g, "");
}

function signatureParts(chain: TopChainResult) {
  const params = displayParams(chain);
  return {
    modelClass: normalizeToken(chain.model_class),
    modelName: normalizeToken(chain.model_name),
    preprocessings: normalizePreprocessings(chain.preprocessings),
    bestParams: stableSerialize(params),
  };
}

function signaturePartsExactlyMatch(a: TopChainResult, b: TopChainResult): boolean {
  const aSig = signatureParts(a);
  const bSig = signatureParts(b);
  return (
    aSig.modelClass === bSig.modelClass
    && aSig.modelName === bSig.modelName
    && aSig.preprocessings === bSig.preprocessings
    && aSig.bestParams === bSig.bestParams
  );
}

function variantKey(chain: TopChainResult): string {
  const params = displayParams(chain);
  return [
    normalizeToken(chain.model_name),
    normalizeToken(chain.model_class),
    normalizePreprocessings(chain.preprocessings),
    stableSerialize(params),
  ].join("::");
}

function displayVariantKey(chain: TopChainResult): string {
  return [
    normalizeToken(chain.model_name),
    normalizeToken(chain.model_class),
    normalizePreprocessings(chain.preprocessings),
  ].join("::");
}

function dedupeChainsByVariant(
  chains: TopChainResult[],
  compare: (a: TopChainResult, b: TopChainResult) => number,
): TopChainResult[] {
  const bestByVariant = new Map<string, TopChainResult>();

  for (const chain of chains) {
    const key = variantKey(chain);
    const current = bestByVariant.get(key);
    if (!current || compare(chain, current) < 0) {
      bestByVariant.set(key, chain);
    }
  }

  return [...bestByVariant.values()].sort(compare);
}

function findMatchingCvSource(
  refitChain: TopChainResult,
  cvChains: TopChainResult[],
  usedChainIds: Set<string>,
  metric: string | null,
): TopChainResult | null {
  const refitSig = signatureParts(refitChain);
  const available = cvChains.filter(chain => !usedChainIds.has(chain.chain_id));
  const matchers = [
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return (
        sig.modelClass === refitSig.modelClass
        && sig.modelName === refitSig.modelName
        && sig.preprocessings === refitSig.preprocessings
        && sig.bestParams === refitSig.bestParams
      );
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return (
        sig.modelClass === refitSig.modelClass
        && sig.modelName === refitSig.modelName
        && sig.preprocessings === refitSig.preprocessings
      );
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return sig.modelClass === refitSig.modelClass && sig.modelName === refitSig.modelName;
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return sig.modelClass === refitSig.modelClass;
    },
  ];

  for (const matches of matchers) {
    const candidates = available.filter(matches).sort((a, b) => compareCvChains(a, b, metric));
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      const [bestCandidate] = candidates;
      if (bestCandidate && signatureParts(bestCandidate).preprocessings === refitSig.preprocessings) {
        return bestCandidate;
      }
    }
  }

  return null;
}

function findMatchingCvSourceExact(
  refitChain: TopChainResult,
  cvChains: TopChainResult[],
  usedChainIds: Set<string>,
  metric: string | null,
): TopChainResult | null {
  const candidates = cvChains
    .filter(chain => !usedChainIds.has(chain.chain_id))
    .filter(chain => signaturePartsExactlyMatch(refitChain, chain))
    .sort((a, b) => compareCvChains(a, b, metric));
  return candidates[0] ?? null;
}

function summarySignature(summary: Pick<ChainSummary, "model_class" | "model_name" | "preprocessings" | "best_params">): string {
  return [
    normalizeToken(summary.model_name),
    normalizeToken(summary.model_class),
    normalizePreprocessings(summary.preprocessings),
    stableSerialize(summary.best_params),
  ].join("::");
}

export function collapseStandaloneRefitSummaries(summaries: ChainSummary[]): ChainSummary[] {
  const standaloneSignatures = new Set(
    summaries
      .filter(summary => summary.is_refit_only && summary.final_test_score != null)
      .map(summary => summarySignature(summary)),
  );

  return summaries.flatMap((summary) => {
    const signature = summarySignature(summary);
    if (summary.final_test_score == null && standaloneSignatures.has(signature)) {
      return [];
    }
    if (!summary.is_refit_only) {
      return [summary];
    }
    return [{
      ...summary,
      cv_val_score: null,
      cv_test_score: null,
      cv_train_score: null,
      cv_fold_count: 0,
      cv_scores: null,
    }];
  });
}

function appendMetricKeys(
  keys: Set<string>,
  map: Record<string, unknown> | null | undefined,
): void {
  if (!map) return;

  for (const [key, value] of Object.entries(map)) {
    if (
      (key === "test" || key === "val" || key === "train")
      && value
      && typeof value === "object"
      && !Array.isArray(value)
    ) {
      for (const nestedKey of Object.keys(value as Record<string, unknown>)) {
        keys.add(nestedKey);
      }
      continue;
    }

    keys.add(key);
  }
}

function collectKnownMetricKeys(
  ...maps: Array<Record<string, unknown> | null | undefined>
): string[] {
  const keys = new Set(KNOWN_SCORE_METRIC_KEYS);
  for (const map of maps) {
    appendMetricKeys(keys, map);
  }
  return [...keys];
}

function buildCrossvalRow(
  chain: TopChainResult,
  metric: string | null,
  taskType: string | null,
  variant: FoldVariant = "raw",
): ScoreCardRow {
  const hasSummaryScores = variant === "raw";
  const cvValScores = hasSummaryScores && chain.scores?.val
    ? Object.fromEntries(Object.entries(chain.scores.val).map(([k, v]) => [k, safeNumber(v)]))
    : {};
  const cvTestScores = hasSummaryScores && chain.scores?.test
    ? Object.fromEntries(Object.entries(chain.scores.test).map(([k, v]) => [k, safeNumber(v)]))
    : {};

  return {
    id: `cv-${cvSourceChainId(chain)}${foldVariantSuffix(variant)}`,
    chainId: cvSourceChainId(chain),
    runId: chain.run_id,
    pipelineId: chain.pipeline_id,
    modelName: chain.model_name,
    modelClass: chain.model_class,
    preprocessings: chain.preprocessings || null,
    bestParams: displayParams(chain),
    cardType: "crossval",
    foldId: foldVariantId("avg", variant),
    foldCount: chain.fold_count,
    metric,
    taskType,
    testScores: cvTestScores,
    valScores: cvValScores,
    trainScores: {},
    avgValScores: cvValScores,
    avgTestScores: cvTestScores,
    primaryTestScore: hasSummaryScores ? safeNumber(chain.avg_test_score) : null,
    primaryValScore: hasSummaryScores ? safeNumber(chain.avg_val_score) : null,
    primaryTrainScore: hasSummaryScores ? safeNumber(chain.avg_train_score) : null,
    hasRefitArtifact: false,
  };
}

function buildRefitRow(
  chain: TopChainResult,
  metric: string | null,
  taskType: string | null,
  cvSource: TopChainResult | null = null,
): ScoreCardRow {
  const effectiveCvSource = isStandaloneRefitChain(chain)
    ? null
    : (cvSource ?? (hasCvData(chain) ? chain : null));
  const chainParams = displayParams(chain);
  const cvParams = displayParams(effectiveCvSource);
  const bestParams = hasMeaningfulBestParams(chainParams)
    ? chainParams
    : (hasMeaningfulBestParams(cvParams) ? cvParams : null);
  const cvValScores = effectiveCvSource?.scores?.val
    ? Object.fromEntries(Object.entries(effectiveCvSource.scores.val).map(([k, v]) => [k, safeNumber(v)]))
    : {};
  const cvTestScores = effectiveCvSource?.scores?.test
    ? Object.fromEntries(Object.entries(effectiveCvSource.scores.test).map(([k, v]) => [k, safeNumber(v)]))
    : {};
  const finalMetricKeys = collectKnownMetricKeys(
    cvValScores,
    cvTestScores,
    chain.final_scores as Record<string, unknown> | null | undefined,
  );
  const finalTestScores: Record<string, number | null> = {};
  const finalTrainScores: Record<string, number | null> = {};

  if (chain.final_scores) {
    for (const key of finalMetricKeys) {
      finalTestScores[key] = extractScoreValue(chain.final_scores, key, "test");
      finalTrainScores[key] = extractScoreValue(chain.final_scores, key, "train");
    }
  }

  return {
    id: `refit-${chain.chain_id}`,
    chainId: chain.chain_id,
    runId: chain.run_id,
    pipelineId: chain.pipeline_id,
    modelName: chain.model_name,
    modelClass: chain.model_class,
    preprocessings: chain.preprocessings || null,
    bestParams: bestParams ?? null,
    cardType: "refit",
    foldId: "final",
    foldCount: effectiveCvSource?.fold_count ?? chain.fold_count,
    metric,
    taskType,
    testScores: finalTestScores,
    valScores: {},
    trainScores: finalTrainScores,
    avgValScores: cvValScores,
    avgTestScores: cvTestScores,
    primaryTestScore: safeNumber(chain.final_test_score),
    primaryValScore: safeNumber(effectiveCvSource?.avg_val_score ?? chain.avg_val_score),
    primaryTrainScore: safeNumber(chain.final_train_score),
    hasRefitArtifact: !chain.synthetic_refit,
    children: effectiveCvSource ? [buildCrossvalRow(effectiveCvSource, metric, taskType, "raw")] : [],
  };
}

function buildAggregatedRefitRow(
  chain: TopChainResult,
  metric: string | null,
  taskType: string | null,
  cvSource: TopChainResult | null = null,
): ScoreCardRow {
  const effectiveCvSource = isStandaloneRefitChain(chain)
    ? null
    : (cvSource ?? (hasCvData(chain) ? chain : null));
  const chainParams = displayParams(chain);
  const cvParams = displayParams(effectiveCvSource);
  const bestParams = hasMeaningfulBestParams(chainParams)
    ? chainParams
    : (hasMeaningfulBestParams(cvParams) ? cvParams : null);
  const aggSource = chain.final_agg_scores as Record<string, unknown> | null | undefined;
  const finalMetricKeys = collectKnownMetricKeys(
    effectiveCvSource?.scores?.val as Record<string, number | null> | undefined,
    effectiveCvSource?.scores?.test as Record<string, number | null> | undefined,
    aggSource,
  );
  const finalTestScores: Record<string, number | null> = {};
  const finalTrainScores: Record<string, number | null> = {};

  if (aggSource) {
    for (const key of finalMetricKeys) {
      finalTestScores[key] = extractScoreValue(aggSource, key, "test");
      finalTrainScores[key] = extractScoreValue(aggSource, key, "train");
    }
  }

  return {
    id: `refit-${chain.chain_id}_agg`,
    chainId: chain.chain_id,
    runId: chain.run_id,
    pipelineId: chain.pipeline_id,
    modelName: chain.model_name,
    modelClass: chain.model_class,
    preprocessings: chain.preprocessings || null,
    bestParams: bestParams ?? null,
    cardType: "refit",
    foldId: "final_agg",
    foldCount: effectiveCvSource?.fold_count ?? chain.fold_count,
    metric,
    taskType,
    testScores: finalTestScores,
    valScores: {},
    trainScores: finalTrainScores,
    primaryTestScore: safeNumber(chain.final_agg_test_score),
    primaryValScore: null,
    primaryTrainScore: safeNumber(chain.final_agg_train_score),
    hasRefitArtifact: false,
    children: effectiveCvSource ? [buildCrossvalRow(effectiveCvSource, metric, taskType, "aggregated")] : [],
  };
}

// ============================================================================
// partitionPredToTrainCard — single fold prediction → TRAIN leaf card
// ============================================================================

/**
 * Maps a single PartitionPrediction (fold-level) to a TRAIN_CARD.
 * This is always a leaf node — never expandable.
 * fold_id "final", "avg", "w_avg" still become train cards; their fold badge
 * distinguishes them visually.
 */
export function partitionPredToTrainCard(pred: PartitionPrediction): ScoreCardRow {
  // scores format from backend: {"val": {"rmse": 0.1, "r2": 0.95}, "test": {"rmse": ...}}
  // Always nested by partition.
  const scoresObj = pred.scores as Record<string, unknown> | null;

  const testScores: Record<string, number | null> = {};
  const valScores: Record<string, number | null> = {};
  const trainScores: Record<string, number | null> = {};

  if (scoresObj && typeof scoresObj === "object") {
    // Extract from nested partition keys
    const testInner = scoresObj.test as Record<string, unknown> | undefined;
    const valInner = scoresObj.val as Record<string, unknown> | undefined;
    const trainInner = scoresObj.train as Record<string, unknown> | undefined;

    if (testInner && typeof testInner === "object") {
      for (const [k, v] of Object.entries(testInner)) testScores[k] = safeNumber(v);
    }
    if (valInner && typeof valInner === "object") {
      for (const [k, v] of Object.entries(valInner)) valScores[k] = safeNumber(v);
    }
    if (trainInner && typeof trainInner === "object") {
      for (const [k, v] of Object.entries(trainInner)) trainScores[k] = safeNumber(v);
    }

    // Fallback: if no partition keys found, try flat format {rmse: 0.3, r2: 0.95}
    if (!testInner && !valInner && !trainInner) {
      const flatScores: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(scoresObj)) {
        const n = safeNumber(v);
        if (n != null) flatScores[k] = n;
      }
      if (Object.keys(flatScores).length > 0) {
        // Assign to the prediction's partition
        if (pred.partition === "test") Object.assign(testScores, flatScores);
        else if (pred.partition === "val") Object.assign(valScores, flatScores);
        else if (pred.partition === "train") Object.assign(trainScores, flatScores);
      }
    }
  }

  return {
    id: pred.prediction_id,
    chainId: pred.chain_id || "",
    pipelineId: pred.pipeline_id,
    datasetName: pred.dataset_name,
    modelName: pred.model_name,
    modelClass: pred.model_class,
    preprocessings: pred.preprocessings || null,
    bestParams: pred.best_params ?? null,
    cardType: "train",
    foldId: pred.fold_id,
    partition: pred.partition,
    nSamplesEval: pred.n_samples,
    metric: pred.metric,
    taskType: pred.task_type,
    testScores,
    valScores,
    trainScores,
    primaryTestScore: safeNumber(pred.test_score),
    primaryValScore: safeNumber(pred.val_score),
    primaryTrainScore: safeNumber(pred.train_score),
    hasRefitArtifact: false,
  };
}

// ============================================================================
// buildFoldChildren — partition predictions → TRAIN_CARD children
// ============================================================================

/**
 * Takes flat PartitionPrediction[] from a chain detail response and builds:
 * - Only numbered folds (0, 1, 2, ...) as TRAIN_CARD leaf nodes.
 * - Skips "final", "avg", "w_avg" (those are represented at higher levels).
 * - Deduplicates by fold_id: merges test/val/train partitions into ONE row per fold.
 */
export function buildFoldTrainCards(
  predictions: PartitionPrediction[],
  parentRow?: Pick<
    ScoreCardRow,
    "runId" | "pipelineId" | "datasetName" | "modelName" | "modelClass" | "preprocessings" | "bestParams" | "metric" | "taskType"
  >,
  variant: FoldVariant = "raw",
): ScoreCardRow[] {
  // Group by fold_id, merge partitions
  const foldMap = new Map<string, PartitionPrediction[]>();
  for (const p of predictions) {
    const baseFoldId = foldIdBase(p.fold_id);
    if (baseFoldId === "final" || baseFoldId === "avg" || baseFoldId === "w_avg") continue;
    if (!predictionMatchesVariant(p, variant)) continue;
    const group = foldMap.get(p.fold_id) || [];
    group.push(p);
    foldMap.set(p.fold_id, group);
  }

  // Sort fold IDs numerically
  const sortedFoldIds = [...foldMap.keys()].sort((a, b) => {
    const aNum = parseInt(foldIdBase(a), 10);
    const bNum = parseInt(foldIdBase(b), 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    return a.localeCompare(b);
  });

  return sortedFoldIds.map(foldId => {
    const preds = foldMap.get(foldId)!;
    // Pick the test partition as primary, fallback to val, then any
    const testPred = preds.find(p => p.partition === "test");
    const valPred = preds.find(p => p.partition === "val");
    const trainPred = preds.find(p => p.partition === "train");
    const primary = testPred || valPred || preds[0];

    // Merge scores from all partitions into one card
    const row = partitionPredToTrainCard(primary);

    // Overlay scores from other partitions using their partitionPredToTrainCard results
    if (valPred && valPred !== primary) {
      const valRow = partitionPredToTrainCard(valPred);
      Object.assign(row.valScores, valRow.valScores);
      if (valRow.primaryValScore != null) row.primaryValScore = valRow.primaryValScore;
    }
    if (trainPred && trainPred !== primary) {
      const trainRow = partitionPredToTrainCard(trainPred);
      Object.assign(row.trainScores, trainRow.trainScores);
      if (trainRow.primaryTrainScore != null) row.primaryTrainScore = trainRow.primaryTrainScore;
    }
    if (testPred && testPred !== primary) {
      const testRow = partitionPredToTrainCard(testPred);
      Object.assign(row.testScores, testRow.testScores);
      if (testRow.primaryTestScore != null) row.primaryTestScore = testRow.primaryTestScore;
    }

    // Show n_samples from test partition
    row.nSamplesEval = testPred?.n_samples ?? valPred?.n_samples ?? primary.n_samples;
    row.partition = undefined; // Don't show partition — it's a merged fold row

    return {
      ...row,
      runId: row.runId ?? parentRow?.runId,
      pipelineId: row.pipelineId ?? parentRow?.pipelineId,
      datasetName: row.datasetName ?? parentRow?.datasetName,
      modelName: row.modelName || parentRow?.modelName || "",
      modelClass: row.modelClass || parentRow?.modelClass || "",
      preprocessings: row.preprocessings ?? parentRow?.preprocessings ?? null,
      bestParams: hasMeaningfulBestParams(row.bestParams)
        ? row.bestParams
        : (parentRow?.bestParams ?? null),
      metric: row.metric ?? parentRow?.metric ?? null,
      taskType: row.taskType ?? parentRow?.taskType ?? null,
    };
  });
}

function extractPredictionScoreMap(pred: PartitionPrediction): Record<string, number | null> {
  const scoresObj = pred.scores as Record<string, unknown> | null | undefined;
  const result: Record<string, number | null> = {};

  if (scoresObj && typeof scoresObj === "object") {
    const nested = scoresObj[pred.partition];
    if (nested && typeof nested === "object") {
      for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
        const num = safeNumber(value);
        if (num != null) result[key] = num;
      }
    } else {
      for (const [key, value] of Object.entries(scoresObj)) {
        if (value && typeof value === "object") continue;
        const num = safeNumber(value);
        if (num != null) result[key] = num;
      }
    }
  }

  const primaryScore = pred.partition === "test"
    ? safeNumber(pred.test_score)
    : pred.partition === "val"
      ? safeNumber(pred.val_score)
      : safeNumber(pred.train_score);
  const metricKey = (pred.metric || "").trim().toLowerCase() || "score";
  if (primaryScore != null && result[metricKey] == null) {
    result[metricKey] = primaryScore;
  }

  return result;
}

function averagePredictionScoreMaps(predictions: PartitionPrediction[]): Record<string, number | null> {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const pred of predictions) {
    for (const [key, value] of Object.entries(extractPredictionScoreMap(pred))) {
      const num = safeNumber(value);
      if (num == null) continue;
      const current = totals.get(key) ?? { sum: 0, count: 0 };
      current.sum += num;
      current.count += 1;
      totals.set(key, current);
    }
  }

  return Object.fromEntries(
    [...totals.entries()].map(([key, value]) => [key, value.count > 0 ? value.sum / value.count : null]),
  );
}

function extremePredictionScoreMaps(
  predictions: PartitionPrediction[],
  mode: "min" | "max",
): Record<string, number | null> {
  const extrema = new Map<string, number>();

  for (const pred of predictions) {
    for (const [key, value] of Object.entries(extractPredictionScoreMap(pred))) {
      const num = safeNumber(value);
      if (num == null) continue;
      const current = extrema.get(key);
      if (current == null) {
        extrema.set(key, num);
        continue;
      }
      extrema.set(key, mode === "min" ? Math.min(current, num) : Math.max(current, num));
    }
  }

  return Object.fromEntries([...extrema.entries()]);
}

function findFoldPrediction(
  predictions: PartitionPrediction[],
  foldId: string,
  partition: string,
): PartitionPrediction | undefined {
  return predictions.find(pred => pred.fold_id === foldId && pred.partition === partition);
}

function isNumberedFoldId(foldId: string): boolean {
  const baseFoldId = foldIdBase(foldId);
  if (baseFoldId === "avg" || baseFoldId === "w_avg" || baseFoldId === "final") return false;
  if (foldId !== baseFoldId) return false;
  return true;
}

export function enrichCrossvalRow(
  row: ScoreCardRow,
  predictions: PartitionPrediction[],
): ScoreCardRow {
  const variant: FoldVariant = row.foldId?.endsWith("_agg") ? "aggregated" : "raw";
  const avgValPred = findFoldPrediction(predictions, foldVariantId("avg", variant), "val");
  const avgTestPred = findFoldPrediction(predictions, foldVariantId("avg", variant), "test");
  const avgTrainPred = findFoldPrediction(predictions, foldVariantId("avg", variant), "train");
  const wAvgTestPred = findFoldPrediction(predictions, foldVariantId("w_avg", variant), "test");
  const foldValPredictions = predictions.filter(pred => pred.partition === "val" && isNumberedFoldId(pred.fold_id) && predictionMatchesVariant(pred, variant));
  const foldTestPredictions = predictions.filter(pred => pred.partition === "test" && isNumberedFoldId(pred.fold_id) && predictionMatchesVariant(pred, variant));
  const foldIds = new Set(
    predictions
      .filter(pred => isNumberedFoldId(pred.fold_id) && predictionMatchesVariant(pred, variant))
      .map(pred => foldIdBase(pred.fold_id)),
  );
  const avgValScores = avgValPred ? extractPredictionScoreMap(avgValPred) : (row.avgValScores ?? row.valScores);
  const avgTestScores = avgTestPred ? extractPredictionScoreMap(avgTestPred) : (row.avgTestScores ?? row.testScores);
  const avgTrainScores = avgTrainPred ? extractPredictionScoreMap(avgTrainPred) : row.trainScores;
  const wAvgTestScores = wAvgTestPred ? extractPredictionScoreMap(wAvgTestPred) : row.wAvgTestScores;
  const meanValScores = foldValPredictions.length > 0 ? averagePredictionScoreMaps(foldValPredictions) : row.meanValScores;
  const meanTestScores = foldTestPredictions.length > 0 ? averagePredictionScoreMaps(foldTestPredictions) : row.meanTestScores;
  const minValScores = foldValPredictions.length > 0 ? extremePredictionScoreMaps(foldValPredictions, "min") : row.minValScores;
  const maxValScores = foldValPredictions.length > 0 ? extremePredictionScoreMaps(foldValPredictions, "max") : row.maxValScores;
  const minTestScores = foldTestPredictions.length > 0 ? extremePredictionScoreMaps(foldTestPredictions, "min") : row.minTestScores;
  const maxTestScores = foldTestPredictions.length > 0 ? extremePredictionScoreMaps(foldTestPredictions, "max") : row.maxTestScores;

  return {
    ...row,
    foldCount: foldIds.size > 0 ? foldIds.size : row.foldCount,
    valScores: avgValScores,
    testScores: avgTestScores,
    trainScores: avgTrainScores,
    avgValScores,
    avgTestScores,
    wAvgTestScores,
    meanValScores,
    meanTestScores,
    minValScores,
    maxValScores,
    minTestScores,
    maxTestScores,
    primaryValScore: safeNumber(avgValPred?.val_score) ?? row.primaryValScore,
    primaryTestScore: safeNumber(avgTestPred?.test_score) ?? row.primaryTestScore,
    primaryTrainScore: safeNumber(avgTrainPred?.train_score) ?? row.primaryTrainScore,
  };
}

// ============================================================================
// topChainToRows — for Runs/Results pages (TopChainResult → ScoreCardRow[])
// ============================================================================

/**
 * Maps a TopChainResult (from enriched runs / results summary) into ScoreCardRows.
 *
 * Hierarchy:
 * - If chain has refit: REFIT_CARD (with CROSSVAL_CARD child pre-attached)
 *     → expanding CROSSVAL lazily loads TRAIN_CARDs
 * - If no refit: CROSSVAL_CARD (TRAIN_CARDs loaded lazily when expanded)
 */
export function topChainToRows(
  chain: TopChainResult,
  metric: string | null,
  taskType: string | null,
): ScoreCardRow[] {
  if (hasFinalData(chain)) {
    const rows = [buildRefitRow(chain, metric, taskType)];
    if (hasAggregatedRefitData(chain)) {
      rows.push(buildAggregatedRefitRow(chain, metric, taskType));
    }
    return rows;
  }
  if (hasCvData(chain)) {
    return [buildCrossvalRow(chain, metric, taskType, "raw")];
  }
  return [];
}

export function datasetChainsToRows(
  chains: TopChainResult[],
  metric: string | null,
  taskType: string | null,
): ScoreCardRow[] {
  const refitChains = dedupeChainsByVariant(
    chains.filter(chain => hasFinalData(chain)),
    (a, b) => compareRefitChains(a, b, metric),
  );
  const cvOnlyChains = dedupeChainsByVariant(
    chains.filter(chain => hasCvData(chain) && !hasFinalData(chain)),
    (a, b) => compareCvChains(a, b, metric),
  );
  const refitDisplayVariants = new Set(refitChains.map(displayVariantKey));
  const usedCvChainIds = new Set<string>();
  const refitRows: ScoreCardRow[] = [];

  for (const refitChain of refitChains) {
    const matchedCv = isStandaloneRefitChain(refitChain)
      ? findMatchingCvSourceExact(refitChain, cvOnlyChains, usedCvChainIds, metric)
      : findMatchingCvSource(refitChain, cvOnlyChains, usedCvChainIds, metric);
    if (matchedCv) usedCvChainIds.add(matchedCv.chain_id);
    refitRows.push(buildRefitRow(
      refitChain,
      metric,
      taskType,
      isStandaloneRefitChain(refitChain) ? null : matchedCv,
    ));
    if (hasAggregatedRefitData(refitChain)) {
      refitRows.push(buildAggregatedRefitRow(
        refitChain,
        metric,
        taskType,
        isStandaloneRefitChain(refitChain) ? null : matchedCv,
      ));
    }
  }

  refitRows.sort((a, b) => compareRefitRows(a, b, metric));

  const rows: ScoreCardRow[] = [...refitRows];

  for (const cvChain of cvOnlyChains) {
    if (usedCvChainIds.has(cvChain.chain_id)) continue;
    if (refitDisplayVariants.has(displayVariantKey(cvChain))) continue;
    rows.push(buildCrossvalRow(cvChain, metric, taskType, "raw"));
  }

  return rows;
}

// ============================================================================
// chainSummaryToRow — for Predictions page aggregated (ChainSummary → ScoreCardRow)
// ============================================================================

/**
 * Maps a ChainSummary (from aggregated-predictions) into a ScoreCardRow.
 *
 * If the chain has a final score → REFIT_CARD with a CROSSVAL child pre-attached.
 * Otherwise → CROSSVAL_CARD.
 * TRAIN children are loaded lazily.
 */
export function chainSummaryToRow(summary: ChainSummary): ScoreCardRow {
  const hasFinal = summary.final_test_score != null
    || summary.final_train_score != null
    || !!summary.final_scores;
  const hasCv = !summary.is_refit_only && (summary.cv_val_score != null || summary.cv_fold_count > 0);
  const cvValScores = extractNestedScores(summary.cv_scores, "val");
  const cvTestScores = extractNestedScores(summary.cv_scores, "test");

  // Use all known keys for final_scores extraction
  const allKeys = collectKnownMetricKeys(
    cvValScores,
    cvTestScores,
    summary.final_scores as Record<string, unknown> | null | undefined,
    summary.final_agg_scores as Record<string, unknown> | null | undefined,
  );
  const finalTestScores: Record<string, number | null> = {};
  const finalTrainScores: Record<string, number | null> = {};
  if (summary.final_scores) {
    for (const k of allKeys) {
      finalTestScores[k] = extractScoreValue(summary.final_scores as Record<string, unknown>, k, "test");
      finalTrainScores[k] = extractScoreValue(summary.final_scores as Record<string, unknown>, k, "train");
    }
  }

  // Build CROSSVAL card
  const crossvalRow: ScoreCardRow = {
    id: `cv-${summary.cv_source_chain_id ?? summary.chain_id}`,
    chainId: summary.cv_source_chain_id ?? summary.chain_id,
    runId: summary.run_id,
    pipelineId: summary.pipeline_id,
    datasetName: summary.dataset_name ?? undefined,
    modelName: summary.model_name || "",
    modelClass: summary.model_class,
    preprocessings: summary.preprocessings || null,
    bestParams: (summary.best_params as Record<string, unknown>) ?? null,
    cardType: "crossval",
    foldCount: summary.cv_fold_count,
    metric: summary.metric,
    taskType: summary.task_type,
    testScores: cvTestScores,
    valScores: cvValScores,
    trainScores: {},
    avgValScores: cvValScores,
    avgTestScores: cvTestScores,
    primaryTestScore: safeNumber(summary.cv_test_score),
    primaryValScore: safeNumber(summary.cv_val_score),
    primaryTrainScore: safeNumber(summary.cv_train_score),
    foldArtifacts: summary.fold_artifacts,
    hasRefitArtifact: false,
  };

  if (hasFinal) {
    const aggSource = summary.final_agg_scores as Record<string, unknown> | null | undefined;
    const aggregatedTestScores: Record<string, number | null> = {};
    const aggregatedTrainScores: Record<string, number | null> = {};
    if (aggSource) {
      for (const k of allKeys) {
        aggregatedTestScores[k] = extractScoreValue(aggSource, k, "test");
        aggregatedTrainScores[k] = extractScoreValue(aggSource, k, "train");
      }
    }
    const hasAgg = aggSource != null || summary.final_agg_test_score != null;

    // REFIT card with CROSSVAL child
    const refitRow: ScoreCardRow = {
      id: summary.chain_id,
      chainId: summary.chain_id,
      runId: summary.run_id,
      pipelineId: summary.pipeline_id,
      datasetName: summary.dataset_name ?? undefined,
      modelName: summary.model_name || "",
      modelClass: summary.model_class,
      preprocessings: summary.preprocessings || null,
      bestParams: (summary.best_params as Record<string, unknown>) ?? null,
      cardType: "refit",
      foldId: "final",
      foldCount: summary.is_refit_only ? 0 : summary.cv_fold_count,
      metric: summary.metric,
      taskType: summary.task_type,
      testScores: finalTestScores,
      valScores: {},
      trainScores: finalTrainScores,
      avgValScores: summary.is_refit_only ? {} : cvValScores,
      avgTestScores: summary.is_refit_only ? {} : cvTestScores,
      primaryTestScore: safeNumber(summary.final_test_score),
      primaryValScore: summary.is_refit_only ? null : safeNumber(summary.cv_val_score),
      primaryTrainScore: safeNumber(summary.final_train_score),
      foldArtifacts: summary.fold_artifacts,
      hasRefitArtifact: !summary.synthetic_refit,
      aggregatedTestScores: hasAgg ? aggregatedTestScores : undefined,
      aggregatedTrainScores: hasAgg ? aggregatedTrainScores : undefined,
      primaryAggTestScore: hasAgg ? safeNumber(summary.final_agg_test_score) : undefined,
      primaryAggTrainScore: hasAgg ? safeNumber(summary.final_agg_train_score) : undefined,
      children: hasCv ? [crossvalRow] : [],
    };
    return refitRow;
  }

  return crossvalRow;
}

// ============================================================================
// predictionRecordToRow — for Predictions per-fold (PredictionRecord → ScoreCardRow)
// ============================================================================

/**
 * Maps a PredictionRecord (from parquet per-fold data) to a ScoreCardRow.
 * Always produces a TRAIN card (leaf node in the per-fold flat table).
 */
export function predictionRecordToRow(pred: PredictionRecord): ScoreCardRow {
  const scoresObj = predictionRecordScores(pred);
  const valScores: Record<string, number | null> = {};
  const testScores: Record<string, number | null> = {};
  const trainScores: Record<string, number | null> = {};
  const foldId = pred.fold_id;
  const baseFoldId = foldId ? foldIdBase(foldId) : "";
  const cardType = baseFoldId === "final"
    ? "refit"
    : (baseFoldId === "avg" || baseFoldId === "w_avg")
      ? "crossval"
      : "train";

  if (scoresObj) {
    const valPartition = scoresObj.val;
    const testPartition = scoresObj.test;
    const trainPartition = scoresObj.train;
    if (valPartition && typeof valPartition === "object") {
      for (const [k, v] of Object.entries(valPartition)) valScores[k] = safeNumber(v);
    }
    if (testPartition && typeof testPartition === "object") {
      for (const [k, v] of Object.entries(testPartition)) testScores[k] = safeNumber(v);
    }
    if (trainPartition && typeof trainPartition === "object") {
      for (const [k, v] of Object.entries(trainPartition)) trainScores[k] = safeNumber(v);
    }
  }

  return {
    id: pred.id,
    chainId: pred.trace_id || pred.id,
    datasetName: pred.source_dataset || pred.dataset_name,
    modelName: pred.model_name,
    modelClass: pred.model_classname || "",
    preprocessings: pred.preprocessings || null,
    bestParams: predictionRecordBestParams(pred),
    cardType,
    foldId,
    partition: pred.partition,
    nSamplesEval: pred.n_samples,
    metric: pred.metric || null,
    taskType: pred.task_type || null,
    testScores,
    valScores,
    trainScores,
    primaryTestScore: safeNumber(pred.test_score),
    primaryValScore: safeNumber(pred.val_score),
    primaryTrainScore: safeNumber(pred.train_score),
    hasRefitArtifact: foldId === "final" && !!pred.model_artifact_id,
  };
}

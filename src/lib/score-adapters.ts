/**
 * Adapter functions that map existing API types to the unified ScoreCardRow.
 *
 * Each function maps a specific API response type into one or more ScoreCardRow
 * instances for uniform rendering across History, Results, and Predictions pages.
 */

import type { ScoreCardRow } from "@/types/score-cards";
import type { TopChainResult } from "@/types/enriched-runs";
import type { PartitionPrediction } from "@/types/aggregated-predictions";
import { foldIdBase, safeNumber } from "@/lib/fold-utils";
import {
  averagePredictionScoreMaps,
  coerceScoreMap,
  extractPredictionScoreMap,
  extremePredictionScoreMaps,
  findFoldPrediction,
  foldVariantId,
  foldVariantSuffix,
  isNumberedFoldId,
  predictionMatchesVariant,
  projectPartitionScoreMaps,
  type FoldVariant,
} from "@/lib/score-adapters-fold-scores";
import { projectFinalScoreMaps } from "@/lib/score-adapters-score-maps";
import {
  compareCvChains,
  compareRefitChains,
  compareRefitRows,
  dedupeChainsByVariant,
  displayParams,
  displayVariantKey,
  findMatchingCvSource,
  findMatchingCvSourceExact,
} from "@/lib/score-adapters-chain-matching";

export { coerceScoreMap };
export { chainSummaryToRow, collapseStandaloneRefitSummaries } from "@/lib/score-adapters-chain-summaries";
export { predictionRecordBestParams, predictionRecordToRow } from "@/lib/score-adapters-prediction-records";

// ============================================================================
// Helpers
// ============================================================================

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

function buildCrossvalRow(
  chain: TopChainResult,
  metric: string | null,
  taskType: string | null,
  variant: FoldVariant = "raw",
): ScoreCardRow {
  const hasSummaryScores = variant === "raw";
  const cvValScores = hasSummaryScores ? coerceScoreMap(chain.scores?.val) : {};
  const cvTestScores = hasSummaryScores ? coerceScoreMap(chain.scores?.test) : {};

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
  const cvValScores = coerceScoreMap(effectiveCvSource?.scores?.val);
  const cvTestScores = coerceScoreMap(effectiveCvSource?.scores?.test);
  const { testScores: finalTestScores, trainScores: finalTrainScores } = projectFinalScoreMaps(
    chain.final_scores as Record<string, unknown> | null | undefined,
    cvValScores,
    cvTestScores,
  );

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
  const { testScores: finalTestScores, trainScores: finalTrainScores } = projectFinalScoreMaps(
    aggSource,
    effectiveCvSource?.scores?.val as Record<string, unknown> | null | undefined,
    effectiveCvSource?.scores?.test as Record<string, unknown> | null | undefined,
  );

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
  const scoresObj = pred.scores as Record<string, unknown> | null;
  const { testScores, valScores, trainScores } = projectPartitionScoreMaps(scoresObj, pred.partition);

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

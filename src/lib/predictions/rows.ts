import type { PredictionRecord } from "@/types/linked-workspaces";
import type { ScoreCardRow } from "@/types/score-cards";
import { predictionRecordBestParams, predictionRecordToRow } from "@/lib/score-adapters";
import { FOLD_ORDER, foldIdBase } from "@/lib/fold-utils";
import { getScoreMapValue, isClassificationTaskType } from "@/lib/scores";

export const ALL_FOLD_TYPES = ["folds", "refits", "averages"] as const;
export const ALL_DATA_KINDS = ["raw", "aggregated"] as const;

export type SortField =
  | "model_name"
  | "dataset_name"
  | "fold"
  | "val_score"
  | "test_score"
  | "n_samples"
  | "card_type"
  | "preproc"
  | `metric:${string}`;
export type SortOrder = "asc" | "desc";
export type FoldVisibility = typeof ALL_FOLD_TYPES[number];
export type DataVisibility = typeof ALL_DATA_KINDS[number];
export type MetricTaskFilter = "regression" | "classification";

export const CARD_TYPE_ORDER: Record<string, number> = { refit: 0, crossval: 1, train: 2 };

export function predictionGroupKey(pred: PredictionRecord): string {
  return [
    pred.source_dataset || pred.dataset_name || "",
    pred.trace_id || pred.pipeline_uid || pred.id,
    pred.fold_id || "unknown",
  ].join("::");
}

export function foldSortValue(foldId?: string): number {
  if (!foldId) return Number.MAX_SAFE_INTEGER;
  const baseFoldId = foldIdBase(foldId);
  const aggOffset = foldId === baseFoldId ? 0 : 0.5;
  if (baseFoldId in FOLD_ORDER) return FOLD_ORDER[baseFoldId] + aggOffset;
  const parsed = Number.parseInt(baseFoldId, 10);
  return Number.isFinite(parsed) ? 100 + parsed + aggOffset : 1000 + aggOffset;
}

export function rowFoldVisibility(row: ScoreCardRow): FoldVisibility {
  if (row.cardType === "refit") return "refits";
  if (row.cardType === "crossval") return "averages";
  return "folds";
}

export function rowDataVisibility(row: ScoreCardRow): DataVisibility {
  const foldId = row.foldId;
  if (!foldId) return "raw";
  return foldId === foldIdBase(foldId) ? "raw" : "aggregated";
}

export function collectSortedUniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(
    values.filter((value): value is string => typeof value === "string" && value.trim().length > 0),
  )].sort((a, b) => a.localeCompare(b));
}

export function rowMatchesMetricContext(row: ScoreCardRow, metricTaskFilter: MetricTaskFilter): boolean {
  const isClass = isClassificationTaskType(row.taskType);
  return metricTaskFilter === "classification" ? isClass : !isClass;
}

export function rowMatchesFacetScope(
  row: ScoreCardRow,
  {
    dataset,
    model,
    taskType,
    visibleFoldTypes,
    visibleDataKinds,
  }: {
    dataset?: string;
    model?: string;
    taskType?: string;
    visibleFoldTypes?: readonly FoldVisibility[];
    visibleDataKinds?: readonly DataVisibility[];
  },
): boolean {
  if (dataset && row.datasetName !== dataset) return false;
  if (model && row.modelName !== model && row.modelClass !== model) return false;
  if (taskType && row.taskType !== taskType) return false;
  if (visibleFoldTypes && !visibleFoldTypes.includes(rowFoldVisibility(row))) return false;
  if (visibleDataKinds && !visibleDataKinds.includes(rowDataVisibility(row))) return false;
  return true;
}

export function predictionChainId(pred: PredictionRecord): string {
  return pred.trace_id || pred.pipeline_uid || pred.id;
}

export function buildPredictionModelRows(predictions: PredictionRecord[]): ScoreCardRow[] {
  const groups = new Map<string, PredictionRecord[]>();
  const predictChainIdByChain = new Map<string, string>();

  for (const pred of predictions) {
    const key = predictionGroupKey(pred);
    const group = groups.get(key) ?? [];
    group.push(pred);
    groups.set(key, group);

    const chainId = predictionChainId(pred);
    const predictChainId = pred.predict_chain_id || (pred.model_artifact_id ? chainId : null);
    if (predictChainId) {
      predictChainIdByChain.set(chainId, predictChainId);
    }
  }

  return [...groups.values()].map(group => {
    const testPred = group.find(pred => pred.partition === "test");
    const valPred = group.find(pred => pred.partition === "val");
    const trainPred = group.find(pred => pred.partition === "train");
    const primary = testPred ?? valPred ?? trainPred ?? group[0];

    const row = predictionRecordToRow(primary);

    if (valPred && valPred !== primary) {
      const valRow = predictionRecordToRow(valPred);
      Object.assign(row.valScores, valRow.valScores);
      if (valRow.primaryValScore != null) row.primaryValScore = valRow.primaryValScore;
    }
    if (trainPred && trainPred !== primary) {
      const trainRow = predictionRecordToRow(trainPred);
      Object.assign(row.trainScores, trainRow.trainScores);
      if (trainRow.primaryTrainScore != null) row.primaryTrainScore = trainRow.primaryTrainScore;
    }
    if (testPred && testPred !== primary) {
      const testRow = predictionRecordToRow(testPred);
      Object.assign(row.testScores, testRow.testScores);
      if (testRow.primaryTestScore != null) row.primaryTestScore = testRow.primaryTestScore;
    }

    row.id = primary.id;
    row.chainId = primary.trace_id || row.chainId;
    row.predictChainId = predictChainIdByChain.get(predictionChainId(primary));
    row.datasetName = primary.source_dataset || primary.dataset_name || row.datasetName;
    row.modelName = primary.model_name || row.modelName;
    row.modelClass = primary.model_classname || row.modelClass;
    row.preprocessings = primary.preprocessings || row.preprocessings;
    row.bestParams = predictionRecordBestParams(primary)
      ?? (valPred ? predictionRecordBestParams(valPred) : null)
      ?? (testPred ? predictionRecordBestParams(testPred) : null)
      ?? (trainPred ? predictionRecordBestParams(trainPred) : null)
      ?? row.bestParams;
    row.foldId = primary.fold_id;
    row.partition = undefined;
    row.nSamplesEval = testPred?.n_samples ?? valPred?.n_samples ?? primary.n_samples ?? row.nSamplesEval;
    row.nSamplesTrain = trainPred?.n_samples ?? null;
    row.hasRefitArtifact = !!row.predictChainId;

    return row;
  });
}

function rowScoreValue(row: ScoreCardRow, key: string, partition: "test" | "val"): number {
  const maps = partition === "test"
    ? [row.testScores, row.aggregatedTestScores, row.avgTestScores, row.wAvgTestScores, row.meanTestScores]
    : [row.valScores, row.avgValScores, row.meanValScores];
  for (const map of maps) {
    const value = getScoreMapValue(map as Record<string, unknown> | undefined, key);
    if (value != null && Number.isFinite(value)) return value;
  }
  return Number.POSITIVE_INFINITY;
}

/**
 * Build the row comparator used by the predictions table. Mirrors the previous
 * in-page sort closure: a metric sort key compares the resolved test-partition
 * score; otherwise the named field dictates the comparison, and `sortOrder`
 * flips the result.
 */
export function createRowComparator(
  sortField: SortField,
  sortOrder: SortOrder,
): (a: ScoreCardRow, b: ScoreCardRow) => number {
  const metricSortKey = sortField.startsWith("metric:") ? sortField.slice("metric:".length) : null;

  return (a, b) => {
    let cmp = 0;

    if (metricSortKey) {
      cmp = rowScoreValue(a, metricSortKey, "test") - rowScoreValue(b, metricSortKey, "test");
    } else {
      switch (sortField) {
        case "test_score":
          cmp = (a.primaryTestScore ?? Number.POSITIVE_INFINITY) - (b.primaryTestScore ?? Number.POSITIVE_INFINITY);
          break;
        case "val_score":
          cmp = (a.primaryValScore ?? Number.POSITIVE_INFINITY) - (b.primaryValScore ?? Number.POSITIVE_INFINITY);
          break;
        case "n_samples":
          cmp = (a.nSamplesEval ?? 0) - (b.nSamplesEval ?? 0);
          break;
        case "fold":
          cmp = foldSortValue(a.foldId) - foldSortValue(b.foldId);
          break;
        case "model_name":
          cmp = a.modelName.localeCompare(b.modelName);
          break;
        case "dataset_name":
          cmp = (a.datasetName || "").localeCompare(b.datasetName || "");
          break;
        case "card_type":
          cmp = (CARD_TYPE_ORDER[a.cardType] ?? 99) - (CARD_TYPE_ORDER[b.cardType] ?? 99);
          break;
        case "preproc":
          cmp = (a.preprocessings || "").localeCompare(b.preprocessings || "");
          break;
      }
    }

    return sortOrder === "asc" ? cmp : -cmp;
  };
}

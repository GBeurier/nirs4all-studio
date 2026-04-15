import type {
  PartitionPrediction,
  PredictionArraysResponse,
} from "@/types/aggregated-predictions";
import type { ConfusionMatrixCell, ConfusionMatrixResponse } from "@/types/inspector";

export type ConfusionMatrixNormalize = "none" | "row" | "column" | "all";

const PARTITION_RANK: Record<string, number> = {
  train: 0,
  val: 1,
  test: 2,
  final: 3,
};

function toLabel(value: number | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return String(value);
}

export function isClassificationTask(taskType: string | null | undefined): boolean {
  return typeof taskType === "string" && taskType.toLowerCase().includes("classification");
}

export function sortPartitions(partitions: Iterable<string>): string[] {
  return Array.from(new Set(partitions)).sort((a, b) => {
    const rankA = PARTITION_RANK[a] ?? Number.MAX_SAFE_INTEGER;
    const rankB = PARTITION_RANK[b] ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.localeCompare(b);
  });
}

export function formatPartitionLabel(partitions: Iterable<string>): string {
  const ordered = sortPartitions(partitions);
  return ordered.length > 0 ? ordered.join(" + ") : "none";
}

export function buildConfusionMatrixFromVectors({
  yTrue,
  yPred,
  normalize,
  partitionLabel,
}: {
  yTrue: Array<number | null | undefined>;
  yPred: Array<number | null | undefined>;
  normalize: ConfusionMatrixNormalize;
  partitionLabel: string;
}): ConfusionMatrixResponse {
  const counts = new Map<string, number>();
  const labels = new Set<string>();
  let totalSamples = 0;

  const n = Math.min(yTrue.length, yPred.length);
  for (let index = 0; index < n; index += 1) {
    const trueLabel = toLabel(yTrue[index]);
    const predLabel = toLabel(yPred[index]);
    if (!trueLabel || !predLabel) continue;

    labels.add(trueLabel);
    labels.add(predLabel);
    counts.set(`${trueLabel}|${predLabel}`, (counts.get(`${trueLabel}|${predLabel}`) ?? 0) + 1);
    totalSamples += 1;
  }

  const orderedLabels = Array.from(labels).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
  );

  if (orderedLabels.length === 0 || totalSamples === 0) {
    return {
      cells: [],
      labels: [],
      total_samples: 0,
      partition: partitionLabel,
      normalize,
      reason: "No class predictions are available for this fold and partition selection.",
    };
  }

  if (orderedLabels.length > 24) {
    return {
      cells: [],
      labels: [],
      total_samples: 0,
      partition: partitionLabel,
      normalize,
      reason: `Too many class labels (${orderedLabels.length}) to render a meaningful confusion matrix.`,
    };
  }

  const rowTotals = new Map<string, number>();
  const colTotals = new Map<string, number>();

  for (const trueLabel of orderedLabels) {
    rowTotals.set(
      trueLabel,
      orderedLabels.reduce((sum, predLabel) => sum + (counts.get(`${trueLabel}|${predLabel}`) ?? 0), 0),
    );
  }

  for (const predLabel of orderedLabels) {
    colTotals.set(
      predLabel,
      orderedLabels.reduce((sum, trueLabel) => sum + (counts.get(`${trueLabel}|${predLabel}`) ?? 0), 0),
    );
  }

  const cells: ConfusionMatrixCell[] = [];
  for (const trueLabel of orderedLabels) {
    for (const predLabel of orderedLabels) {
      const count = counts.get(`${trueLabel}|${predLabel}`) ?? 0;
      let normalized: number | null = null;

      if (normalize === "row") {
        const total = rowTotals.get(trueLabel) ?? 0;
        normalized = total > 0 ? Number((count / total).toFixed(4)) : null;
      } else if (normalize === "column") {
        const total = colTotals.get(predLabel) ?? 0;
        normalized = total > 0 ? Number((count / total).toFixed(4)) : null;
      } else if (normalize === "all") {
        normalized = totalSamples > 0 ? Number((count / totalSamples).toFixed(4)) : null;
      }

      cells.push({
        true_label: trueLabel,
        pred_label: predLabel,
        count,
        normalized,
      });
    }
  }

  return {
    cells,
    labels: orderedLabels,
    total_samples: totalSamples,
    partition: partitionLabel,
    normalize,
  };
}

export function buildConfusionMatrixData({
  rows,
  arraysByPredictionId,
  activePartitions,
  normalize,
  partitionLabel,
}: {
  rows: PartitionPrediction[];
  arraysByPredictionId: Record<string, PredictionArraysResponse>;
  activePartitions: Set<string>;
  normalize: ConfusionMatrixNormalize;
  partitionLabel: string;
}): ConfusionMatrixResponse {
  if (activePartitions.size === 0) {
    return {
      cells: [],
      labels: [],
      total_samples: 0,
      partition: partitionLabel,
      normalize,
      reason: "Select at least one partition to build the confusion matrix.",
    };
  }

  const yTrue: number[] = [];
  const yPred: number[] = [];

  for (const row of rows) {
    if (!activePartitions.has(row.partition)) continue;
    const arrays = arraysByPredictionId[row.prediction_id];
    if (!arrays?.y_true || !arrays?.y_pred) continue;

    const n = Math.min(arrays.y_true.length, arrays.y_pred.length);
    for (let index = 0; index < n; index += 1) {
      yTrue.push(arrays.y_true[index]);
      yPred.push(arrays.y_pred[index]);
    }
  }

  return buildConfusionMatrixFromVectors({
    yTrue,
    yPred,
    normalize,
    partitionLabel,
  });
}

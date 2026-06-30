import { buildConfusionMatrixFromVectors } from "@/components/runs/modelDetailClassification";
import type { PartitionDataset, TaskKind } from "./types";

export interface MetricsStripStat {
  label: string;
  value: string;
}

function formatMetric(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function buildRegressionStats(datasets: PartitionDataset[]): MetricsStripStat[] {
  const yTrue: number[] = [];
  const yPred: number[] = [];
  for (const dataset of datasets) {
    const n = Math.min(dataset.yTrue.length, dataset.yPred.length);
    for (let i = 0; i < n; i++) {
      const actual = dataset.yTrue[i];
      const predicted = dataset.yPred[i];
      if (Number.isFinite(actual) && Number.isFinite(predicted)) {
        yTrue.push(actual);
        yPred.push(predicted);
      }
    }
  }

  const n = yTrue.length;
  if (n === 0) {
    return [
      { label: "RMSE", value: "—" },
      { label: "R²", value: "—" },
      { label: "MAE", value: "—" },
      { label: "n", value: "0" },
    ];
  }

  let sumSqErr = 0;
  let sumAbsErr = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    const err = yTrue[i] - yPred[i];
    sumSqErr += err * err;
    sumAbsErr += Math.abs(err);
    sumY += yTrue[i];
  }

  const meanY = sumY / n;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const delta = yTrue[i] - meanY;
    ssTot += delta * delta;
  }

  const rmse = Math.sqrt(sumSqErr / n);
  const mae = sumAbsErr / n;
  const r2 = ssTot > 0 ? 1 - sumSqErr / ssTot : 0;

  return [
    { label: "RMSE", value: formatMetric(rmse) },
    { label: "R²", value: formatMetric(r2) },
    { label: "MAE", value: formatMetric(mae) },
    { label: "n", value: String(n) },
  ];
}

function buildClassificationStats(datasets: PartitionDataset[]): MetricsStripStat[] {
  const yTrue: number[] = [];
  const yPred: number[] = [];
  for (const dataset of datasets) {
    const n = Math.min(dataset.yTrue.length, dataset.yPred.length);
    for (let i = 0; i < n; i++) {
      yTrue.push(dataset.yTrue[i]);
      yPred.push(dataset.yPred[i]);
    }
  }

  const matrix = buildConfusionMatrixFromVectors({
    yTrue,
    yPred,
    normalize: "none",
    partitionLabel: "pooled",
  });

  if (matrix.labels.length === 0 || matrix.total_samples === 0) {
    return [
      { label: "Accuracy", value: "—" },
      { label: "F1 (macro)", value: "—" },
      { label: "Precision (macro)", value: "—" },
      { label: "Recall (macro)", value: "—" },
    ];
  }

  const cellMap = new Map<string, number>();
  for (const cell of matrix.cells) {
    cellMap.set(`${cell.true_label}|${cell.pred_label}`, cell.count);
  }

  let correct = 0;
  let sumPrecision = 0;
  let sumRecall = 0;
  let sumF1 = 0;
  for (const label of matrix.labels) {
    const truePositive = cellMap.get(`${label}|${label}`) ?? 0;
    let predTotal = 0;
    let trueTotal = 0;
    for (const other of matrix.labels) {
      predTotal += cellMap.get(`${other}|${label}`) ?? 0;
      trueTotal += cellMap.get(`${label}|${other}`) ?? 0;
    }
    correct += truePositive;
    const precision = predTotal > 0 ? truePositive / predTotal : 0;
    const recall = trueTotal > 0 ? truePositive / trueTotal : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    sumPrecision += precision;
    sumRecall += recall;
    sumF1 += f1;
  }

  const labelCount = matrix.labels.length;
  return [
    { label: "Accuracy", value: formatMetric(correct / matrix.total_samples) },
    { label: "F1 (macro)", value: formatMetric(sumF1 / labelCount) },
    { label: "Precision (macro)", value: formatMetric(sumPrecision / labelCount) },
    { label: "Recall (macro)", value: formatMetric(sumRecall / labelCount) },
  ];
}

export function buildMetricsStripStats(
  taskKind: TaskKind,
  datasets: PartitionDataset[],
): MetricsStripStat[] {
  return taskKind === "classification"
    ? buildClassificationStats(datasets)
    : buildRegressionStats(datasets);
}

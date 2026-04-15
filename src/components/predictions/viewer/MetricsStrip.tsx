/**
 * Bottom strip showing pooled-over-visible-partitions metrics.
 *
 * Regression: RMSE / R² / MAE.
 * Classification: Accuracy / F1 macro / Precision macro / Recall macro.
 */

import { useMemo } from "react";
import { buildConfusionMatrixFromVectors } from "@/components/runs/modelDetailClassification";
import type { PartitionDataset, TaskKind, ViewerHeader } from "./types";

interface MetricsStripProps {
  taskKind: TaskKind;
  datasets: PartitionDataset[];
  header: ViewerHeader;
}

interface StatCard {
  label: string;
  value: string;
}

function formatMetric(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(4);
}

function computeRegression(datasets: PartitionDataset[]): StatCard[] {
  const yTrue: number[] = [];
  const yPred: number[] = [];
  for (const d of datasets) {
    const n = Math.min(d.yTrue.length, d.yPred.length);
    for (let i = 0; i < n; i++) {
      const t = d.yTrue[i];
      const p = d.yPred[i];
      if (Number.isFinite(t) && Number.isFinite(p)) {
        yTrue.push(t);
        yPred.push(p);
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
    const d = yTrue[i] - meanY;
    ssTot += d * d;
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

function computeClassification(datasets: PartitionDataset[]): StatCard[] {
  const yTrue: number[] = [];
  const yPred: number[] = [];
  for (const d of datasets) {
    const n = Math.min(d.yTrue.length, d.yPred.length);
    for (let i = 0; i < n; i++) {
      yTrue.push(d.yTrue[i]);
      yPred.push(d.yPred[i]);
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
  const labels = matrix.labels;
  const cellMap = new Map<string, number>();
  for (const c of matrix.cells) {
    cellMap.set(`${c.true_label}|${c.pred_label}`, c.count);
  }
  let correct = 0;
  let sumPrecision = 0;
  let sumRecall = 0;
  let sumF1 = 0;
  for (const label of labels) {
    const tp = cellMap.get(`${label}|${label}`) ?? 0;
    let predTotal = 0;
    let trueTotal = 0;
    for (const other of labels) {
      predTotal += cellMap.get(`${other}|${label}`) ?? 0;
      trueTotal += cellMap.get(`${label}|${other}`) ?? 0;
    }
    correct += tp;
    const precision = predTotal > 0 ? tp / predTotal : 0;
    const recall = trueTotal > 0 ? tp / trueTotal : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    sumPrecision += precision;
    sumRecall += recall;
    sumF1 += f1;
  }
  const k = labels.length;
  return [
    { label: "Accuracy", value: formatMetric(correct / matrix.total_samples) },
    { label: "F1 (macro)", value: formatMetric(sumF1 / k) },
    { label: "Precision (macro)", value: formatMetric(sumPrecision / k) },
    { label: "Recall (macro)", value: formatMetric(sumRecall / k) },
  ];
}

export function MetricsStrip({ taskKind, datasets }: MetricsStripProps) {
  const stats = useMemo<StatCard[]>(() => {
    return taskKind === "classification"
      ? computeClassification(datasets)
      : computeRegression(datasets);
  }, [taskKind, datasets]);

  return (
    <div className="grid grid-cols-4 gap-2 border-t bg-muted/20 px-4 py-2">
      {stats.map((s) => (
        <div
          key={s.label}
          className="flex flex-col items-start justify-center rounded-md border border-border/50 bg-card px-3 py-1.5"
        >
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {s.label}
          </div>
          <div className="text-sm font-semibold text-foreground">{s.value}</div>
        </div>
      ))}
    </div>
  );
}

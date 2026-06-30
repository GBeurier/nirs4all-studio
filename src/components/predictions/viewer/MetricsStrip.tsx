/**
 * Bottom strip showing pooled-over-visible-partitions metrics.
 *
 * Regression: RMSE / R² / MAE.
 * Classification: Accuracy / F1 macro / Precision macro / Recall macro.
 */

import { useMemo } from "react";
import {
  buildMetricsStripStats,
  type MetricsStripStat,
} from "./metricsStripData";
import type { PartitionDataset, TaskKind } from "./types";

interface MetricsStripProps {
  taskKind: TaskKind;
  datasets: PartitionDataset[];
}

export function MetricsStrip({ taskKind, datasets }: MetricsStripProps) {
  const stats = useMemo<MetricsStripStat[]>(
    () => buildMetricsStripStats(taskKind, datasets),
    [taskKind, datasets],
  );

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

import type { ConformalPredictionRow } from "@/ui/conformal";
import type { PartitionDataset } from "./types";

function resolveCoverage(rows: readonly ConformalPredictionRow[], requestedCoverage?: number | null): number | null {
  if (requestedCoverage != null) return requestedCoverage;
  return rows[0]?.intervals[0]?.coverage ?? null;
}

export function attachConformalIntervalsToSingleDataset(
  datasets: readonly PartitionDataset[],
  rows: readonly ConformalPredictionRow[],
  requestedCoverage?: number | null,
): PartitionDataset[] {
  if (datasets.length !== 1 || rows.length === 0) return [...datasets];

  const dataset = datasets[0];
  const sampleCount = Math.min(dataset.yTrue.length, dataset.yPred.length);
  if (sampleCount !== rows.length) return [...datasets];

  const coverage = resolveCoverage(rows, requestedCoverage);
  if (coverage == null) return [...datasets];

  const conformalIntervals = rows.map((row) => {
    const interval = row.intervals.find(candidate => candidate.coverage === coverage);
    if (!interval) return null;
    return {
      coverage: interval.coverage,
      coverageLabel: interval.coverageLabel,
      lower: interval.lower,
      upper: interval.upper,
    };
  });

  const coverageLabel = conformalIntervals.find(interval => interval != null)?.coverageLabel;
  if (!coverageLabel || conformalIntervals.every(interval => interval == null)) return [...datasets];

  return [{
    ...dataset,
    conformalCoverage: coverage,
    conformalCoverageLabel: coverageLabel,
    conformalIntervals,
  }];
}

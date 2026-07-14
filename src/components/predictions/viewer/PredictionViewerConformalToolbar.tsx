import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  PartitionDataset,
  ViewerPartitionTarget,
} from "./types";

export interface PredictionViewerConformalCoverageOption {
  coverage: number;
  label: string;
}

export interface PredictionViewerConformalDisplayState {
  coverageLabel: string | null;
  message: string;
  tone: "active" | "muted" | "warning";
  visible: boolean;
}

interface PredictionViewerConformalToolbarProps {
  datasets: PartitionDataset[];
  onSelectedCoverageChange: (coverage: number) => void;
  partitions: ViewerPartitionTarget[];
  selectedCoverage: number | null;
}

function hasConformalRows(target: ViewerPartitionTarget): boolean {
  return (target.conformalRows?.length ?? 0) > 0;
}

function formatCoverageLabel(coverage: number): string {
  return `${Math.round(coverage * 1000) / 10}%`;
}

export function createPredictionViewerConformalCoverageOptions(
  partitions: readonly ViewerPartitionTarget[],
): PredictionViewerConformalCoverageOption[] {
  const labels = new Map<number, string>();
  for (const target of partitions) {
    for (const row of target.conformalRows ?? []) {
      for (const interval of row.intervals) {
        if (!labels.has(interval.coverage)) {
          labels.set(interval.coverage, interval.coverageLabel || formatCoverageLabel(interval.coverage));
        }
      }
    }
  }
  return [...labels.entries()]
    .sort(([left], [right]) => left - right)
    .map(([coverage, label]) => ({ coverage, label }));
}

export function resolvePredictionViewerDefaultConformalCoverage(
  partitions: readonly ViewerPartitionTarget[],
): number | null {
  const options = createPredictionViewerConformalCoverageOptions(partitions);
  if (options.length === 0) return null;
  const requested = partitions.find(hasConformalRows)?.conformalCoverage;
  if (requested != null && options.some(option => option.coverage === requested)) {
    return requested;
  }
  return options[0]?.coverage ?? null;
}

export function withPredictionViewerConformalCoverage(
  partitions: readonly ViewerPartitionTarget[],
  coverage: number | null,
): ViewerPartitionTarget[] {
  if (coverage == null) return [...partitions];
  return partitions.map(target => hasConformalRows(target)
    ? { ...target, conformalCoverage: coverage }
    : target);
}

export function getPredictionViewerConformalDisplayState(
  partitions: readonly ViewerPartitionTarget[],
  datasets: readonly PartitionDataset[],
  selectedCoverage: number | null,
): PredictionViewerConformalDisplayState {
  const options = createPredictionViewerConformalCoverageOptions(partitions);
  if (options.length === 0) {
    return {
      coverageLabel: null,
      message: "",
      tone: "muted",
      visible: false,
    };
  }

  const conformalTargetCount = partitions.filter(hasConformalRows).length;
  const option = options.find(candidate => candidate.coverage === selectedCoverage);
  const coverageLabel = option?.label ?? null;
  if (conformalTargetCount !== 1) {
    return {
      coverageLabel,
      message: "Conformal intervals are displayed only when a single calibrated partition is open.",
      tone: "warning",
      visible: true,
    };
  }
  if (selectedCoverage == null || !option) {
    return {
      coverageLabel,
      message: "The selected conformal coverage is not materialized in this artifact.",
      tone: "warning",
      visible: true,
    };
  }
  if (datasets.length === 0) {
    return {
      coverageLabel,
      message: "Select the calibrated partition to display conformal intervals.",
      tone: "muted",
      visible: true,
    };
  }
  if (datasets.length !== 1) {
    return {
      coverageLabel,
      message: "Conformal intervals are displayed only for one visible partition at a time.",
      tone: "warning",
      visible: true,
    };
  }

  const dataset = datasets[0];
  if (dataset.conformalCoverage === selectedCoverage && dataset.conformalIntervals?.some(interval => interval != null)) {
    return {
      coverageLabel: dataset.conformalCoverageLabel ?? coverageLabel,
      message: `${dataset.conformalCoverageLabel ?? coverageLabel} conformal intervals are displayed from the attached calibrated artifact.`,
      tone: "active",
      visible: true,
    };
  }

  return {
    coverageLabel,
    message: "Conformal intervals could not be aligned with the current prediction sample order.",
    tone: "warning",
    visible: true,
  };
}

export function PredictionViewerConformalToolbar({
  datasets,
  onSelectedCoverageChange,
  partitions,
  selectedCoverage,
}: PredictionViewerConformalToolbarProps) {
  const options = createPredictionViewerConformalCoverageOptions(partitions);
  const state = getPredictionViewerConformalDisplayState(partitions, datasets, selectedCoverage);
  if (!state.visible) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
        <Badge
          variant={state.tone === "active" ? "default" : "outline"}
          className="h-5 px-1.5"
        >
          Conformal
        </Badge>
        <span className={state.tone === "warning" ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}>
          {state.message}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {options.map(option => (
          <Button
            key={option.coverage}
            type="button"
            variant={option.coverage === selectedCoverage ? "default" : "outline"}
            size="sm"
            className="h-7 px-2 text-xs"
            aria-pressed={option.coverage === selectedCoverage}
            onClick={() => onSelectedCoverageChange(option.coverage)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

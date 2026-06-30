import { getMetricAbbreviation, isLowerBetter } from "@/lib/scores";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export interface InspectorScoreOption {
  value: ScoreColumn;
  label: string;
}

export const INSPECTOR_SCORE_OPTIONS: readonly InspectorScoreOption[] = [
  { value: "cv_val_score", label: "CV Val Score" },
  { value: "cv_test_score", label: "CV Test Score" },
  { value: "cv_train_score", label: "CV Train Score" },
  { value: "final_test_score", label: "Final Test Score" },
  { value: "final_train_score", label: "Final Train Score" },
] as const;

export function getInspectorScoreColumnLabel(scoreColumn: ScoreColumn): string {
  return INSPECTOR_SCORE_OPTIONS.find((option) => option.value === scoreColumn)?.label ?? scoreColumn;
}

export function getInspectorReferenceMetric(
  chains: readonly InspectorChainSummary[],
): string | null {
  return chains.find((chain) => chain.metric)?.metric ?? null;
}

export function isInspectorScoreLowerBetter(metric: string | null | undefined): boolean {
  return isLowerBetter(metric ?? null);
}

export function getInspectorScoreDirectionLabel(metric: string | null | undefined): string {
  return isInspectorScoreLowerBetter(metric) ? "Lower is better" : "Higher is better";
}

export function getInspectorMetricDisplayName(
  metric: string | null | undefined,
  scoreColumn: ScoreColumn,
): string {
  return getMetricAbbreviation(metric ?? scoreColumn);
}

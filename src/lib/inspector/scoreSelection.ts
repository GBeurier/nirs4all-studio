import type { TFunction } from "i18next";
import { getMetricAbbreviation, isLowerBetter } from "@/lib/scores";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export interface InspectorScoreOption {
  value: ScoreColumn;
  labelKey: string;
}

export const INSPECTOR_SCORE_OPTIONS: readonly InspectorScoreOption[] = [
  { value: "cv_val_score", labelKey: "inspector.scores.cv_val_score" },
  { value: "cv_test_score", labelKey: "inspector.scores.cv_test_score" },
  { value: "cv_train_score", labelKey: "inspector.scores.cv_train_score" },
  { value: "final_test_score", labelKey: "inspector.scores.final_test_score" },
  { value: "final_train_score", labelKey: "inspector.scores.final_train_score" },
] as const;

export function getInspectorScoreColumnLabel(scoreColumn: ScoreColumn, t: TFunction): string {
  const option = INSPECTOR_SCORE_OPTIONS.find((candidate) => candidate.value === scoreColumn);
  return option ? t(option.labelKey) : scoreColumn;
}

export function getInspectorReferenceMetric(
  chains: readonly InspectorChainSummary[],
): string | null {
  return chains.find((chain) => chain.metric)?.metric ?? null;
}

export function isInspectorScoreLowerBetter(metric: string | null | undefined): boolean {
  return isLowerBetter(metric ?? null);
}

export function getInspectorScoreDirectionLabel(metric: string | null | undefined, t: TFunction): string {
  return isInspectorScoreLowerBetter(metric)
    ? t("inspector.scores.lowerIsBetter")
    : t("inspector.scores.higherIsBetter");
}

export function getInspectorMetricDisplayName(
  metric: string | null | undefined,
  scoreColumn: ScoreColumn,
): string {
  return getMetricAbbreviation(metric ?? scoreColumn);
}

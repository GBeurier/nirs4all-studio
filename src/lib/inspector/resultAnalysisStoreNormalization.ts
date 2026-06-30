import type { ScoreColumn } from "@/types/inspector";
import type { ResultAnalysisMetricScoreSlot } from "@/lib/inspector/resultAnalysisStore";

interface ScoreObject {
  value?: unknown;
  score?: unknown;
}

export function sortedValues(values: Iterable<string | null | undefined>): string[] {
  return [...new Set(
    [...values]
      .map(value => value?.trim() ?? "")
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

export function normalizeText(value: string | null | undefined): string | null {
  const text = value?.trim() ?? "";
  return text.length > 0 ? text : null;
}

export function normalizeRequiredText(value: string | null | undefined, fallback: string): string {
  return normalizeText(value) ?? fallback;
}

export function normalizeFiniteScore(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const scoreObject = value as ScoreObject;
  return normalizeFiniteScore(scoreObject.value ?? scoreObject.score);
}

export function normalizeFoldCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return { ...(value as Record<string, unknown>) };
}

export function normalizeScoreSlot(slot: ResultAnalysisMetricScoreSlot): ScoreColumn | null {
  switch (slot) {
    case "cv_val_score":
    case "cv_val":
    case "cv_validation":
    case "validation":
    case "val":
      return "cv_val_score";
    case "cv_test_score":
    case "cv_test":
    case "test":
      return "cv_test_score";
    case "cv_train_score":
    case "cv_train":
    case "train":
      return "cv_train_score";
    case "final_test_score":
    case "final_test":
    case "holdout":
      return "final_test_score";
    case "final_train_score":
    case "final_train":
      return "final_train_score";
    default:
      return null;
  }
}

export function normalizeKeyPart(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

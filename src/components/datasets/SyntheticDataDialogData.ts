/**
 * Pure data / read-model helpers for {@link SyntheticDataDialog}.
 *
 * This module holds the non-React logic of the synthetic-data dialog: config
 * cloning, preset patching, task-type classification, numeric input coercion,
 * generation-readiness, and user-facing copy helpers. Keeping it free of React
 * state, queries, and side effects makes the behavior unit-testable and keeps
 * the dialog ready for future multimodal synthetic datasets.
 */

import type {
  GenerateSyntheticRequest,
  SyntheticPreset,
} from "@/types/settings";
import { DEFAULT_SYNTHETIC_CONFIG } from "@/types/settings";

type TaskType = GenerateSyntheticRequest["task_type"];

/** Default class count used by the custom-configuration tab. */
export const DEFAULT_N_CLASSES = 3;

/** Default repetitions-per-sample fallback for the advanced options. */
export const DEFAULT_REPETITIONS_PER_SAMPLE = 3;

/** Default batch-count fallback for the advanced options. */
export const DEFAULT_N_BATCHES = 3;

/**
 * Produce a fresh, independent copy of the default synthetic config.
 *
 * Used both to seed the form and to reset it after a successful generation, so
 * callers always start from an unmutated baseline.
 */
export function createInitialSyntheticConfig(): GenerateSyntheticRequest {
  return { ...DEFAULT_SYNTHETIC_CONFIG };
}

/** Whether a task type requires a class count (anything but regression). */
export function isClassificationTask(taskType: TaskType): boolean {
  return taskType !== "regression";
}

/**
 * Class-count policy applied when a preset is selected: multiclass presets get
 * three classes, everything else (binary/regression) gets two.
 */
export function presetClassCount(taskType: TaskType): number {
  return taskType === "multiclass_classification" ? 3 : 2;
}

/**
 * Patch an existing config with a chosen preset, applying the preset class-count
 * policy. Returns a new object; the input is not mutated.
 */
export function applyPresetToConfig(
  config: GenerateSyntheticRequest,
  preset: SyntheticPreset,
): GenerateSyntheticRequest {
  return {
    ...config,
    task_type: preset.task_type,
    n_samples: preset.n_samples,
    complexity: preset.complexity,
    n_classes: presetClassCount(preset.task_type),
  };
}

/**
 * Coerce a raw numeric `<input>` value to an integer, falling back when the
 * value is empty or non-numeric (mirrors `parseInt(value) || fallback`).
 */
export function coerceIntInput(value: string, fallback: number): number {
  return parseInt(value, 10) || fallback;
}

/** The two tabs of the dialog. */
export type SyntheticDialogTab = "presets" | "custom";

/**
 * Whether the Generate button should be disabled: while a generation is in
 * flight, or on the presets tab with no preset chosen yet.
 */
export function isGenerateDisabled(params: {
  isGenerating: boolean;
  activeTab: SyntheticDialogTab;
  selectedPreset: string | null;
}): boolean {
  const { isGenerating, activeTab, selectedPreset } = params;
  return isGenerating || (activeTab === "presets" && !selectedPreset);
}

/** Extract a human-readable message from a generation error. */
export function getGenerationErrorMessage(error: unknown): string {
  return (error as Error | null)?.message || "Unknown error";
}

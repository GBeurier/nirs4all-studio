/**
 * CartesianGeneratorData - Pure logic for the cartesian generator UI
 *
 * Holds the variant/combination math, label/summary formatting, badge styling,
 * and option-filtering rules used by `CartesianGenerator.tsx` and
 * `CartesianGeneratorSections.tsx`. Everything here is framework-free and
 * synchronously testable; the components stay thin presentation/orchestration.
 */

import { calculateCartesianStageVariants } from "./variantCounting";
import type { PipelineStep, StepOption, StepType } from "./types";

export interface StepOptionGroup {
  type: StepType;
  options: StepOption[];
}

export interface CartesianSummary {
  /** e.g. "2 stages" */
  stages: string;
  /** e.g. "6 base combinations" */
  baseCombinations: string;
  /** e.g. "12 generated variants"; omitted when it equals the base count */
  generatedVariants?: string;
}

/** Step types offered when adding an option to a cartesian stage. */
export const CARTESIAN_ADD_OPTION_TYPES = [
  "preprocessing",
  "model",
] as const satisfies readonly StepType[];

/** Max options listed per type group in the add-option picker. */
export const CARTESIAN_PICKER_OPTIONS_PER_TYPE = 5;

/** Above this base-combination count, no preview examples are generated. */
export const MAX_PREVIEW_BASE_COMBINATIONS = 20;

/** Max number of example rows shown in the combination preview. */
export const MAX_PREVIEW_EXAMPLES = 10;

/** Placeholder shown for an empty stage inside a combination example. */
export const EMPTY_STAGE_PLACEHOLDER = "(empty)";

/**
 * Format a count with its (auto-pluralized) noun, e.g. `pluralize(2, "option")`
 * -> "2 options".
 */
export function pluralize(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

/**
 * Like {@link pluralize} but with a locale-formatted count, used wherever the UI
 * shows potentially large totals, e.g. "1,024 base combinations".
 */
export function pluralizeLocale(count: number, singular: string): string {
  return `${count.toLocaleString()} ${singular}${count === 1 ? "" : "s"}`;
}

/** Default label for a stage at the given 0-based index. */
export function getCartesianStageDefaultLabel(index: number): string {
  return `Stage ${index + 1}`;
}

/** Resolve a stage's display label, falling back to the default. */
export function resolveCartesianStageLabel(
  label: string | undefined,
  index: number,
): string {
  return label || getCartesianStageDefaultLabel(index);
}

/** The "N options" badge shown on a stage header. */
export function getCartesianStageOptionsLabel(optionCount: number): string {
  return pluralize(optionCount, "option");
}

/**
 * Number of base combinations across every stage (product of per-stage variant
 * counts). This is the "one option per stage" count before generator options
 * (pick/arrange/count) are applied.
 */
export function computeBaseCombinations(
  stages: readonly PipelineStep[][],
): number {
  return stages.reduce(
    (acc, stage) => acc * calculateCartesianStageVariants(stage),
    1,
  );
}

/** Header summary fragments for the generator container. */
export function getCartesianSummary(
  stageCount: number,
  baseCombinations: number,
  totalVariants: number,
): CartesianSummary {
  return {
    stages: pluralize(stageCount, "stage"),
    baseCombinations: pluralizeLocale(baseCombinations, "base combination"),
    generatedVariants:
      totalVariants !== baseCombinations
        ? pluralizeLocale(totalVariants, "generated variant")
        : undefined,
  };
}

/**
 * Tailwind classes for the "N pipelines" badge, escalating with the variant
 * total.
 */
export function getCartesianVariantBadgeClassName(totalVariants: number): string {
  return totalVariants > 1000
    ? "bg-red-500/20 text-red-600"
    : totalVariants > 100
      ? "bg-orange-500/20 text-orange-600"
      : "bg-cyan-500/20 text-cyan-600";
}

/**
 * Enumerate up to {@link MAX_PREVIEW_EXAMPLES} concrete option-name combinations
 * across the stages. Returns an empty list when there are no stages or when the
 * base-combination count is too large to preview.
 */
export function generateCombinationExamples(
  stages: readonly PipelineStep[][],
  baseCombinations: number,
): string[][] {
  if (stages.length === 0) return [];
  if (baseCombinations > MAX_PREVIEW_BASE_COMBINATIONS) return [];

  const examples: string[][] = [];

  const walk = (stageIndex: number, current: string[]): void => {
    if (stageIndex >= stages.length) {
      examples.push([...current]);
      return;
    }

    const stage = stages[stageIndex];
    if (stage.length === 0) {
      walk(stageIndex + 1, [...current, EMPTY_STAGE_PLACEHOLDER]);
    } else {
      for (const option of stage) {
        walk(stageIndex + 1, [...current, option.name]);
      }
    }
  };

  walk(0, []);
  return examples.slice(0, MAX_PREVIEW_EXAMPLES);
}

/** Whether more combinations exist than the preview can show. */
export function hasMoreCombinations(baseCombinations: number): boolean {
  return baseCombinations > MAX_PREVIEW_EXAMPLES;
}

/** Count of combinations beyond the previewed ones. */
export function getRemainingCombinationsCount(baseCombinations: number): number {
  return baseCombinations - MAX_PREVIEW_EXAMPLES;
}

/** A stage as consumed by the standalone matrix preview. */
export interface CartesianMatrixStage {
  label: string;
  options: string[];
}

/** Total combinations for the matrix preview (each empty stage counts as 1). */
export function computeMatrixCombinations(
  stages: readonly CartesianMatrixStage[],
): number {
  return stages.reduce(
    (acc, stage) => acc * Math.max(1, stage.options.length),
    1,
  );
}

/**
 * Filter the addable step options by a search query, grouped by step type.
 * Matches against option name and description (case-insensitive).
 */
export function getCartesianStepOptionGroups(
  searchQuery: string,
  getStepOptions: (type: StepType) => readonly StepOption[],
): StepOptionGroup[] {
  const query = searchQuery.toLowerCase();
  const result: StepOptionGroup[] = [];

  CARTESIAN_ADD_OPTION_TYPES.forEach((type) => {
    const options = getStepOptions(type).filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query),
    );
    if (options.length > 0) {
      result.push({ type, options: [...options] });
    }
  });

  return result;
}

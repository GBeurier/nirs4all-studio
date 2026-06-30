import type { StepColorScheme } from "./stepPresentation";
import type { PipelineStep, StepOption, StepType } from "./types";

export type SelectionMode = "none" | "pick" | "arrange";

export type SelectionValue = number | [number, number];

export interface SelectionConfig {
  mode: SelectionMode;
  value?: SelectionValue;
}

export interface SelectionModeLabel {
  label: string;
  description: string;
}

export interface StepOptionGroup {
  type: StepType;
  options: StepOption[];
}

export interface OrBranchReadModel {
  index: number;
  indexLabel: string;
  label: string;
  summary: string;
  isEmpty: boolean;
  canRemove: boolean;
}

export interface OrOptionState {
  indexLabel: string;
  branchLabel: string;
  summary: string;
  parameterCount: number;
  parameterSummary?: string;
  hasParameters: boolean;
  shouldShowParameters: boolean;
  expandToggleLabel: string;
  isDisabled: boolean;
}

export const MIN_OR_BRANCH_COUNT = 1;

export const OR_ADD_OPTION_TYPES = [
  "preprocessing",
  "model",
  "splitting",
] as const satisfies readonly StepType[];

export const selectionModeLabels: Record<SelectionMode, SelectionModeLabel> = {
  none: {
    label: "Try Each",
    description: "Test each option individually",
  },
  pick: {
    label: "Pick",
    description: "Choose options (combinations, order doesn't matter)",
  },
  arrange: {
    label: "Arrange",
    description: "Choose options (permutations, order matters)",
  },
};

export function isRange(
  value: SelectionValue | undefined,
): value is [number, number] {
  return Array.isArray(value) && value.length === 2;
}

export function getOrBranchIndexLabel(index: number): string {
  return String(index + 1);
}

export function getOrBranchLabel(index: number): string {
  return `Option ${index + 1}`;
}

export function getOrBranchSummary(
  branch: readonly PipelineStep[] | undefined,
): string {
  if (!branch || branch.length === 0) {
    return "Empty option";
  }

  const [firstStep] = branch;
  const firstName = firstStep?.name || "Unnamed step";
  if (branch.length === 1) {
    return firstName;
  }

  return `${firstName} + ${branch.length - 1} more`;
}

export function canRemoveOrBranch(branchCount: number): boolean {
  return branchCount > MIN_OR_BRANCH_COUNT;
}

export function getOrBranchReadModels(
  branches: readonly (readonly PipelineStep[])[] | undefined,
): OrBranchReadModel[] {
  const branchCount = branches?.length ?? 0;
  return (branches ?? []).map((branch, index) => ({
    index,
    indexLabel: getOrBranchIndexLabel(index),
    label: getOrBranchLabel(index),
    summary: getOrBranchSummary(branch),
    isEmpty: branch.length === 0,
    canRemove: canRemoveOrBranch(branchCount),
  }));
}

export function getOrCountLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function getOrVariantLabel(variantCount: number): string {
  return getOrCountLabel(variantCount, "variant");
}

export function getOrOptionCountLabel(optionCount: number): string {
  return getOrCountLabel(optionCount, "option");
}

export function getOrGeneratorSummary(
  optionCount: number,
  variantCount: number,
): string {
  return `${getOrOptionCountLabel(optionCount)} • ${getOrVariantLabel(variantCount)}`;
}

export function getOrSelectionActionLabel(mode: SelectionMode): string {
  return mode === "pick" ? "Pick" : "Arrange";
}

export function getOrSelectionKindLabel(mode: SelectionMode): string {
  return mode === "pick" ? "(combinations)" : "(permutations)";
}

export function getOrOptionParameterCount(option: PipelineStep): number {
  return Object.keys(option.params).length;
}

export function getOrOptionParameterSummary(
  option: PipelineStep,
): string | undefined {
  const parameterCount = getOrOptionParameterCount(option);
  return parameterCount > 0 ? `(${parameterCount} params)` : undefined;
}

export function isOrOptionDisabled(option: PipelineStep): boolean {
  return option.enabled === false;
}

export function getOrOptionSummary(option: PipelineStep): string {
  const parameterCount = getOrOptionParameterCount(option);
  if (parameterCount === 0) {
    return option.name;
  }

  return `${option.name} (${getOrCountLabel(parameterCount, "param")})`;
}

export function getOrOptionState(
  option: PipelineStep,
  index: number,
  isExpanded: boolean,
): OrOptionState {
  const parameterCount = getOrOptionParameterCount(option);
  return {
    indexLabel: getOrBranchIndexLabel(index),
    branchLabel: getOrBranchLabel(index),
    summary: getOrOptionSummary(option),
    parameterCount,
    parameterSummary: parameterCount > 0 ? `(${parameterCount} params)` : undefined,
    hasParameters: parameterCount > 0,
    shouldShowParameters: isExpanded && parameterCount > 0,
    expandToggleLabel: isExpanded ? "Collapse" : "Expand",
    isDisabled: isOrOptionDisabled(option),
  };
}

export function getOrOptionContainerClassNames(
  colors: StepColorScheme,
  isSelected: boolean,
): string[] {
  return [
    "group relative rounded-lg border transition-all",
    colors.border,
    colors.bg,
    isSelected ? colors.selected : colors.hover,
  ];
}

export function getOrDropZoneClassNames(isActive: boolean): string[] {
  return [
    "flex items-center justify-center p-4 rounded-lg border-2 border-dashed transition-all",
    isActive
      ? "border-orange-500 bg-orange-500/10"
      : "border-border/50 hover:border-orange-500/50 hover:bg-orange-500/5",
  ];
}

export function coerceOrSelectionCount(
  rawValue: string,
  optionCount: number,
  fallback: number,
): number {
  const nextValue = parseInt(rawValue, 10) || fallback;
  return Math.max(1, Math.min(optionCount, nextValue));
}

export function coerceOrSelectionRangeStart(rawValue: string): number {
  return Math.max(1, parseInt(rawValue, 10) || 1);
}

export function coerceOrSelectionRangeEnd(
  rawValue: string,
  start: number,
  optionCount: number,
): number {
  return Math.max(start, Math.min(optionCount, parseInt(rawValue, 10) || start));
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

function calculateVariantsForValue(
  optionCount: number,
  mode: "pick" | "arrange",
  value: SelectionValue,
): number {
  if (isRange(value)) {
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      total += mode === "pick"
        ? combinations(optionCount, k)
        : permutations(optionCount, k);
    }
    return total;
  }

  return mode === "pick"
    ? combinations(optionCount, value)
    : permutations(optionCount, value);
}

export function calculateOrVariants(
  optionCount: number,
  selection: SelectionConfig,
): number {
  switch (selection.mode) {
    case "none":
      return optionCount;
    case "pick":
      return calculateVariantsForValue(optionCount, "pick", selection.value || 1);
    case "arrange":
      return calculateVariantsForValue(
        optionCount,
        "arrange",
        selection.value || 1,
      );
    default:
      return optionCount;
  }
}

export function getFilteredStepOptionGroups(
  searchQuery: string,
  getStepOptions: (type: StepType) => readonly StepOption[],
): StepOptionGroup[] {
  const query = searchQuery.toLowerCase();
  const result: StepOptionGroup[] = [];

  OR_ADD_OPTION_TYPES.forEach((type) => {
    const options = getStepOptions(type).filter(
      (option) =>
        option.name.toLowerCase().includes(query) ||
        option.description.toLowerCase().includes(query),
    );
    if (options.length > 0) {
      result.push({ type, options });
    }
  });

  return result;
}

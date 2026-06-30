import type { TierLevel } from "./contexts/usePipelineEditorPreferences";
import type {
  StepOption,
  StepType,
} from "./types";

/**
 * Palette group key - superset of StepType, with the "model" group split into
 * two display-only buckets (regression vs classification). Drag-and-drop and
 * pipeline data still use the real StepType ("model").
 */
export type PaletteGroupKey = StepType | "model_regression" | "model_classification";

export interface PaletteOption {
  option: StepOption;
  actualType: StepType;
}

export interface PaletteAvailability {
  available: boolean;
  entry?: {
    error?: string | null;
  } | null;
  issue?: {
    details?: {
      error?: string | null;
    } | null;
  } | null;
}

export interface PaletteAvailabilityNode {
  id?: string;
  type: StepType;
  name: string;
  classPath?: string;
  functionPath?: string;
}

export interface PaletteNodeDefinition {
  id?: string;
  classPath?: string;
}

export interface PaletteNodeDefinitionReader {
  getNodeDefinition: (type: StepType, name: string) => PaletteNodeDefinition | undefined;
}

export interface PaletteAvailabilityReader {
  getNodeAvailability: (node: PaletteAvailabilityNode) => PaletteAvailability;
}

export interface PaletteAvailabilityDisplay {
  isUnavailable: boolean;
  unavailableReason?: string;
}

// Order of step types in the palette (most commonly used first)
export const stepTypeOrder: PaletteGroupKey[] = [
  "preprocessing",
  "splitting",
  "model_regression",
  "model_classification",
  "y_processing",
  "flow",
  "filter",
  "augmentation",
  "utility",
];

/** Group-level display labels (overrides stepTypeLabels for virtual groups). */
export const paletteGroupLabels: Partial<Record<PaletteGroupKey, string>> = {
  model_regression: "Regression Models",
  model_classification: "Classification Models",
};

/** Tier selector labels */
export const TIER_LABELS: Record<TierLevel, string> = {
  core: "Essential",
  standard: "Standard",
  all: "All",
};

/** Tier selector tooltips */
export const TIER_TOOLTIPS: Record<TierLevel, string> = {
  core: "Essential NIRS operators only",
  standard: "Standard operators (nirs4all + common sklearn)",
  all: "All operators including advanced and deep learning",
};

/** Keywords that mark a model option as classification-oriented. */
const CLASSIFIER_NAME_PATTERNS = [
  /classifier$/i,
  /classification$/i,
  /^svc$/i,
  /^nusvc$/i,
  /^linearsvc$/i,
  /^logisticregression(cv)?$/i,
  /da$/i,
  /discriminantanalysis$/i,
  /^(bernoulli|categorical|complement|gaussian|multinomial)nb$/i,
  /^nearestcentroid$/i,
  /^label(propagation|spreading)$/i,
];

/** Decide if a StepOption of type "model" is a classifier. */
export function isClassifierModel(option: StepOption): boolean {
  if (option.tags?.some((tag) => tag.toLowerCase() === "classification")) {
    return true;
  }

  const name = option.name || "";
  return CLASSIFIER_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Resolve a palette group key to the underlying StepType used for data lookup.
 * Both virtual model groups map to the real "model" step type.
 */
export function resolveStepType(key: PaletteGroupKey): StepType {
  if (key === "model_regression" || key === "model_classification") {
    return "model";
  }
  return key;
}

export function getPaletteGroupDisplayLabel(
  key: PaletteGroupKey,
  labels: Record<StepType, string>,
): string {
  return paletteGroupLabels[key] ?? labels[resolveStepType(key)];
}

export function getOptionsForPaletteGroup(
  key: PaletteGroupKey,
  getStepOptions: (type: StepType) => StepOption[],
): PaletteOption[] {
  const stepType = resolveStepType(key);
  const options = getStepOptions(stepType).map((option) => ({ option, actualType: stepType }));

  if (key === "model_regression") {
    return options.filter(({ option }) => !isClassifierModel(option));
  }
  if (key === "model_classification") {
    return options.filter(({ option }) => isClassifierModel(option));
  }
  return options;
}

export function buildPaletteAvailabilityNode(
  actualType: StepType,
  option: StepOption,
  nodeDef?: PaletteNodeDefinition,
): PaletteAvailabilityNode {
  return {
    id: nodeDef?.id,
    type: actualType,
    name: option.name,
    classPath: option.classPath ?? nodeDef?.classPath,
    functionPath: option.functionPath,
  };
}

export function getPaletteOptionAvailability({
  actualType,
  option,
  availability,
  registry,
}: {
  actualType: StepType;
  option: StepOption;
  availability?: PaletteAvailabilityReader | null;
  registry?: PaletteNodeDefinitionReader | null;
}): PaletteAvailability {
  if (!availability) {
    return { available: true };
  }
  const nodeDef = registry?.getNodeDefinition(actualType, option.name);
  return availability.getNodeAvailability(buildPaletteAvailabilityNode(actualType, option, nodeDef));
}

export function getPaletteAvailabilityDisplay(
  availability: PaletteAvailability,
): PaletteAvailabilityDisplay {
  const unavailableReason = availability.entry?.error ?? availability.issue?.details?.error ?? undefined;
  return {
    isUnavailable: !availability.available,
    unavailableReason,
  };
}

export function optionMatchesPaletteSearch(option: StepOption, search: string): boolean {
  const normalizedSearch = search.toLowerCase();
  return (
    option.name.toLowerCase().includes(normalizedSearch) ||
    option.description.toLowerCase().includes(normalizedSearch) ||
    (option.category?.toLowerCase().includes(normalizedSearch) ?? false)
  );
}

export function filterPaletteOptions(
  options: PaletteOption[],
  {
    search,
    showUnavailableOperators,
    hasAvailabilitySnapshot,
    getOptionAvailability,
  }: {
    search: string;
    showUnavailableOperators: boolean;
    hasAvailabilitySnapshot: boolean;
    getOptionAvailability: (actualType: StepType, option: StepOption) => PaletteAvailability;
  },
): PaletteOption[] {
  return options.filter(({ option, actualType }) => {
    const optionAvailability = getOptionAvailability(actualType, option);
    return (
      (showUnavailableOperators || !hasAvailabilitySnapshot || optionAvailability.available) &&
      optionMatchesPaletteSearch(option, search)
    );
  });
}

export function getMatchingPaletteSections(
  keys: PaletteGroupKey[],
  getFilteredOptions: (key: PaletteGroupKey) => PaletteOption[],
): Set<PaletteGroupKey> {
  const matchingSections = new Set<PaletteGroupKey>();
  keys.forEach((key) => {
    if (getFilteredOptions(key).length > 0) {
      matchingSections.add(key);
    }
  });
  return matchingSections;
}

export function groupPaletteOptionsByCategory(
  options: PaletteOption[],
): Map<string, PaletteOption[]> {
  const groupedMap = new Map<string, PaletteOption[]>();
  for (const item of options) {
    const categoryKey = item.option.category || "General";
    if (!groupedMap.has(categoryKey)) {
      groupedMap.set(categoryKey, []);
    }
    groupedMap.get(categoryKey)!.push(item);
  }
  return groupedMap;
}

export function shouldShowPaletteSubcategories({
  groupedOptions,
  search,
  optionCount,
  threshold,
}: {
  groupedOptions: Map<string, PaletteOption[]>;
  search: string;
  optionCount: number;
  threshold: number;
}): boolean {
  const hasCategories = groupedOptions.size > 1 || !groupedOptions.has("General");
  return hasCategories && !search && optionCount >= threshold;
}

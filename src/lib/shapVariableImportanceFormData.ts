import type { ExplainerType, Partition, ShapBaseline, ShapEngine, ShapSubset, ShapSubsetFilter } from '@/types/shap';

export interface ShapSelectOption<TValue extends string> {
  value: TValue;
  labelKey: string;
}

export const SHAP_PARTITION_OPTIONS: ShapSelectOption<Partition>[] = [
  { value: 'test', labelKey: 'results.variableImportance.partitionOptions.test' },
  { value: 'train', labelKey: 'results.variableImportance.partitionOptions.train' },
  { value: 'all', labelKey: 'results.variableImportance.partitionOptions.all' },
];

export const SHAP_EXPLAINER_OPTIONS: ShapSelectOption<ExplainerType>[] = [
  { value: 'auto', labelKey: 'results.variableImportance.explainerOptions.auto' },
  { value: 'tree', labelKey: 'results.variableImportance.explainerOptions.tree' },
  { value: 'linear', labelKey: 'results.variableImportance.explainerOptions.linear' },
  { value: 'kernel', labelKey: 'results.variableImportance.explainerOptions.kernel' },
];

/** The native engine (nirs4all-methods kernels, as in Web) adds model-agnostic explainers. */
export const SHAP_NATIVE_EXPLAINER_OPTIONS: ShapSelectOption<ExplainerType>[] = [
  { value: 'auto', labelKey: 'results.variableImportance.explainerOptions.auto' },
  { value: 'permutation', labelKey: 'shap.form.explainers.permutation' },
  { value: 'exact', labelKey: 'shap.form.explainers.exact' },
  { value: 'kernel', labelKey: 'results.variableImportance.explainerOptions.kernel' },
  { value: 'lime', labelKey: 'shap.form.explainers.lime' },
  { value: 'occlusion', labelKey: 'shap.form.explainers.occlusion' },
  { value: 'linear', labelKey: 'results.variableImportance.explainerOptions.linear' },
  { value: 'tree', labelKey: 'results.variableImportance.explainerOptions.tree' },
];

export const SHAP_ENGINE_OPTIONS: ShapSelectOption<ShapEngine>[] = [
  { value: 'python', labelKey: 'shap.form.engines.python' },
  { value: 'native', labelKey: 'shap.form.engines.native' },
];

export const SHAP_BASELINE_OPTIONS: ShapSelectOption<ShapBaseline>[] = [
  { value: 'background', labelKey: 'shap.form.baselines.background' },
  { value: 'mean', labelKey: 'shap.form.baselines.mean' },
];

/** Bounds enforced by the Studio backend for each numeric option. */
export const SHAP_LIMITS = {
  nSamples: { min: 1, max: 5000 },
  nBackground: { min: 10, max: 500 },
  groupWidth: { min: 1, max: 4096 },
  nPermutations: { min: 1, max: 1000 },
  seed: { min: 0, max: Number.MAX_SAFE_INTEGER },
} as const;

export interface ShapAnalysisOptions {
  engine: ShapEngine;
  explainerType: ExplainerType;
  /** Explained rows, reproducibly selected; null explains the whole partition. */
  nSamples: number | null;
  nBackground: number;
  /** Native engine only. */
  baseline: ShapBaseline;
  /** Native engine only; null keeps the engine default (20-feature groups for model-agnostic explainers on wide inputs). */
  groupWidth: number | null;
  /** Native permutation SHAP only; null keeps the engine default. */
  nPermutations: number | null;
  /** Native engine only. */
  seed: number;
  /** Optional metadata subsets; when enabled they replace the partition. */
  subsets: ShapSubsetOptions;
}

export interface ShapSubsetOptions {
  enabled: boolean;
  /** Candidate rows the SHAP engine draws its background from. */
  background: ShapSubset;
  /** Rows explained (up to the sample count). */
  explained: ShapSubset;
}

export const DEFAULT_SHAP_SUBSETS: ShapSubsetOptions = {
  enabled: false,
  background: { partition: 'all', filters: [] },
  explained: { partition: 'test', filters: [] },
};

export const DEFAULT_SHAP_OPTIONS: ShapAnalysisOptions = {
  engine: 'python',
  explainerType: 'auto',
  nSamples: 50,
  nBackground: 20,
  baseline: 'background',
  groupWidth: null,
  nPermutations: null,
  seed: 0,
  subsets: DEFAULT_SHAP_SUBSETS,
};

export function shapExplainerOptions(engine: ShapEngine): ShapSelectOption<ExplainerType>[] {
  return engine === 'native' ? SHAP_NATIVE_EXPLAINER_OPTIONS : SHAP_EXPLAINER_OPTIONS;
}

/** Explainers whose attributions do not sum to the prediction (no waterfall). */
export function isNonAdditiveExplainer(explainerType: ExplainerType): boolean {
  return explainerType === 'lime' || explainerType === 'occlusion';
}

/** Native explainers that take a perturbation baseline (path-dependent TreeSHAP does not). */
export function usesShapBaseline(options: ShapAnalysisOptions): boolean {
  return options.engine === 'native' && options.explainerType !== 'tree';
}

/** Native explainers that take a permutation count. */
export function usesShapPermutations(options: ShapAnalysisOptions): boolean {
  return options.engine === 'native' && (options.explainerType === 'auto' || options.explainerType === 'permutation');
}

function boundedInteger(value: unknown, limits: { min: number; max: number }): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= limits.min && value <= limits.max ? value : null;
}

/**
 * Valid options from a partial or restored value: unknown values return to
 * their defaults and an explainer the engine lacks returns to Auto.
 */
export function normalizeShapOptions(value: unknown): ShapAnalysisOptions {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const engine = SHAP_ENGINE_OPTIONS.some((option) => option.value === input.engine) ? input.engine as ShapEngine : DEFAULT_SHAP_OPTIONS.engine;
  const explainerType = shapExplainerOptions(engine).some((option) => option.value === input.explainerType)
    ? input.explainerType as ExplainerType
    : DEFAULT_SHAP_OPTIONS.explainerType;
  return {
    engine,
    explainerType,
    nSamples: input.nSamples === null ? null : boundedInteger(input.nSamples, SHAP_LIMITS.nSamples) ?? DEFAULT_SHAP_OPTIONS.nSamples,
    nBackground: boundedInteger(input.nBackground, SHAP_LIMITS.nBackground) ?? DEFAULT_SHAP_OPTIONS.nBackground,
    baseline: SHAP_BASELINE_OPTIONS.some((option) => option.value === input.baseline) ? input.baseline as ShapBaseline : DEFAULT_SHAP_OPTIONS.baseline,
    groupWidth: boundedInteger(input.groupWidth, SHAP_LIMITS.groupWidth),
    nPermutations: boundedInteger(input.nPermutations, SHAP_LIMITS.nPermutations),
    seed: boundedInteger(input.seed, SHAP_LIMITS.seed) ?? DEFAULT_SHAP_OPTIONS.seed,
    subsets: normalizeShapSubsets(input.subsets),
  };
}

function isScalar(value: unknown): value is ShapSubsetFilter['values'][number] {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function normalizeShapSubset(value: unknown, fallback: ShapSubset): ShapSubset {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  const filters = Array.isArray(input.filters) ? input.filters : [];
  return {
    partition: SHAP_PARTITION_OPTIONS.some((option) => option.value === input.partition) ? input.partition as Partition : fallback.partition,
    filters: filters.flatMap((filter): ShapSubsetFilter[] => {
      const item = typeof filter === 'object' && filter !== null ? filter as Record<string, unknown> : {};
      return typeof item.column === 'string' && Array.isArray(item.values)
        ? [{ column: item.column, values: item.values.filter(isScalar) }]
        : [];
    }),
  };
}

export function normalizeShapSubsets(value: unknown): ShapSubsetOptions {
  const input = typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
  return {
    enabled: input.enabled === true,
    background: normalizeShapSubset(input.background, DEFAULT_SHAP_SUBSETS.background),
    explained: normalizeShapSubset(input.explained, DEFAULT_SHAP_SUBSETS.explained),
  };
}

/** The subset sent to the backend: filters without a column or a selected value are ignored. */
export function activeShapSubset(subset: ShapSubset): ShapSubset {
  return { partition: subset.partition, filters: subset.filters.filter((filter) => filter.column && filter.values.length > 0) };
}

export function normalizeShapPartition(value: string): Partition {
  return isShapPartition(value) ? value : 'test';
}

export function normalizeShapExplainerType(value: string): ExplainerType {
  return isShapExplainerType(value) ? value : 'auto';
}

export function isShapPlsModel(modelClass: string | null): boolean {
  const name = modelClass?.split('.').pop();
  return name === 'PLSRegression' || name === 'PLS';
}

export function buildShapPredictHref(chainId: string): string {
  return `/predict?model_id=${encodeURIComponent(chainId)}&source=chain`;
}

function isShapPartition(value: string): value is Partition {
  return SHAP_PARTITION_OPTIONS.some((option) => option.value === value);
}

function isShapExplainerType(value: string): value is ExplainerType {
  return SHAP_EXPLAINER_OPTIONS.some((option) => option.value === value);
}

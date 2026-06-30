/**
 * Y-Processing Panel Data
 *
 * Pure helpers and data projections for target (Y) processing configuration.
 * No React / no DOM here — everything in this module is referentially
 * transparent so it can be unit-tested in isolation and reused as the
 * target-processing surface grows richer (multitarget / dag-ml / pipelines).
 *
 * The visual layer lives in `YProcessingPanelSections.tsx`; orchestration and
 * callbacks live in `YProcessingPanel.tsx`.
 */

import {
  Y_PROCESSING_OPTIONS,
  type YProcessingConfig,
} from "./yProcessingConfig";

export type YProcessingOption = (typeof Y_PROCESSING_OPTIONS)[number];

/** Display/category order for the scaler selector. */
export const Y_PROCESSING_CATEGORY_ORDER = [
  "Scaling",
  "Transform",
  "Discretization",
] as const;

export type YProcessingCategory = (typeof Y_PROCESSING_CATEGORY_ORDER)[number];

/** A single choice in a param-specific select control. */
export interface YProcessingSelectChoice {
  value: string;
  label: string;
}

/**
 * Param keys that render as a fixed-choice select rather than a free input,
 * keyed by param name. Drives both the rendered options and the wheel-scroll
 * cycle order, so the two never drift apart.
 */
export const Y_PROCESSING_PARAM_SELECTS: Record<string, YProcessingSelectChoice[]> = {
  method: [
    { value: "yeo-johnson", label: "Yeo-Johnson" },
    { value: "box-cox", label: "Box-Cox (positive only)" },
  ],
  output_distribution: [
    { value: "uniform", label: "Uniform [0, 1]" },
    { value: "normal", label: "Normal (Gaussian)" },
  ],
  strategy: [
    { value: "quantile", label: "Quantile (equal frequencies)" },
    { value: "uniform", label: "Uniform (equal width)" },
    { value: "kmeans", label: "K-Means clustering" },
  ],
};

/** Find the option descriptor for a scaler name, if any. */
export function findYProcessingOption(scaler: string | undefined): YProcessingOption | undefined {
  if (!scaler) return undefined;
  return Y_PROCESSING_OPTIONS.find((opt) => opt.name === scaler);
}

/**
 * Safely materialize an option's default params as a plain record, dropping
 * any `undefined` entries so callers always get concrete values.
 */
export function getYProcessingDefaultParams(
  option: YProcessingOption | undefined,
): Record<string, unknown> {
  if (!option) return {};
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(option.defaultParams)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** Human-readable description for a single param key, if defined. */
export function getYProcessingParamDescription(
  option: YProcessingOption | undefined,
  key: string,
): string | undefined {
  if (!option) return undefined;
  return (option.paramDescriptions as Record<string, string>)[key];
}

/** Options grouped by category, in display order, skipping empty groups. */
export function groupYProcessingOptionsByCategory(): Array<{
  category: YProcessingCategory;
  options: YProcessingOption[];
}> {
  return Y_PROCESSING_CATEGORY_ORDER.map((category) => ({
    category,
    options: Y_PROCESSING_OPTIONS.filter((opt) => opt.category === category),
  })).filter((group) => group.options.length > 0);
}

/** Fixed-choice select definition for a param key, or `undefined` for a free input. */
export function getYProcessingParamSelect(key: string): YProcessingSelectChoice[] | undefined {
  return Y_PROCESSING_PARAM_SELECTS[key];
}

/** Numeric step for a param input: fine for sub-unit defaults, coarse otherwise. */
export function getYProcessingParamInputStep(defaultValue: unknown): number {
  return typeof defaultValue === "number" && defaultValue < 1 ? 0.01 : 1;
}

/**
 * Coerce a raw `<input>` string back into the param's value type, inferred
 * from its default value. Numbers fall back to 0 on parse failure.
 */
export function coerceYProcessingParamValue(defaultValue: unknown, raw: string): unknown {
  if (typeof defaultValue === "number") {
    return parseFloat(raw) || 0;
  }
  return raw;
}

/** Recommended scaler for a model type — MinMax for DL, Standard otherwise. */
export function getRecommendedScaler(modelType?: string): string {
  if (!modelType) return "MinMaxScaler";
  const dlModels = ["nicon", "CNN1D", "MLP", "LSTM", "Transformer"];
  if (dlModels.includes(modelType)) return "MinMaxScaler";
  return "StandardScaler";
}

// --- Config patch helpers -------------------------------------------------
// Each returns a new config; none mutate the input.

/** Toggle the enabled flag. */
export function setYProcessingEnabled(
  config: YProcessingConfig,
  enabled: boolean,
): YProcessingConfig {
  return { ...config, enabled };
}

/** Switch the scaler, resetting params to that scaler's defaults. */
export function setYProcessingScaler(
  config: YProcessingConfig,
  scaler: string,
): YProcessingConfig {
  return {
    ...config,
    scaler,
    params: getYProcessingDefaultParams(findYProcessingOption(scaler)),
  };
}

/** Set a single param value. */
export function setYProcessingParam(
  config: YProcessingConfig,
  key: string,
  value: unknown,
): YProcessingConfig {
  return { ...config, params: { ...config.params, [key]: value } };
}

/** Reset params to the current scaler's defaults (no-op if scaler unknown). */
export function resetYProcessingParams(config: YProcessingConfig): YProcessingConfig {
  const option = findYProcessingOption(config.scaler);
  if (!option) return config;
  return { ...config, params: getYProcessingDefaultParams(option) };
}

/** Build a freshly-enabled config for a recommended scaler. */
export function buildYProcessingQuickSetup(scaler: string): YProcessingConfig {
  return {
    enabled: true,
    scaler,
    params: getYProcessingDefaultParams(findYProcessingOption(scaler)),
  };
}

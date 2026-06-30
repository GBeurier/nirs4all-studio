/**
 * Pure helpers for merge step configuration.
 *
 * Keep the state derivation and payload parsing outside React components so the
 * renderer stays focused on wiring UI events to updates.
 */

import type { MergeConfig, MergePredictionSource } from "../../types";

export const DEFAULT_PREDICTION_SOURCE: MergePredictionSource = {
  branch: 0,
  select: "best",
};

export function createDefaultPredictionSource(): MergePredictionSource {
  return { ...DEFAULT_PREDICTION_SOURCE };
}

export interface MergeSourceState {
  predictionsEnabled: boolean;
  featuresEnabled: boolean;
  advancedConfigCount: number;
  hasAdvancedConfig: boolean;
}

export type StructuredSourcesDraftResult =
  | { status: "empty" }
  | { status: "invalid" }
  | { status: "valid"; value: unknown };

export function formatStructuredSourcesDraft(sources: unknown): string {
  if (sources === undefined) {
    return "";
  }
  return JSON.stringify(sources, null, 2) ?? "";
}

export function getFallbackMergeMode(config: MergeConfig): string {
  const hasPredictions = (config.predictions?.length ?? 0) > 0;
  const hasFeatures = (config.features?.length ?? 0) > 0;

  if (hasPredictions && hasFeatures) {
    return "custom";
  }
  if (hasFeatures) {
    return "features";
  }
  return "predictions";
}

export function getMergeSourceState(config: MergeConfig): MergeSourceState {
  const predictionCount = config.predictions?.length ?? 0;
  const featureCount = config.features?.length ?? 0;
  const hasSourcesPayload = config.sources !== undefined;

  const predictionsEnabled =
    predictionCount > 0 ||
    config.mode === "predictions" ||
    config.mode === "custom";
  const featuresEnabled =
    featureCount > 0 || config.mode === "features" || config.mode === "custom";
  const advancedConfigCount =
    predictionCount + featureCount + (hasSourcesPayload ? 1 : 0);

  return {
    predictionsEnabled,
    featuresEnabled,
    advancedConfigCount,
    hasAdvancedConfig: advancedConfigCount > 0,
  };
}

export function togglePredictionSourcesInConfig(config: MergeConfig): MergeConfig {
  const { predictionsEnabled, featuresEnabled } = getMergeSourceState(config);

  if (predictionsEnabled) {
    return {
      ...config,
      predictions: [],
      mode: featuresEnabled ? "features" : "predictions",
    };
  }

  return {
    ...config,
    predictions: [createDefaultPredictionSource()],
    mode: featuresEnabled ? "custom" : "predictions",
  };
}

export function toggleFeatureSourcesInConfig(config: MergeConfig): MergeConfig {
  const { featuresEnabled, predictionsEnabled } = getMergeSourceState(config);

  if (featuresEnabled) {
    return {
      ...config,
      features: [],
      mode: "predictions",
    };
  }

  return {
    ...config,
    features: [0],
    mode: predictionsEnabled ? "custom" : "features",
  };
}

export function clearStructuredSources(config: MergeConfig): MergeConfig {
  return {
    ...config,
    mode: getFallbackMergeMode(config),
    sources: undefined,
  };
}

export function parseStructuredSourcesDraft(draft: string): StructuredSourcesDraftResult {
  const trimmed = draft.trim();

  if (!trimmed) {
    return { status: "empty" };
  }

  if (
    trimmed.startsWith("{") ||
    trimmed.startsWith("[") ||
    trimmed.startsWith("\"")
  ) {
    try {
      return { status: "valid", value: JSON.parse(trimmed) };
    } catch {
      return { status: "invalid" };
    }
  }

  return { status: "valid", value: trimmed };
}

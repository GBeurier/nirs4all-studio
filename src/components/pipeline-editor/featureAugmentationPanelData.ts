import type {
  FeatureAugmentationAction,
  FeatureAugmentationConfig,
  FeatureAugmentationTransform,
} from "./featureAugmentationConfig";
import type { StepOption } from "./types";

export interface FeatureAugmentationActionDetails {
  label: string;
  description: string;
  detail: string;
  example: string;
}

export const FEATURE_AUGMENTATION_ACTION_DETAILS: Record<
  FeatureAugmentationAction,
  FeatureAugmentationActionDetails
> = {
  extend: {
    label: "Extend",
    description: "Add each transform as an independent channel",
    detail:
      "Each transform creates a new feature set. Original data + N transforms = N+1 channels.",
    example: "Input → [Original, SNV, FirstDeriv] → Model",
  },
  add: {
    label: "Add",
    description: "Chain transforms, keep originals",
    detail:
      "Apply transforms sequentially on top of existing processing, keeping original features.",
    example: "Input → [Original, Original+SNV, Original+SNV+Deriv] → Model",
  },
  replace: {
    label: "Replace",
    description: "Chain transforms, discard originals",
    detail:
      "Apply transforms sequentially, only keeping the final processed version.",
    example: "Input → [SNV+Deriv only] → Model",
  },
};

export interface FeatureAugmentationPresetTransform {
  name: string;
  params: Readonly<Record<string, unknown>>;
}

export interface FeatureAugmentationPreset {
  name: string;
  description: string;
  transforms: readonly FeatureAugmentationPresetTransform[];
}

export const AUGMENTATION_PRESETS = [
  {
    name: "NIRS Standard",
    description: "SNV + First Derivative + Second Derivative",
    transforms: [
      { name: "SNV", params: {} },
      { name: "FirstDerivative", params: {} },
      { name: "SecondDerivative", params: {} },
    ],
  },
  {
    name: "Scatter Variants",
    description: "Compare scatter correction methods",
    transforms: [
      { name: "SNV", params: {} },
      { name: "MSC", params: { reference: "mean" } },
      { name: "RobustSNV", params: {} },
    ],
  },
  {
    name: "Derivative Comparison",
    description: "Different derivative approaches",
    transforms: [
      { name: "FirstDerivative", params: {} },
      {
        name: "SavitzkyGolay",
        params: { window_length: 11, polyorder: 2, deriv: 1 },
      },
      {
        name: "SavitzkyGolay",
        params: { window_length: 21, polyorder: 3, deriv: 1 },
      },
    ],
  },
  {
    name: "Smoothing Levels",
    description: "Compare different smoothing intensities",
    transforms: [
      {
        name: "SavitzkyGolay",
        params: { window_length: 7, polyorder: 2, deriv: 0 },
      },
      {
        name: "SavitzkyGolay",
        params: { window_length: 15, polyorder: 2, deriv: 0 },
      },
      { name: "Gaussian", params: { sigma: 2 } },
    ],
  },
] as const satisfies readonly FeatureAugmentationPreset[];

export type FeatureAugmentationIdFactory = () => string;

export function cleanFeatureAugmentationParams(
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const cleanParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      cleanParams[key] = value;
    }
  }
  return cleanParams;
}

export function createFeatureAugmentationTransform(
  name: string,
  params: Readonly<Record<string, unknown>>,
  createId: FeatureAugmentationIdFactory,
): FeatureAugmentationTransform {
  return {
    id: createId(),
    name,
    params: cleanFeatureAugmentationParams(params),
    enabled: true,
  };
}

export function setFeatureAugmentationEnabled(
  config: FeatureAugmentationConfig,
  enabled: boolean,
): FeatureAugmentationConfig {
  return { ...config, enabled };
}

export function setFeatureAugmentationAction(
  config: FeatureAugmentationConfig,
  action: FeatureAugmentationAction,
): FeatureAugmentationConfig {
  return { ...config, action };
}

export function appendFeatureAugmentationTransform(
  config: FeatureAugmentationConfig,
  name: string,
  params: Readonly<Record<string, unknown>>,
  createId: FeatureAugmentationIdFactory,
): FeatureAugmentationConfig {
  return {
    ...config,
    transforms: [
      ...config.transforms,
      createFeatureAugmentationTransform(name, params, createId),
    ],
  };
}

export function removeFeatureAugmentationTransform(
  config: FeatureAugmentationConfig,
  id: string,
): FeatureAugmentationConfig {
  return {
    ...config,
    transforms: config.transforms.filter((transform) => transform.id !== id),
  };
}

export function toggleFeatureAugmentationTransform(
  config: FeatureAugmentationConfig,
  id: string,
  enabled: boolean,
): FeatureAugmentationConfig {
  return {
    ...config,
    transforms: config.transforms.map((transform) =>
      transform.id === id ? { ...transform, enabled } : transform,
    ),
  };
}

export function updateFeatureAugmentationTransformParams(
  config: FeatureAugmentationConfig,
  id: string,
  params: Readonly<Record<string, unknown>>,
): FeatureAugmentationConfig {
  return {
    ...config,
    transforms: config.transforms.map((transform) =>
      transform.id === id
        ? { ...transform, params: cleanFeatureAugmentationParams(params) }
        : transform,
    ),
  };
}

export function applyFeatureAugmentationPreset(
  config: FeatureAugmentationConfig,
  preset: FeatureAugmentationPreset,
  createId: FeatureAugmentationIdFactory,
): FeatureAugmentationConfig {
  return {
    ...config,
    enabled: true,
    transforms: preset.transforms.map((transform) =>
      createFeatureAugmentationTransform(
        transform.name,
        transform.params,
        createId,
      ),
    ),
  };
}

export function clearFeatureAugmentationTransforms(
  config: FeatureAugmentationConfig,
): FeatureAugmentationConfig {
  return { ...config, transforms: [] };
}

export function getActiveFeatureAugmentationTransforms(
  config: FeatureAugmentationConfig,
): FeatureAugmentationTransform[] {
  return config.transforms.filter((transform) => transform.enabled);
}

export interface FeatureAugmentationOutputPreview {
  channels: number;
  description: string;
}

export function getFeatureAugmentationOutputPreview(
  action: FeatureAugmentationAction,
  transforms: readonly FeatureAugmentationTransform[],
): FeatureAugmentationOutputPreview {
  const n = transforms.length;
  if (n === 0) {
    return { channels: 1, description: "No transforms - original only" };
  }

  switch (action) {
    case "extend":
      return {
        channels: n + 1,
        description: `Original + ${n} transform${
          n !== 1 ? "s" : ""
        } = ${n + 1} channels`,
      };
    case "add":
      return {
        channels: n + 1,
        description: `Cumulative: Original, +T1, +T1+T2, ... = ${
          n + 1
        } channels`,
      };
    case "replace":
      return {
        channels: 1,
        description: `Sequential processing: T1 → T2 → ... → T${n}`,
      };
  }
}

export function formatFeatureAugmentationParamsPreview(
  params: Readonly<Record<string, unknown>>,
  maxEntries = 2,
): string {
  return Object.entries(params)
    .slice(0, maxEntries)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

export function coerceFeatureAugmentationParamValue(
  currentValue: unknown,
  rawValue: string,
): unknown {
  if (typeof currentValue === "number") {
    return parseFloat(rawValue) || 0;
  }
  return rawValue;
}

export interface StepOptionsByCategory {
  category: string;
  options: StepOption[];
}

export function groupStepOptionsByCategory(
  options: readonly StepOption[],
): StepOptionsByCategory[] {
  const categories = Array.from(
    new Set(options.map((option) => option.category || "Other")),
  );
  return categories.map((category) => ({
    category,
    options: options.filter(
      (option) => (option.category || "Other") === category,
    ),
  }));
}

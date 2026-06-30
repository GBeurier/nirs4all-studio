import type {
  CategoricalPalette,
  ContinuousPalette,
} from "@/lib/playground/colorConfig";
import {
  getConfusionGradientColors,
  getPartitionPaletteColors,
  isConfusionGradientPresetId,
  isPartitionPalettePreset,
  normalizeColorToHex,
} from "./palettes";
import type {
  ChartConfig,
  ViewerGradientColors,
  ViewerMetadataType,
  ViewerPartitionColors,
} from "./types";

export const CATEGORICAL_PALETTE_OPTIONS = [
  "default",
  "tableau10",
  "set1",
  "set2",
  "paired",
] as const satisfies readonly CategoricalPalette[];

export const CONTINUOUS_PALETTE_OPTIONS = [
  "blue_red",
  "viridis",
  "plasma",
  "inferno",
  "coolwarm",
  "spectral",
  "cividis",
  "winter",
  "blues",
  "greens",
  "turbo",
] as const satisfies readonly ContinuousPalette[];

export interface ChartConfigMetadataReadModel {
  hasMetadata: boolean;
  effectiveMetadataKey: string | undefined;
  effectiveMetadataType: ViewerMetadataType;
}

export type PartitionColorKey = keyof ViewerPartitionColors;
export type ConfusionGradientColorKey = keyof ViewerGradientColors;

export function resolveChartConfigMetadata(
  config: Pick<ChartConfig, "metadataKey">,
  metadataColumns: readonly string[],
  resolvedMetadataType: ViewerMetadataType | null,
): ChartConfigMetadataReadModel {
  const effectiveMetadataKey = config.metadataKey && metadataColumns.includes(config.metadataKey)
    ? config.metadataKey
    : metadataColumns[0];

  return {
    hasMetadata: metadataColumns.length > 0,
    effectiveMetadataKey,
    effectiveMetadataType: resolvedMetadataType ?? "categorical",
  };
}

export function getCurrentPartitionPaletteColors(
  config: Pick<ChartConfig, "partitionColors">,
): readonly [string, string, string] {
  return [
    config.partitionColors.train,
    config.partitionColors.val,
    config.partitionColors.test,
  ] as const;
}

export function applyChartConfigPartitionPalette(
  config: ChartConfig,
  value: string,
): ChartConfig {
  if (!isPartitionPalettePreset(value)) {
    return {
      ...config,
      palette: "custom",
    };
  }

  return {
    ...config,
    palette: value,
    partitionColors: getPartitionPaletteColors(value),
  };
}

export function applyChartConfigPartitionColorChange(
  config: ChartConfig,
  key: PartitionColorKey,
  value: string,
): ChartConfig {
  return {
    ...config,
    palette: "custom",
    partitionColors: {
      ...config.partitionColors,
      [key]: normalizeColorToHex(value, config.partitionColors[key]),
    },
  };
}

export function applyChartConfigColorModeChange(
  config: ChartConfig,
  value: string,
  metadataColumns: readonly string[],
): ChartConfig {
  const nextMode = value === "metadata" ? "metadata" : "partition";
  const nextMetadataKey = nextMode === "metadata"
    ? (
        config.metadataKey && metadataColumns.includes(config.metadataKey)
          ? config.metadataKey
          : metadataColumns[0]
      )
    : config.metadataKey;

  return {
    ...config,
    colorMode: nextMode,
    metadataKey: nextMetadataKey,
    metadataType: nextMode === "metadata" ? undefined : config.metadataType,
  };
}

export function applyChartConfigMetadataKeyChange(
  config: ChartConfig,
  value: string,
): ChartConfig {
  return {
    ...config,
    metadataKey: value,
    metadataType: undefined,
  };
}

export function applyChartConfigConfusionGradientPreset(
  config: ChartConfig,
  value: string,
): ChartConfig {
  if (!isConfusionGradientPresetId(value)) {
    return {
      ...config,
      confusionGradientPreset: "custom",
    };
  }

  return {
    ...config,
    confusionGradientPreset: value,
    confusionGradient: getConfusionGradientColors(value),
  };
}

export function applyChartConfigConfusionGradientColorChange(
  config: ChartConfig,
  key: ConfusionGradientColorKey,
  value: string,
): ChartConfig {
  return {
    ...config,
    confusionGradientPreset: "custom",
    confusionGradient: {
      ...config.confusionGradient,
      [key]: normalizeColorToHex(value, config.confusionGradient[key]),
    },
  };
}

import { describe, expect, it } from "vitest";

import { getConfusionGradientColors, getPartitionPaletteColors } from "../palettes";
import { DEFAULT_CHART_CONFIG, type ChartConfig } from "../types";
import {
  applyChartConfigColorModeChange,
  applyChartConfigConfusionGradientColorChange,
  applyChartConfigConfusionGradientPreset,
  applyChartConfigMetadataKeyChange,
  applyChartConfigPartitionColorChange,
  applyChartConfigPartitionPalette,
  getCurrentPartitionPaletteColors,
  resolveChartConfigMetadata,
} from "../ChartConfigPopoverData";

function makeConfig(overrides: Partial<ChartConfig> = {}): ChartConfig {
  return {
    ...DEFAULT_CHART_CONFIG,
    partitionColors: { ...DEFAULT_CHART_CONFIG.partitionColors },
    confusionGradient: { ...DEFAULT_CHART_CONFIG.confusionGradient },
    ...overrides,
  };
}

describe("ChartConfigPopoverData", () => {
  it("resolves metadata fallback key and type for the popover read model", () => {
    expect(
      resolveChartConfigMetadata(
        makeConfig({ metadataKey: "missing" }),
        ["batch", "instrument"],
        null,
      ),
    ).toEqual({
      hasMetadata: true,
      effectiveMetadataKey: "batch",
      effectiveMetadataType: "categorical",
    });

    expect(
      resolveChartConfigMetadata(
        makeConfig({ metadataKey: "instrument" }),
        ["batch", "instrument"],
        "continuous",
      ),
    ).toEqual({
      hasMetadata: true,
      effectiveMetadataKey: "instrument",
      effectiveMetadataType: "continuous",
    });

    expect(resolveChartConfigMetadata(makeConfig(), [], null)).toEqual({
      hasMetadata: false,
      effectiveMetadataKey: undefined,
      effectiveMetadataType: "categorical",
    });
  });

  it("applies partition palette presets and keeps custom colors for custom selection", () => {
    const config = makeConfig({
      partitionColors: {
        train: "#101010",
        val: "#202020",
        test: "#303030",
      },
    });

    const preset = applyChartConfigPartitionPalette(config, "set2");
    expect(preset.palette).toBe("set2");
    expect(preset.partitionColors).toEqual(getPartitionPaletteColors("set2"));

    const custom = applyChartConfigPartitionPalette(config, "custom");
    expect(custom.palette).toBe("custom");
    expect(custom.partitionColors).toEqual(config.partitionColors);
    expect(getCurrentPartitionPaletteColors(custom)).toEqual(["#101010", "#202020", "#303030"]);
  });

  it("normalizes editable partition colors and falls back to the prior color", () => {
    const config = makeConfig({
      palette: "set1",
      partitionColors: {
        train: "#123456",
        val: "#abcdef",
        test: "#654321",
      },
    });

    const normalized = applyChartConfigPartitionColorChange(config, "train", "#abc");
    expect(normalized.palette).toBe("custom");
    expect(normalized.partitionColors.train).toBe("#aabbcc");
    expect(config.partitionColors.train).toBe("#123456");

    const fallback = applyChartConfigPartitionColorChange(config, "val", "not-a-color");
    expect(fallback.partitionColors.val).toBe("#abcdef");
  });

  it("handles color-mode transitions without storing stale metadata type", () => {
    const metadataConfig = applyChartConfigColorModeChange(
      makeConfig({
        colorMode: "partition",
        metadataKey: "missing",
        metadataType: "continuous",
      }),
      "metadata",
      ["batch", "instrument"],
    );

    expect(metadataConfig.colorMode).toBe("metadata");
    expect(metadataConfig.metadataKey).toBe("batch");
    expect(metadataConfig.metadataType).toBeUndefined();

    const sameMetadataKey = applyChartConfigColorModeChange(
      makeConfig({ metadataKey: "instrument", metadataType: "continuous" }),
      "metadata",
      ["batch", "instrument"],
    );
    expect(sameMetadataKey.metadataKey).toBe("instrument");
    expect(sameMetadataKey.metadataType).toBeUndefined();

    const partitionConfig = applyChartConfigColorModeChange(
      makeConfig({
        colorMode: "metadata",
        metadataKey: "batch",
        metadataType: "categorical",
      }),
      "partition",
      ["batch"],
    );
    expect(partitionConfig.colorMode).toBe("partition");
    expect(partitionConfig.metadataKey).toBe("batch");
    expect(partitionConfig.metadataType).toBe("categorical");
  });

  it("clears cached metadata type when the metadata key changes", () => {
    const updated = applyChartConfigMetadataKeyChange(
      makeConfig({
        metadataKey: "batch",
        metadataType: "continuous",
      }),
      "instrument",
    );

    expect(updated.metadataKey).toBe("instrument");
    expect(updated.metadataType).toBeUndefined();
  });

  it("applies confusion gradient presets and preserves gradient colors for custom selection", () => {
    const config = makeConfig({
      confusionGradientPreset: "ocean",
      confusionGradient: { low: "#101010", high: "#fefefe" },
    });

    const preset = applyChartConfigConfusionGradientPreset(config, "ember");
    expect(preset.confusionGradientPreset).toBe("ember");
    expect(preset.confusionGradient).toEqual(getConfusionGradientColors("ember"));

    const custom = applyChartConfigConfusionGradientPreset(config, "custom");
    expect(custom.confusionGradientPreset).toBe("custom");
    expect(custom.confusionGradient).toEqual(config.confusionGradient);
  });

  it("normalizes editable confusion gradient colors and falls back to the prior stop", () => {
    const config = makeConfig({
      confusionGradientPreset: "lagoon",
      confusionGradient: { low: "#112233", high: "#445566" },
    });

    const normalized = applyChartConfigConfusionGradientColorChange(
      config,
      "low",
      "hsl(0, 100%, 50%)",
    );
    expect(normalized.confusionGradientPreset).toBe("custom");
    expect(normalized.confusionGradient.low).toBe("#ff0000");
    expect(config.confusionGradient.low).toBe("#112233");

    const fallback = applyChartConfigConfusionGradientColorChange(config, "high", "invalid");
    expect(fallback.confusionGradient.high).toBe("#445566");
  });
});

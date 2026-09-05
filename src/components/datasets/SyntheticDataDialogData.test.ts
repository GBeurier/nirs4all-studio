import { describe, expect, it } from "vitest";

import {
  applyPresetToConfig,
  coerceIntInput,
  createInitialSyntheticConfig,
  getGenerationErrorMessage,
  isClassificationTask,
  isGenerateDisabled,
  presetClassCount,
} from "./SyntheticDataDialogData";
import type { SyntheticPreset } from "@/types/settings";
import { DEFAULT_SYNTHETIC_CONFIG } from "@/types/settings";

function createPreset(overrides: Partial<SyntheticPreset> = {}): SyntheticPreset {
  return {
    id: "preset-1",
    name: "Quick Regression",
    description: "Fast regression dataset",
    task_type: "regression",
    n_samples: 250,
    complexity: "simple",
    icon: "activity",
    ...overrides,
  };
}

describe("createInitialSyntheticConfig", () => {
  it("matches the default config values", () => {
    expect(createInitialSyntheticConfig()).toEqual(DEFAULT_SYNTHETIC_CONFIG);
  });

  it("returns an independent copy that does not mutate the default", () => {
    const config = createInitialSyntheticConfig();
    config.n_samples = 9999;

    expect(createInitialSyntheticConfig().n_samples).toBe(
      DEFAULT_SYNTHETIC_CONFIG.n_samples,
    );
    expect(config).not.toBe(DEFAULT_SYNTHETIC_CONFIG);
  });
});

describe("isClassificationTask", () => {
  it("is false for regression", () => {
    expect(isClassificationTask("regression")).toBe(false);
  });

  it("is true for binary and multiclass classification", () => {
    expect(isClassificationTask("binary_classification")).toBe(true);
    expect(isClassificationTask("multiclass_classification")).toBe(true);
  });
});

describe("presetClassCount", () => {
  it("uses three classes for multiclass presets", () => {
    expect(presetClassCount("multiclass_classification")).toBe(3);
  });

  it("uses two classes for binary and no class field for regression presets", () => {
    expect(presetClassCount("binary_classification")).toBe(2);
    expect(presetClassCount("regression")).toBeUndefined();
  });
});

describe("applyPresetToConfig", () => {
  it("patches task fields and applies the class-count policy", () => {
    const config = createInitialSyntheticConfig();
    const result = applyPresetToConfig(
      config,
      createPreset({
        task_type: "multiclass_classification",
        n_samples: 1200,
        complexity: "complex",
      }),
    );

    expect(result).toMatchObject({
      task_type: "multiclass_classification",
      n_samples: 1200,
      complexity: "complex",
      n_classes: 3,
    });
  });

  it("sets two classes for non-multiclass presets", () => {
    const result = applyPresetToConfig(
      createInitialSyntheticConfig(),
      createPreset({ task_type: "binary_classification" }),
    );

    expect(result.n_classes).toBe(2);
  });

  it("preserves unrelated fields and does not mutate the input", () => {
    const config = createInitialSyntheticConfig();
    config.name = "keep-me";
    config.auto_link = false;

    const result = applyPresetToConfig(config, createPreset());

    expect(result.name).toBe("keep-me");
    expect(result.auto_link).toBe(false);
    expect(result).not.toBe(config);
    // input untouched
    expect(config.task_type).toBe(DEFAULT_SYNTHETIC_CONFIG.task_type);
  });
});

describe("coerceIntInput", () => {
  it("parses valid integer strings", () => {
    expect(coerceIntInput("7", 3)).toBe(7);
  });

  it("falls back on empty or non-numeric values", () => {
    expect(coerceIntInput("", 3)).toBe(3);
    expect(coerceIntInput("abc", 5)).toBe(5);
  });

  it("falls back on zero (matching the original || semantics)", () => {
    expect(coerceIntInput("0", 3)).toBe(3);
  });

  it("truncates floating point input", () => {
    expect(coerceIntInput("4.9", 3)).toBe(4);
  });
});

describe("isGenerateDisabled", () => {
  it("is disabled while generating regardless of tab", () => {
    expect(
      isGenerateDisabled({
        isGenerating: true,
        activeTab: "custom",
        selectedPreset: "preset-1",
      }),
    ).toBe(true);
  });

  it("is disabled on the presets tab when no preset is selected", () => {
    expect(
      isGenerateDisabled({
        isGenerating: false,
        activeTab: "presets",
        selectedPreset: null,
      }),
    ).toBe(true);
  });

  it("is enabled on the presets tab once a preset is selected", () => {
    expect(
      isGenerateDisabled({
        isGenerating: false,
        activeTab: "presets",
        selectedPreset: "preset-1",
      }),
    ).toBe(false);
  });

  it("is enabled on the custom tab with no preset", () => {
    expect(
      isGenerateDisabled({
        isGenerating: false,
        activeTab: "custom",
        selectedPreset: null,
      }),
    ).toBe(false);
  });
});

describe("getGenerationErrorMessage", () => {
  it("returns the error message when present", () => {
    expect(getGenerationErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back for null, undefined, and empty messages", () => {
    expect(getGenerationErrorMessage(null)).toBe("Unknown error");
    expect(getGenerationErrorMessage(undefined)).toBe("Unknown error");
    expect(getGenerationErrorMessage(new Error(""))).toBe("Unknown error");
  });
});

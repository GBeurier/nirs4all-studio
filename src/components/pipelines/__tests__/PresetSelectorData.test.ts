import { describe, expect, it } from "vitest";
import {
  buildPresetCardModel,
  clampPresetComplexity,
  getPresetPipeline,
  getPresetPrimaryVariant,
  getPresetVariants,
} from "../PresetSelectorData";
import type { PipelinePreset } from "@/types/pipelines";

function preset(overrides: Partial<PipelinePreset> = {}): PipelinePreset {
  return {
    id: "preset",
    name: "Preset",
    description: "Preset description",
    complexity: 5,
    task_type: "regression",
    default_variant: "regression",
    available_variants: ["regression"],
    variants: {},
    steps_count: 3,
    ...overrides,
  } as PipelinePreset;
}

describe("PresetSelectorData", () => {
  it("derives variants from available_variants, then task_type, then regression", () => {
    expect(
      getPresetVariants(
        preset({
          available_variants: ["classification"],
          task_type: "regression",
        })
      )
    ).toEqual(["classification"]);

    expect(
      getPresetVariants(
        preset({
          available_variants: [],
          task_type: "classification",
        })
      )
    ).toEqual(["classification"]);

    expect(
      getPresetVariants(
        preset({
          available_variants: undefined,
          task_type: undefined,
        })
      )
    ).toEqual(["regression"]);
  });

  it("selects the primary variant from default_variant, then robust fallbacks", () => {
    expect(
      getPresetPrimaryVariant(
        preset({
          default_variant: "classification",
          task_type: "regression",
          available_variants: ["regression"],
        })
      )
    ).toBe("classification");

    expect(
      getPresetPrimaryVariant(
        preset({
          default_variant: undefined,
          task_type: "classification",
          available_variants: ["regression"],
        })
      )
    ).toBe("classification");

    expect(
      getPresetPrimaryVariant(
        preset({
          default_variant: undefined,
          task_type: undefined,
          available_variants: ["classification"],
        })
      )
    ).toBe("classification");

    expect(
      getPresetPrimaryVariant(
        preset({
          default_variant: undefined,
          task_type: undefined,
          available_variants: [],
        })
      )
    ).toBe("regression");
  });

  it("clamps and rounds complexity scores", () => {
    expect(clampPresetComplexity(undefined)).toBe(5);
    expect(clampPresetComplexity(Number.NaN)).toBe(5);
    expect(clampPresetComplexity(0)).toBe(1);
    expect(clampPresetComplexity(11)).toBe(10);
    expect(clampPresetComplexity(4.6)).toBe(5);
  });

  it("selects variant pipelines before falling back to the preset pipeline", () => {
    const variantPipeline = [{ model: "sklearn.cross_decomposition.PLSRegression" }];
    const fallbackPipeline = ["nirs4all.preprocessing.SNV"];
    const p = preset({
      variants: {
        classification: {
          format: "json",
          pipeline: variantPipeline,
        },
      },
      pipeline: fallbackPipeline,
    });

    expect(getPresetPipeline(p, "classification")).toBe(variantPipeline);
    expect(getPresetPipeline(p, "regression")).toBe(fallbackPipeline);
  });

  it("builds the card model from the primary variant pipeline", () => {
    const variantPipeline = [
      "nirs4all.preprocessing.SNV",
      { model: "sklearn.cross_decomposition.PLSRegression" },
    ];
    const p = preset({
      complexity: 6.4,
      default_variant: "classification",
      available_variants: ["classification", "regression"],
      steps_count: 9,
      variants: {
        classification: {
          format: "json",
          pipeline: variantPipeline,
        },
      },
      pipeline: ["nirs4all.preprocessing.Fallback"],
    });

    const model = buildPresetCardModel(p);

    expect(model.primaryVariant).toBe("classification");
    expect(model.pipeline).toBe(variantPipeline);
    expect(model.complexity).toBe(6);
    expect(model.complexityMeta.key).toBe("balanced");
    expect(model.stats).toMatchObject({
      operators: 2,
      models: 1,
      branches: 0,
      variants: 1,
      hasGenerators: false,
    });
    expect(model.operatorCount).toBe(2);
    expect(model.preview.nodes.map((node) => node.label)).toEqual(["SNV", "PLSRegression"]);
  });

  it("keeps the displayed operator fallback when preview steps are empty", () => {
    const model = buildPresetCardModel(
      preset({
        steps_count: 7,
        pipeline: ["<SNV object at 0xabc>"],
        variants: {},
      })
    );

    expect(model.preview.nodes).toEqual([]);
    expect(model.stats.operators).toBe(0);
    expect(model.operatorCount).toBe(7);
  });
});

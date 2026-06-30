import { describe, expect, it } from "vitest";
import type { PipelineStep, StepOption, StepType } from "../types";
import {
  computeBaseCombinations,
  computeMatrixCombinations,
  generateCombinationExamples,
  getCartesianStageDefaultLabel,
  getCartesianStageOptionsLabel,
  getCartesianStepOptionGroups,
  getCartesianSummary,
  getCartesianVariantBadgeClassName,
  getRemainingCombinationsCount,
  hasMoreCombinations,
  MAX_PREVIEW_BASE_COMBINATIONS,
  MAX_PREVIEW_EXAMPLES,
  pluralize,
  pluralizeLocale,
  resolveCartesianStageLabel,
} from "../CartesianGeneratorData";

function makeStep(name: string, overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: `step-${name}`,
    type: "preprocessing",
    name,
    params: {},
    ...overrides,
  };
}

function makeOption(name: string, description = ""): StepOption {
  return { name, description, defaultParams: {} } as StepOption;
}

describe("pluralize", () => {
  it("omits the trailing s for a count of one", () => {
    expect(pluralize(1, "option")).toBe("1 option");
  });

  it("appends s for zero and many", () => {
    expect(pluralize(0, "option")).toBe("0 options");
    expect(pluralize(3, "stage")).toBe("3 stages");
  });
});

describe("pluralizeLocale", () => {
  it("formats large counts with locale separators", () => {
    expect(pluralizeLocale(1, "base combination")).toBe("1 base combination");
    expect(pluralizeLocale(1234, "base combination")).toBe(
      `${(1234).toLocaleString()} base combinations`,
    );
  });
});

describe("stage labels", () => {
  it("derives a 1-based default label", () => {
    expect(getCartesianStageDefaultLabel(0)).toBe("Stage 1");
    expect(getCartesianStageDefaultLabel(2)).toBe("Stage 3");
  });

  it("prefers an explicit label and falls back to the default", () => {
    expect(resolveCartesianStageLabel("Scatter", 0)).toBe("Scatter");
    expect(resolveCartesianStageLabel(undefined, 1)).toBe("Stage 2");
    expect(resolveCartesianStageLabel("", 1)).toBe("Stage 2");
  });

  it("formats the option-count badge", () => {
    expect(getCartesianStageOptionsLabel(1)).toBe("1 option");
    expect(getCartesianStageOptionsLabel(2)).toBe("2 options");
  });
});

describe("computeBaseCombinations", () => {
  it("returns 1 for no stages", () => {
    expect(computeBaseCombinations([])).toBe(1);
  });

  it("multiplies per-stage variant counts (empty stage counts as 1)", () => {
    const stages = [
      [makeStep("a"), makeStep("b")],
      [makeStep("c")],
      [],
    ];
    expect(computeBaseCombinations(stages)).toBe(2);
  });
});

describe("getCartesianSummary", () => {
  it("omits generated variants when equal to base combinations", () => {
    const summary = getCartesianSummary(2, 6, 6);
    expect(summary.stages).toBe("2 stages");
    expect(summary.baseCombinations).toBe("6 base combinations");
    expect(summary.generatedVariants).toBeUndefined();
  });

  it("includes generated variants when they differ", () => {
    const summary = getCartesianSummary(1, 6, 12);
    expect(summary.generatedVariants).toBe("12 generated variants");
  });
});

describe("getCartesianVariantBadgeClassName", () => {
  it("escalates from cyan to orange past 100", () => {
    expect(getCartesianVariantBadgeClassName(50)).toContain("cyan");
    expect(getCartesianVariantBadgeClassName(101)).toContain("orange");
  });

  it("escalates to red past 1000", () => {
    expect(getCartesianVariantBadgeClassName(5000)).toContain("red");
  });
});

describe("generateCombinationExamples", () => {
  it("returns an empty list when there are no stages", () => {
    expect(generateCombinationExamples([], 1)).toEqual([]);
  });

  it("enumerates the cartesian product of option names", () => {
    const stages = [
      [makeStep("A1"), makeStep("A2")],
      [makeStep("B1")],
    ];
    expect(generateCombinationExamples(stages, 2)).toEqual([
      ["A1", "B1"],
      ["A2", "B1"],
    ]);
  });

  it("uses a placeholder for empty stages", () => {
    const stages = [[makeStep("A")], []];
    expect(generateCombinationExamples(stages, 1)).toEqual([["A", "(empty)"]]);
  });

  it("returns nothing when the base count is too large to preview", () => {
    const stages = [[makeStep("A")]];
    expect(
      generateCombinationExamples(stages, MAX_PREVIEW_BASE_COMBINATIONS + 1),
    ).toEqual([]);
  });

  it("caps the number of returned examples", () => {
    const options = Array.from({ length: 12 }, (_, i) => makeStep(`opt${i}`));
    const result = generateCombinationExamples([options], 12);
    expect(result).toHaveLength(MAX_PREVIEW_EXAMPLES);
  });
});

describe("combination overflow helpers", () => {
  it("flags and counts combinations beyond the preview window", () => {
    expect(hasMoreCombinations(MAX_PREVIEW_EXAMPLES)).toBe(false);
    expect(hasMoreCombinations(15)).toBe(true);
    expect(getRemainingCombinationsCount(15)).toBe(5);
  });
});

describe("computeMatrixCombinations", () => {
  it("multiplies option counts treating empty stages as 1", () => {
    const stages = [
      { label: "Stage 1", options: ["a", "b"] },
      { label: "Stage 2", options: ["c", "d", "e"] },
      { label: "Stage 3", options: [] },
    ];
    expect(computeMatrixCombinations(stages)).toBe(6);
  });
});

describe("getCartesianStepOptionGroups", () => {
  const catalog: Record<string, StepOption[]> = {
    preprocessing: [
      makeOption("SNV", "scatter correction"),
      makeOption("MSC", "multiplicative scatter"),
    ],
    model: [makeOption("PLS", "partial least squares")],
    splitting: [makeOption("KFold", "k-fold splitter")],
  };
  const getStepOptions = (type: StepType): StepOption[] => catalog[type] ?? [];

  it("only surfaces preprocessing and model groups", () => {
    const groups = getCartesianStepOptionGroups("", getStepOptions);
    expect(groups.map((g) => g.type)).toEqual(["preprocessing", "model"]);
  });

  it("filters by name and description, dropping empty groups", () => {
    const groups = getCartesianStepOptionGroups("scatter", getStepOptions);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("preprocessing");
    expect(groups[0].options.map((o) => o.name)).toEqual(["SNV", "MSC"]);
  });

  it("matches case-insensitively on the option name", () => {
    const groups = getCartesianStepOptionGroups("pls", getStepOptions);
    expect(groups).toHaveLength(1);
    expect(groups[0].type).toBe("model");
  });
});

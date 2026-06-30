import { describe, expect, it } from "vitest";
import type { PipelineStep } from "../types";
import {
  calculateOrVariants,
  canRemoveOrBranch,
  coerceOrSelectionCount,
  coerceOrSelectionRangeEnd,
  coerceOrSelectionRangeStart,
  getOrBranchLabel,
  getOrBranchReadModels,
  getOrBranchSummary,
  getOrDropZoneClassNames,
  getOrGeneratorSummary,
  getOrOptionContainerClassNames,
  getOrOptionState,
} from "../OrGeneratorData";
import type { StepColorScheme } from "../stepPresentation";

function makeStep(overrides: Partial<PipelineStep> & { name: string }): PipelineStep {
  return {
    id: `step-${overrides.name}`,
    type: "preprocessing",
    params: {},
    ...overrides,
  };
}

const colors: StepColorScheme = {
  border: "border-test",
  bg: "bg-test",
  hover: "hover-test",
  selected: "selected-test",
  text: "text-test",
  active: "active-test",
  gradient: "gradient-test",
};

describe("OrGeneratorData", () => {
  it("builds stable branch labels and branch read models", () => {
    const branches = [
      [makeStep({ name: "SNV" })],
      [makeStep({ name: "MSC" }), makeStep({ name: "Detrend" })],
    ];

    expect(getOrBranchLabel(0)).toBe("Option 1");
    expect(getOrBranchLabel(1)).toBe("Option 2");
    expect(getOrBranchReadModels(branches)).toEqual([
      {
        index: 0,
        indexLabel: "1",
        label: "Option 1",
        summary: "SNV",
        isEmpty: false,
        canRemove: true,
      },
      {
        index: 1,
        indexLabel: "2",
        label: "Option 2",
        summary: "MSC + 1 more",
        isEmpty: false,
        canRemove: true,
      },
    ]);
  });

  it("summarizes empty generator and branch states", () => {
    expect(getOrGeneratorSummary(0, 0)).toBe("0 options • 0 variants");
    expect(getOrBranchSummary(undefined)).toBe("Empty option");
    expect(getOrBranchSummary([])).toBe("Empty option");
    expect(getOrBranchReadModels([[]])).toEqual([
      {
        index: 0,
        indexLabel: "1",
        label: "Option 1",
        summary: "Empty option",
        isEmpty: true,
        canRemove: false,
      },
    ]);
  });

  it("enforces branch count and selection count constraints", () => {
    expect(canRemoveOrBranch(0)).toBe(false);
    expect(canRemoveOrBranch(1)).toBe(false);
    expect(canRemoveOrBranch(2)).toBe(true);

    expect(coerceOrSelectionCount("3", 5, 2)).toBe(3);
    expect(coerceOrSelectionCount("9", 5, 2)).toBe(5);
    expect(coerceOrSelectionCount("0", 5, 2)).toBe(2);
    expect(coerceOrSelectionCount("bad", 5, 2)).toBe(2);
    expect(coerceOrSelectionCount("2", 0, 2)).toBe(1);

    expect(coerceOrSelectionRangeStart("0")).toBe(1);
    expect(coerceOrSelectionRangeStart("4")).toBe(4);
    expect(coerceOrSelectionRangeEnd("5", 2, 4)).toBe(4);
    expect(coerceOrSelectionRangeEnd("bad", 3, 6)).toBe(3);
  });

  it("keeps pick and arrange variant math in the data helper", () => {
    expect(calculateOrVariants(4, { mode: "none" })).toBe(4);
    expect(calculateOrVariants(4, { mode: "pick", value: 2 })).toBe(6);
    expect(calculateOrVariants(4, { mode: "arrange", value: 2 })).toBe(12);
    expect(calculateOrVariants(4, { mode: "pick", value: [1, 2] })).toBe(10);
  });

  it("projects option state and class-name decisions", () => {
    const option = makeStep({
      name: "SavitzkyGolay",
      params: { window: 11, derivative: 1 },
      enabled: false,
    });

    expect(getOrOptionState(option, 2, true)).toEqual({
      indexLabel: "3",
      branchLabel: "Option 3",
      summary: "SavitzkyGolay (2 params)",
      parameterCount: 2,
      parameterSummary: "(2 params)",
      hasParameters: true,
      shouldShowParameters: true,
      expandToggleLabel: "Collapse",
      isDisabled: true,
    });
    expect(getOrOptionState(makeStep({ name: "MSC" }), 0, false)).toMatchObject({
      parameterSummary: undefined,
      hasParameters: false,
      shouldShowParameters: false,
      expandToggleLabel: "Expand",
      isDisabled: false,
    });

    expect(getOrOptionContainerClassNames(colors, true)).toEqual([
      "group relative rounded-lg border transition-all",
      "border-test",
      "bg-test",
      "selected-test",
    ]);
    expect(getOrOptionContainerClassNames(colors, false)).toContain("hover-test");
    expect(getOrDropZoneClassNames(true)).toContain(
      "border-orange-500 bg-orange-500/10",
    );
  });
});

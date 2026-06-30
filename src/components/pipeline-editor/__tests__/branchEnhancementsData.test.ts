import { describe, expect, it } from "vitest";
import type { PipelineStep } from "../types";
import {
  calculateBranchSummaryStats,
  calculateBranchVariantCount,
  getAddBranchButtonDescriptor,
  getBranchOutputDescriptor,
  getBranchSummaryLabel,
  getBranchVisualClasses,
  getDefaultBranchName,
} from "../branchEnhancementsData";

function makeStep(overrides: Partial<PipelineStep> & { name: string }): PipelineStep {
  return {
    id: `branch-test-${overrides.name}`,
    type: "preprocessing",
    params: {},
    ...overrides,
  };
}

describe("branch enhancement data helpers", () => {
  it("builds default names for branches and generator groups", () => {
    expect(getDefaultBranchName("branch", undefined, 0)).toBe("Branch 1");
    expect(getDefaultBranchName("generator", "cartesian", 1)).toBe("Stage 2");
    expect(getDefaultBranchName("generator", "grid", 2)).toBe("Param 3");
    expect(getDefaultBranchName("generator", "zip", 3)).toBe("Param 4");
    expect(getDefaultBranchName("generator", "chain", 4)).toBe("Config 5");
    expect(getDefaultBranchName("generator", "or", 5)).toBe("Option 6");
  });

  it("keeps summary and add-button labels aligned with generator kinds", () => {
    expect(getBranchSummaryLabel(false)).toBe("branches");
    expect(getBranchSummaryLabel(true, "cartesian")).toBe("stages");
    expect(getBranchSummaryLabel(true, "grid")).toBe("params");
    expect(getBranchSummaryLabel(true, "zip")).toBe("params");
    expect(getBranchSummaryLabel(true, "chain")).toBe("configs");
    expect(getBranchSummaryLabel(true, "or")).toBe("options");

    expect(getAddBranchButtonDescriptor(false).label).toBe("Add Branch");
    expect(getAddBranchButtonDescriptor(true, "cartesian").label).toBe("Add Stage");
    expect(getAddBranchButtonDescriptor(true, "grid").label).toBe("Add Param");
    expect(getAddBranchButtonDescriptor(true, "zip").label).toBe("Add Param");
    expect(getAddBranchButtonDescriptor(true, "chain").label).toBe("Add Config");
    expect(getAddBranchButtonDescriptor(true, "or").label).toBe("Add Option");
  });

  it("calculates branch stats with the existing empty-branch variant behavior", () => {
    const sweptStep = makeStep({
      name: "SNV",
      paramSweeps: {
        window: {
          type: "or",
          choices: [5, 7, 9],
        },
      },
    });
    const modelStep = makeStep({ name: "PLS", type: "model" });
    const plainStep = makeStep({ name: "MSC" });

    const branches = [[sweptStep, modelStep], [], [plainStep]];

    expect(calculateBranchVariantCount(branches[0])).toBe(3);
    expect(calculateBranchSummaryStats(branches)).toEqual({
      branchCount: 3,
      totalSteps: 3,
      totalVariants: 5,
      modelCount: 1,
      emptyBranches: 1,
    });
  });

  it("describes branch outputs without changing UI text or color classes", () => {
    expect(getBranchOutputDescriptor("parallel", 3, 2)).toEqual({
      description: "2 parallel predictions → merge",
      icon: "layers",
      colorClass: "text-cyan-500",
    });
    expect(getBranchOutputDescriptor("parallel", 3, 0)).toEqual({
      description: "3 parallel processings",
      icon: "layers",
      colorClass: "text-cyan-500",
    });
    expect(getBranchOutputDescriptor("or", 4, 0)).toEqual({
      description: "1 of 4 alternatives",
      icon: "arrowRight",
      colorClass: "text-orange-500",
    });
    expect(getBranchOutputDescriptor("cartesian", 5, 0)).toEqual({
      description: "5 stage combinations",
      icon: "hash",
      colorClass: "text-orange-500",
    });
  });

  it("centralizes branch and generator classes", () => {
    expect(getBranchVisualClasses(false)).toEqual({
      headerBackground: "bg-cyan-500/5",
      iconColor: "text-cyan-500",
      containerBorderColor: "border-cyan-500/30",
      addButtonColor: "text-cyan-500 hover:text-cyan-600 hover:bg-cyan-500/10",
    });
    expect(getBranchVisualClasses(true)).toEqual({
      headerBackground: "bg-orange-500/5",
      iconColor: "text-orange-400",
      containerBorderColor: "border-orange-400/30",
      addButtonColor: "text-orange-500 hover:text-orange-600 hover:bg-orange-500/10",
    });
  });
});

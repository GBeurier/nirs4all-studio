import { describe, expect, it } from "vitest";
import { Target } from "lucide-react";

import { getPipelineNodePresentation } from "../PipelineNodePresentation";
import type { GeneratorKind, PipelineStep } from "../types";

function makeStep(overrides: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "test-step",
    type: "model",
    name: "PLSRegression",
    params: {},
    ...overrides,
  };
}

describe("getPipelineNodePresentation", () => {
  it("builds the read model for a simple step", () => {
    const presentation = getPipelineNodePresentation(makeStep({
      params: {
        n_components: 10,
        max_iter: 500,
        scale: true,
      },
    }));

    expect(presentation.Icon).toBe(Target);
    expect(presentation.colors).toMatchObject({
      border: "border-emerald-500/30",
      text: "text-emerald-500",
    });
    expect(presentation).toMatchObject({
      hasSweeps: false,
      totalVariants: 1,
      sweepCount: 0,
      sweepSummary: "",
      displayParams: "n_components=10, max_iter=500",
      allParamsDisplay: "n_components=10, max_iter=500, scale=true",
      generatorBranchLabel: "Option",
    });
  });

  it("summarizes parameter sweeps and removes swept params from the inline display", () => {
    const presentation = getPipelineNodePresentation(makeStep({
      params: {
        n_components: 10,
        alpha: 0.1,
        solver: "auto",
      },
      paramSweeps: {
        n_components: {
          type: "range",
          from: 2,
          to: 6,
          step: 2,
        },
        alpha: {
          type: "or",
          choices: [0.1, 1],
        },
      },
    }));

    expect(presentation).toMatchObject({
      hasSweeps: true,
      totalVariants: 6,
      sweepCount: 2,
      sweepSummary: "n_components: 2\u21926 (step 2)\nalpha: 0.1 | 1",
      displayParams: "solver=auto",
      allParamsDisplay: "n_components=10, alpha=0.1, solver=auto",
    });
  });

  it("summarizes step generators and includes them in variant counts", () => {
    const presentation = getPipelineNodePresentation(makeStep({
      params: {
        estimator: "PLS",
        refit: true,
      },
      stepGenerator: {
        type: "_or_",
        param: "estimator",
        values: ["PLS", "SVR", "RF", "Ridge"],
      },
    }));

    expect(presentation).toMatchObject({
      hasSweeps: true,
      totalVariants: 4,
      sweepCount: 1,
      sweepSummary: "estimator: [PLS, SVR, RF, ... (4 total)]",
      displayParams: "estimator=PLS, refit=true",
      allParamsDisplay: "estimator=PLS, refit=true",
    });
  });

  it.each([
    ["cartesian", "Stage"],
    ["grid", "Param"],
    ["zip", "Param"],
    ["chain", "Config"],
    ["or", "Option"],
    ["sample", "Option"],
    [undefined, "Option"],
  ] satisfies Array<[GeneratorKind | undefined, string]>)(
    "uses %s generator branches as %s",
    (generatorKind, generatorBranchLabel) => {
      const presentation = getPipelineNodePresentation(makeStep({
        type: "flow",
        subType: "generator",
        name: generatorKind ?? "Generator",
        generatorKind,
      }));

      expect(presentation.generatorBranchLabel).toBe(generatorBranchLabel);
    }
  );
});

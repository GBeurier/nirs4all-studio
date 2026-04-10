import { describe, expect, it } from "vitest";
import type { PipelineStep } from "../types";
import {
  calculatePipelineVariants,
  calculateStepVariants,
} from "../types";

function makeStep(overrides: Partial<PipelineStep> & { name: string }): PipelineStep {
  return {
    id: `test-${overrides.name}-${Math.random().toString(36).slice(2, 8)}`,
    type: "preprocessing",
    params: {},
    ...overrides,
  };
}

function preprocessingStep(name: string): PipelineStep {
  return makeStep({ name, type: "preprocessing" });
}

describe("variant counting", () => {
  it("counts cartesian stages as the product of stage alternatives", () => {
    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      generatorKind: "cartesian",
      branches: [
        [preprocessingStep("SNV"), preprocessingStep("MSC")],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
    });

    expect(calculateStepVariants(step)).toBe(4);
  });

  it("counts nested cartesian stage generators instead of raw branch length", () => {
    const nestedStage = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [
        [preprocessingStep("SNV")],
        [preprocessingStep("MSC")],
      ],
    });

    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      generatorKind: "cartesian",
      branches: [
        [nestedStage],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
    });

    expect(calculateStepVariants(step)).toBe(4);
  });

  it("applies cartesian pick/count to expanded pipelines, not stage count", () => {
    const step = makeStep({
      name: "Cartesian",
      type: "flow",
      subType: "generator",
      generatorKind: "cartesian",
      branches: [
        [preprocessingStep("SNV"), preprocessingStep("MSC")],
        [preprocessingStep("StandardScaler"), preprocessingStep("MinMaxScaler")],
      ],
      generatorOptions: {
        pick: 2,
        count: 3,
      },
    });

    expect(calculateStepVariants(step)).toBe(3);
  });

  it("sums expanded _or_ branch variants without double counting branch internals", () => {
    const nestedChoice = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [
        [preprocessingStep("SNV")],
        [preprocessingStep("MSC")],
      ],
    });

    const rootChoice = makeStep({
      name: "Or",
      type: "flow",
      subType: "generator",
      generatorKind: "or",
      branches: [
        [nestedChoice],
        [preprocessingStep("Detrend")],
      ],
    });

    expect(calculatePipelineVariants([rootChoice])).toBe(3);
  });
});

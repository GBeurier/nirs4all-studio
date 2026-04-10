import { describe, expect, it } from "vitest";
import type { PipelineStep } from "../types";
import { analyzeExecution } from "../ExecutionPreviewPanel";

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

function orGenerator(optionCount: number, prefix: string): PipelineStep {
  return makeStep({
    name: "Or",
    type: "flow",
    subType: "generator",
    generatorKind: "or",
    branches: Array.from({ length: optionCount }, (_, index) => [
      preprocessingStep(`${prefix}-${index + 1}`),
    ]),
  });
}

describe("analyzeExecution", () => {
  it("does not double count nested generators inside cartesian stages", () => {
    const steps: PipelineStep[] = [
      makeStep({
        name: "SPXYFold",
        type: "splitting",
        params: { n_splits: 3 },
      }),
      makeStep({
        name: "Cartesian",
        type: "flow",
        subType: "generator",
        generatorKind: "cartesian",
        branches: [
          [orGenerator(5, "scatter")],
          [orGenerator(10, "derivative")],
          [orGenerator(3, "baseline")],
          [orGenerator(4, "orthogonal")],
        ],
        generatorOptions: { count: 150 },
      }),
      makeStep({
        name: "PLSRegression",
        type: "model",
        finetuneConfig: {
          enabled: true,
          n_trials: 25,
          approach: "single",
          eval_mode: "best",
          model_params: [],
        },
      }),
    ];

    const breakdown = analyzeExecution(steps);

    expect(breakdown.generatorVariants).toBe(150);
    expect(breakdown.totalPipelines).toBe(150);
    expect(breakdown.cvFolds).toBe(3);
    expect(breakdown.totalFits).toBe(11250);
    expect(breakdown.totalModels).toBe(11400);
  });

  it("uses the authoritative pipeline count when one is provided", () => {
    const steps: PipelineStep[] = [
      makeStep({
        name: "KFold",
        type: "splitting",
        params: { n_splits: 2 },
      }),
      makeStep({
        name: "PLSRegression",
        type: "model",
      }),
    ];

    const breakdown = analyzeExecution(steps, 7);

    expect(breakdown.totalPipelines).toBe(7);
    expect(breakdown.totalFits).toBe(14);
    expect(breakdown.totalModels).toBe(21);
  });

  it("scales CV fits and refits per model step", () => {
    const steps: PipelineStep[] = [
      makeStep({
        name: "KFold",
        type: "splitting",
        params: { n_splits: 4 },
      }),
      makeStep({
        name: "PLS A",
        type: "model",
      }),
      makeStep({
        name: "PLS B",
        type: "model",
        refitConfig: { enabled: false },
      }),
      makeStep({
        name: "PLS C",
        type: "model",
        finetuneConfig: {
          enabled: true,
          n_trials: 10,
          approach: "single",
          eval_mode: "best",
          model_params: [],
        },
      }),
    ];

    const breakdown = analyzeExecution(steps, 3);

    expect(breakdown.modelCount).toBe(3);
    expect(breakdown.modelsWithRefit).toBe(2);
    expect(breakdown.cvFitsPerPipeline).toBe(12);
    expect(breakdown.totalFits).toBe(144);
    expect(breakdown.refitModels).toBe(6);
    expect(breakdown.totalModels).toBe(150);
  });
});

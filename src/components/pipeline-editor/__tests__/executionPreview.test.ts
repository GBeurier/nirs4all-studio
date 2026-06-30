import { describe, expect, it } from "vitest";
import type { PipelineStep } from "../types";
import { analyzeExecution } from "../executionAnalysis";
import {
  buildExecutionFormula,
  estimateExecutionTime,
  generateExecutionSuggestions,
  getExecutionProgressValue,
  getFitsSeverity,
} from "../executionPreviewPresentation";

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

describe("execution preview presentation", () => {
  const baseBreakdown = (): ReturnType<typeof analyzeExecution> => ({
    sweepVariants: 1,
    generatorVariants: 1,
    finetuningTrials: 0,
    cvFolds: 5,
    cvFitsPerPipeline: 1,
    totalFits: 5,
    refitModels: 1,
    totalPipelines: 1,
    totalModels: 6,
    modelsWithFinetuning: 0,
    modelsWithSweeps: 0,
    modelsWithGenerators: 0,
    modelsWithRefit: 1,
    modelCount: 1,
  });

  it("classifies total fit complexity at preview thresholds", () => {
    expect(getFitsSeverity(100)).toBe("low");
    expect(getFitsSeverity(101)).toBe("medium");
    expect(getFitsSeverity(1001)).toBe("high");
    expect(getFitsSeverity(10001)).toBe("extreme");
  });

  it("formats rough execution time estimates with stable units", () => {
    expect(estimateExecutionTime(59)).toBe("~59s");
    expect(estimateExecutionTime(60)).toBe("~1 min");
    expect(estimateExecutionTime(3600)).toBe("~1.0 hours");
    expect(estimateExecutionTime(86400)).toBe("~1.0 days");
  });

  it("keeps the progress preview bounded on a logarithmic scale", () => {
    expect(getExecutionProgressValue(0)).toBe(0);
    expect(getExecutionProgressValue(100000)).toBe(100);
    expect(getExecutionProgressValue(1000000)).toBe(100);
  });

  it("generates suggestions for expensive sweep and CV configurations", () => {
    const suggestions = generateExecutionSuggestions({
      ...baseBreakdown(),
      sweepVariants: 1200,
      finetuningTrials: 150,
      cvFolds: 12,
      totalFits: 60000,
    });

    expect(suggestions).toEqual([
      "Consider using Optuna finetuning instead of exhaustive grid search for faster optimization.",
      "Reduce parameter sweep ranges or use coarser step sizes to limit combinations.",
      "With many sweep variants, consider reducing Optuna trials per variant.",
      "High CV fold count increases execution time. Consider 5-fold CV for faster iteration.",
      "Consider using a subset of data for initial exploration, then full data for final model.",
    ]);
  });

  it("builds a compact formula from mixed sweep, generator, CV, and refit counts", () => {
    expect(
      buildExecutionFormula({
        ...baseBreakdown(),
        sweepVariants: 3,
        generatorVariants: 4,
        cvFitsPerPipeline: 2,
        cvFolds: 6,
        refitModels: 12,
        totalPipelines: 12,
      }),
    ).toBe("3 sweeps × 4 generators × 2 fits/pipeline × 6 folds + 12 refits");
  });
});

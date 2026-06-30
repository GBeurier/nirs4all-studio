import type { PipelineStep } from "./types";
import { calculateStepVariants } from "./variantCounting";

export interface ExecutionBreakdown {
  sweepVariants: number;
  generatorVariants: number;
  finetuningTrials: number;
  cvFolds: number;
  cvFitsPerPipeline: number;
  totalFits: number;
  refitModels: number;
  totalPipelines: number;
  totalModels: number;
  modelsWithFinetuning: number;
  modelsWithSweeps: number;
  modelsWithGenerators: number;
  modelsWithRefit: number;
  modelCount: number;
}

export function analyzeExecution(
  steps: PipelineStep[],
  variantCount?: number,
): ExecutionBreakdown {
  let sweepVariants = 1;
  let generatorVariants = 1;
  let finetuningTrials = 0;
  let cvFolds = 5;
  let cvFitsPerPipeline = 0;
  let modelsWithFinetuning = 0;
  let modelsWithSweeps = 0;
  let modelsWithGenerators = 0;
  let modelsWithRefit = 0;
  let modelCount = 0;

  function processSteps(
    stepList: PipelineStep[],
    variantsAlreadyAccounted = false,
  ) {
    for (const step of stepList) {
      const isGeneratorStep = step.subType === "generator" && !!step.generatorKind;

      if (isGeneratorStep && step.branches) {
        if (!variantsAlreadyAccounted) {
          const genVariants = calculateStepVariants(step);
          if (genVariants > 1) {
            generatorVariants *= genVariants;
            modelsWithGenerators++;
          }
        }

        for (const branch of step.branches) {
          processSteps(branch, true);
        }
        continue;
      }

      const hasSweeps = (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) || step.stepGenerator;
      if (hasSweeps && !variantsAlreadyAccounted) {
        const stepVariants = calculateStepVariants(step);
        if (stepVariants > 1) {
          sweepVariants *= stepVariants;
          if (step.type === "model") {
            modelsWithSweeps++;
          }
        }
      }

      if (step.type === "splitting") {
        const nSplits = step.params.n_splits ?? step.params.n_repeats;
        if (typeof nSplits === "number") {
          cvFolds = nSplits;
        }
      }

      if (step.type === "model") {
        modelCount++;
        const trials = step.finetuneConfig?.enabled
          ? Math.max(1, step.finetuneConfig.n_trials ?? 50)
          : 1;
        cvFitsPerPipeline += trials;
        if (step.refitConfig?.enabled ?? true) {
          modelsWithRefit++;
        }
        if (step.finetuneConfig?.enabled) {
          finetuningTrials += trials;
          modelsWithFinetuning++;
        }
      }

      if (step.branches && step.subType !== "generator") {
        for (const branch of step.branches) {
          processSteps(branch, variantsAlreadyAccounted);
        }
      }

      if (step.children) {
        processSteps(step.children, variantsAlreadyAccounted);
      }
    }
  }

  processSteps(steps);

  const totalPipelines =
    variantCount && variantCount > 0
      ? variantCount
      : sweepVariants * generatorVariants;
  const totalFits = totalPipelines * cvFitsPerPipeline * cvFolds;
  const refitModels = totalPipelines * modelsWithRefit;
  const totalModels = totalFits + refitModels;

  return {
    sweepVariants,
    generatorVariants,
    finetuningTrials,
    cvFolds,
    cvFitsPerPipeline,
    totalFits,
    refitModels,
    totalPipelines,
    totalModels,
    modelsWithFinetuning,
    modelsWithSweeps,
    modelsWithGenerators,
    modelsWithRefit,
    modelCount,
  };
}

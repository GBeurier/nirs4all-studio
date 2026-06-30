/**
 * Local variant-count estimator (synchronous, per-step / per-sweep)
 *
 * This family powers inline UI feedback that must update on every keystroke:
 * tree-node badges, sweep-popover live previews, generator option counts, and
 * per-step config-panel summaries. It is deliberately synchronous and local.
 *
 * It is not redundant with the `useVariantCount` hook. That hook counts a whole
 * pipeline by calling the nirs4all backend (`/pipelines/count-variants`),
 * debounced and asynchronous: the authoritative total for the editor footer.
 * These functions answer "how many variants does this step / sweep produce?"
 * without a round-trip.
 */

import type {
  ParameterSweep,
  PipelineStep,
} from "./types";

export function calculateSweepVariants(sweep: ParameterSweep): number {
  switch (sweep.type) {
    case "range":
      if (sweep.from !== undefined && sweep.to !== undefined) {
        const step = sweep.step ?? 1;
        return Math.max(1, Math.floor((sweep.to - sweep.from) / step) + 1);
      }
      return 0;
    case "log_range":
      return sweep.count ?? 5;
    case "or":
      return sweep.choices?.length ?? 0;
    case "grid":
      if (sweep.gridParams) {
        return Object.values(sweep.gridParams).reduce(
          (acc, vals) => acc * vals.length, 1
        );
      }
      return 0;
    default:
      return 0;
  }
}

function applyVariantCountLimit(total: number, count?: number): number {
  return count && count > 0 ? Math.min(total, count) : total;
}

export function calculateCartesianStageVariants(stage: PipelineStep[]): number {
  if (stage.length === 0) {
    return 1;
  }

  if (stage.length === 1) {
    const [singleStep] = stage;
    if (singleStep.subType === "sequential") {
      return calculatePipelineVariants(singleStep.children ?? []);
    }
    return calculatePipelineVariants([singleStep]);
  }

  return stage.reduce(
    (total, option) => total + calculatePipelineVariants([option]),
    0
  );
}

export function calculateGeneratorExpansionCount(step: PipelineStep): number {
  const branches = step.branches ?? [];

  if (step.generatorKind === "or") {
    return branches.reduce(
      (total, branch) => total + calculatePipelineVariants(branch),
      0
    );
  }

  if (step.generatorKind === "cartesian") {
    return branches.reduce(
      (total, stage) => total * calculateCartesianStageVariants(stage),
      1
    );
  }

  if (step.generatorKind === "grid" && step.scalarGeneratorConfig?.entries) {
    return step.scalarGeneratorConfig.entries.reduce(
      (total, entry) => total * Math.max(1, entry.values.length),
      1
    );
  }

  if (step.generatorKind === "grid") {
    return branches.reduce(
      (total, branch) => total * Math.max(1, branch.length),
      1
    );
  }

  if (step.generatorKind === "zip" && step.scalarGeneratorConfig?.entries) {
    const lengths = step.scalarGeneratorConfig.entries
      .map((entry) => entry.values.length)
      .filter((length) => length > 0);
    return lengths.length > 0 ? Math.min(...lengths) : 0;
  }

  if (step.generatorKind === "zip") {
    const lengths = branches.map((branch) => branch.length).filter((length) => length > 0);
    return lengths.length > 0 ? Math.min(...lengths) : 0;
  }

  if (step.generatorKind === "chain") {
    return branches.reduce(
      (total, branch) => total + calculatePipelineVariants(branch),
      0
    );
  }

  if (step.generatorKind === "sample") {
    return Number(step.scalarGeneratorConfig?.sample?.num) || 0;
  }

  return branches.length;
}

export function calculateStepVariants(step: PipelineStep): number {
  let variants = 1;

  if (step.paramSweeps && Object.keys(step.paramSweeps).length > 0) {
    variants = Object.values(step.paramSweeps).reduce(
      (acc, sweep) => acc * calculateSweepVariants(sweep), 1
    );
  }

  if (step.stepGenerator) {
    const gen = step.stepGenerator;
    let genVariants = 1;

    if (gen.type === "_range_" && Array.isArray(gen.values) && gen.values.length >= 2) {
      const [start, end, rangeStep = 1] = gen.values as number[];
      genVariants = Math.max(1, Math.floor((end - start) / rangeStep) + 1);
    } else if (gen.type === "_log_range_" && Array.isArray(gen.values) && gen.values.length >= 2) {
      const count = gen.values.length >= 3 ? (gen.values[2] as number) : 5;
      genVariants = count;
    } else if (gen.type === "_or_" && Array.isArray(gen.values)) {
      const choiceCount = gen.values.length;
      genVariants = choiceCount;

      if (gen.arrange !== undefined) {
        genVariants = calculateGeneratorValue(choiceCount, "arrange", gen.arrange);
      } else if (gen.pick !== undefined) {
        genVariants = calculateGeneratorValue(choiceCount, "pick", gen.pick);
      }
    } else if (gen.type === "_grid_" && Array.isArray(gen.values)) {
      genVariants = 1;
    }

    variants *= applyVariantCountLimit(genVariants, gen.count);
  }

  if ((step.generatorKind === "or" || step.generatorKind === "cartesian") && step.branches) {
    const opts = step.generatorOptions || {};
    const expandedCount = calculateGeneratorExpansionCount(step);

    let genVariants = expandedCount;

    if (opts.arrange !== undefined) {
      genVariants = calculateGeneratorValue(expandedCount, "arrange", opts.arrange);
    } else if (opts.pick !== undefined) {
      genVariants = calculateGeneratorValue(expandedCount, "pick", opts.pick);
    }

    if (step.generatorKind === "or") {
      if (opts.then_arrange !== undefined) {
        genVariants = calculateGeneratorValue(genVariants, "arrange", opts.then_arrange);
      } else if (opts.then_pick !== undefined) {
        genVariants = calculateGeneratorValue(genVariants, "pick", opts.then_pick);
      }
    }

    variants *= applyVariantCountLimit(genVariants, opts.count);
  } else if (step.generatorKind) {
    variants *= applyVariantCountLimit(
      calculateGeneratorExpansionCount(step),
      step.generatorOptions?.count
    );
  }

  return variants;
}

function calculateGeneratorValue(
  n: number,
  mode: "pick" | "arrange",
  value: number | [number, number]
): number {
  if (Array.isArray(value) && value.length === 2) {
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      if (mode === "pick") {
        total += binomialCoefficient(n, k);
      } else {
        total += permutation(n, k);
      }
    }
    return total;
  } else {
    const k = typeof value === "number" ? value : 1;
    if (mode === "pick") {
      return binomialCoefficient(n, k);
    } else {
      return permutation(n, k);
    }
  }
}

function permutation(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

function binomialCoefficient(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;

  let result = 1;
  for (let i = 0; i < k; i++) {
    result = result * (n - i) / (i + 1);
  }
  return Math.round(result);
}

export function calculatePipelineVariants(steps: PipelineStep[]): number {
  let totalVariants = 1;

  for (const step of steps) {
    if (step.enabled === false) continue;

    totalVariants *= calculateStepVariants(step);

    if (step.subType === "branch" && step.branches && !step.generatorKind) {
      for (const branch of step.branches) {
        totalVariants *= calculatePipelineVariants(branch);
      }
    }
  }

  return totalVariants;
}

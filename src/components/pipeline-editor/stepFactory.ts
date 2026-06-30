import type {
  FlowStepSubType,
  GeneratorKind,
  ParameterSweep,
  PipelineStep,
  StepOption,
  StepSubType,
  StepType,
} from "./types";

export function generateStepId(): string {
  return `step-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function inferSubType(type: StepType, optionName: string): StepSubType | undefined {
  if (type === "flow") {
    const flowNameMap: Record<string, FlowStepSubType> = {
      "ParallelBranch": "branch",
      "SourceBranch": "branch",
      "Concatenate": "merge",
      "Mean": "merge",
      "Stacking": "merge",
      "Voting": "merge",
      "SampleAugmentation": "sample_augmentation",
      "FeatureAugmentation": "feature_augmentation",
      "SampleFilter": "sample_filter",
      "ConcatTransform": "concat_transform",
      "Sequential": "sequential",
      "Or": "generator",
      "Cartesian": "generator",
      "Grid": "generator",
      "Zip": "generator",
      "Chain": "generator",
      "Sample": "generator",
    };
    return flowNameMap[optionName];
  }
  if (type === "utility") {
    const utilityNameMap: Record<string, StepSubType> = {
      "chart_2d": "chart",
      "chart_y": "chart",
      "Comment": "comment",
    };
    return utilityNameMap[optionName];
  }
  return undefined;
}

const GENERATOR_NAME_MAP: Record<string, GeneratorKind> = {
  "Or": "or",
  "Cartesian": "cartesian",
  "Grid": "grid",
  "Zip": "zip",
  "Chain": "chain",
  "Sample": "sample",
  "Range": "range",
  "LogRange": "log_range",
};

export function inferGeneratorKind(stepName: string): GeneratorKind | undefined {
  return GENERATOR_NAME_MAP[stepName];
}

export function migrateStep(step: PipelineStep): PipelineStep {
  let migrated = step;

  if (!migrated.subType && migrated.type) {
    const subType = inferSubType(migrated.type, migrated.name);
    if (subType) {
      migrated = { ...migrated, subType };
    }
  }

  if (migrated.subType === "generator" && !migrated.generatorKind) {
    const kind = inferGeneratorKind(migrated.name);
    if (kind) {
      migrated = { ...migrated, generatorKind: kind };
    }
  }

  if (migrated.branches) {
    const migratedBranches = migrated.branches.map(branch =>
      branch.map(s => migrateStep(s))
    );
    if (migratedBranches !== migrated.branches) {
      migrated = { ...migrated, branches: migratedBranches };
    }
  }

  if (migrated.children) {
    const migratedChildren = migrated.children.map(c => migrateStep(c));
    if (migratedChildren !== migrated.children) {
      migrated = { ...migrated, children: migratedChildren };
    }
  }

  return migrated;
}

function usesChildrenSubType(subType: StepSubType | undefined): boolean {
  return subType === "sample_augmentation"
    || subType === "feature_augmentation"
    || subType === "sample_filter"
    || subType === "concat_transform"
    || subType === "sequential";
}

export function createStepFromOption(type: StepType, option: StepOption): PipelineStep {
  const subType = inferSubType(type, option.name);
  const usesChildren = usesChildrenSubType(subType);

  const scalarGeneratorConfig = option.generatorKind === "grid" || option.generatorKind === "zip"
    ? {
        entries: [
          { id: generateStepId(), key: "param_1", values: [] },
          { id: generateStepId(), key: "param_2", values: [] },
        ],
      }
    : option.generatorKind === "sample"
      ? {
          sample: {
            distribution: "uniform",
            from: 0,
            to: 1,
            num: 5,
          },
        }
      : undefined;

  return {
    id: generateStepId(),
    type,
    subType,
    name: option.name,
    params: { ...option.defaultParams },
    classPath: option.classPath,
    functionPath: option.functionPath,
    framework: option.framework,
    branches: scalarGeneratorConfig
      ? undefined
      : option.defaultBranches
      ? JSON.parse(JSON.stringify(option.defaultBranches))
      : undefined,
    generatorKind: option.generatorKind,
    scalarGeneratorConfig,
    children: usesChildren ? [] : undefined,
  };
}

export function cloneStep(step: PipelineStep): PipelineStep {
  return {
    ...step,
    id: generateStepId(),
    params: { ...step.params },
    paramSweeps: step.paramSweeps
      ? JSON.parse(JSON.stringify(step.paramSweeps))
      : undefined,
    branches: step.branches?.map(branch =>
      branch.map(s => cloneStep(s))
    ),
    branchMetadata: step.branchMetadata
      ? JSON.parse(JSON.stringify(step.branchMetadata))
      : undefined,
    generatorOptions: step.generatorOptions
      ? { ...step.generatorOptions }
      : undefined,
    separationConfig: step.separationConfig
      ? JSON.parse(JSON.stringify(step.separationConfig))
      : undefined,
    scalarGeneratorConfig: step.scalarGeneratorConfig
      ? JSON.parse(JSON.stringify(step.scalarGeneratorConfig))
      : undefined,
  };
}

export function formatSweepDisplay(sweep: ParameterSweep): string {
  switch (sweep.type) {
    case "range":
      return `${sweep.from}→${sweep.to}${sweep.step && sweep.step !== 1 ? ` (step ${sweep.step})` : ""}`;
    case "log_range":
      return `log(${sweep.from}→${sweep.to})`;
    case "or":
      if (sweep.choices && sweep.choices.length <= 3) {
        return sweep.choices.join(" | ");
      }
      return `${sweep.choices?.length ?? 0} choices`;
    case "grid":
      return "grid";
    default:
      return "sweep";
  }
}

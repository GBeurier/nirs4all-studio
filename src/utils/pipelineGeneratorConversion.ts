import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/stepFactory";
import type {
  Nirs4allGeneratorStep,
  Nirs4allStep,
} from "./nirs4allPipelineTypes";
import { castParamRecord } from "./pipelineValueUtils";

type Nirs4allToEditorStepConverter = (step: Nirs4allStep) => EditorPipelineStep;
type EditorToNirs4allStepConverter = (step: EditorPipelineStep) => Nirs4allStep;
type OrGeneratorStage = { _or_: Array<Nirs4allStep | Nirs4allStep[] | null> };

export function createNoOpEditorStep(): EditorPipelineStep {
  return {
    id: generateStepId(),
    type: "utility",
    name: "NoOp",
    params: {},
    isNoOp: true,
    rawNirs4all: null,
  };
}

export function createSequentialEditorStep(children: EditorPipelineStep[]): EditorPipelineStep {
  return {
    id: generateStepId(),
    type: "flow",
    subType: "sequential",
    name: "Sequential",
    params: {},
    children,
  };
}

export function convertGeneratorAlternativeToEditor(
  alternative: Nirs4allStep | Nirs4allStep[] | null,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep[] {
  if (alternative === null) {
    return [createNoOpEditorStep()];
  }
  if (Array.isArray(alternative)) {
    return alternative.map(item =>
      item === null ? createNoOpEditorStep() : convertStepToEditor(item)
    );
  }
  return [convertStepToEditor(alternative)];
}

function getGeneratorParams(step: Nirs4allGeneratorStep): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (step._seed_ !== undefined) {
    params._seed_ = step._seed_;
  }
  return params;
}

function createEditorStepFromGeneratorAlternative(
  alternative: Nirs4allStep | Nirs4allStep[] | null,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  if (alternative === null) {
    return createNoOpEditorStep();
  }
  if (Array.isArray(alternative)) {
    return createSequentialEditorStep(alternative.map(item => convertStepToEditor(item)));
  }
  return convertStepToEditor(alternative);
}

function isOrGeneratorStage(stage: Nirs4allStep | Nirs4allStep[] | null): stage is OrGeneratorStage {
  return (
    stage !== null &&
    typeof stage === "object" &&
    !Array.isArray(stage) &&
    Array.isArray((stage as { _or_?: unknown })._or_) &&
    Object.keys(stage).length === 1
  );
}

export function convertCartesianStageToEditor(
  stage: Nirs4allStep | Nirs4allStep[] | null,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep[] {
  if (Array.isArray(stage)) {
    if (stage.length === 0) {
      return [];
    }
    return [createSequentialEditorStep(stage.map(item => convertStepToEditor(item)))];
  }

  if (isOrGeneratorStage(stage)) {
    return stage._or_.map(alternative =>
      createEditorStepFromGeneratorAlternative(
        alternative,
        convertStepToEditor
      )
    );
  }

  return [convertStepToEditor(stage)];
}

export function convertOrGeneratorToEditor(
  step: Nirs4allGeneratorStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const alternatives = step._or_ || [];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Or",
    params: getGeneratorParams(step),
    branches: alternatives.map(alt =>
      convertGeneratorAlternativeToEditor(
        alt as Nirs4allStep | Nirs4allStep[] | null,
        convertStepToEditor
      )
    ),
    generatorKind: "or",
    generatorOptions: {
      pick: step.pick,
      arrange: step.arrange,
      then_pick: step.then_pick,
      then_arrange: step.then_arrange,
      count: step.count,
    },
  };
}

export function convertCartesianGeneratorToEditor(
  step: Nirs4allGeneratorStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const stages = step._cartesian_ || [];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Cartesian",
    params: getGeneratorParams(step),
    branches: stages.map(stage =>
      convertCartesianStageToEditor(stage as Nirs4allStep | Nirs4allStep[] | null, convertStepToEditor)
    ),
    generatorKind: "cartesian",
    generatorOptions: {
      pick: step.pick,
      arrange: step.arrange,
      count: step.count,
    },
  };
}

export function convertRangeGeneratorToEditor(step: Nirs4allGeneratorStep): EditorPipelineStep {
  const keyword = step._log_range_ ? "_log_range_" : "_range_";
  const values = (step._log_range_ || step._range_ || []) as [number, number, number];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: keyword === "_log_range_" ? "LogRange" : "Range",
    params: getGeneratorParams(step),
    generatorKind: keyword === "_log_range_" ? "log_range" : "range",
    stepGenerator: {
      type: keyword,
      values,
      param: step.param,
      count: step.count,
    },
  };
}

export function convertGridGeneratorToEditor(step: Nirs4allGeneratorStep): EditorPipelineStep {
  const entries = Object.entries(step._grid_ || {}).map(([key, values]) => ({
    id: generateStepId(),
    key,
    values: (values ?? []) as unknown[],
  }));

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Grid",
    params: getGeneratorParams(step),
    generatorKind: "grid",
    scalarGeneratorConfig: { entries },
    generatorOptions: {
      count: step.count,
    },
  };
}

export function convertZipGeneratorToEditor(step: Nirs4allGeneratorStep): EditorPipelineStep {
  const entries = Object.entries(step._zip_ || {}).map(([key, values]) => ({
    id: generateStepId(),
    key,
    values: (values ?? []) as unknown[],
  }));

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Zip",
    params: getGeneratorParams(step),
    generatorKind: "zip",
    scalarGeneratorConfig: { entries },
    generatorOptions: {
      count: step.count,
    },
  };
}

export function convertChainGeneratorToEditor(
  step: Nirs4allGeneratorStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const configs = step._chain_ || [];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Chain",
    params: getGeneratorParams(step),
    branches: configs.map(config =>
      convertGeneratorAlternativeToEditor(
        config as Nirs4allStep | Nirs4allStep[] | null,
        convertStepToEditor
      )
    ),
    generatorKind: "chain",
    generatorOptions: {
      count: step.count,
    },
  };
}

export function convertSampleGeneratorToEditor(step: Nirs4allGeneratorStep): EditorPipelineStep {
  const sample = castParamRecord(step._sample_);
  if ("values" in sample) {
    sample.choices = sample.values;
    delete sample.values;
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "generator",
    name: "Sample",
    params: getGeneratorParams(step),
    generatorKind: "sample",
    scalarGeneratorConfig: { sample },
    generatorOptions: {
      count: step.count,
    },
  };
}

function convertCartesianStageToNirs4all(
  stage: EditorPipelineStep[],
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep | Nirs4allStep[] {
  if (stage.length === 0) {
    return [];
  }

  if (stage.length > 1) {
    return {
      _or_: stage.map(option => convertEditorStepToNirs4all(option)),
    };
  }

  const [singleStep] = stage;
  if (singleStep.isNoOp) {
    return { _or_: [null] };
  }
  if (singleStep.subType === "sequential") {
    return (singleStep.children || []).map(child => convertEditorStepToNirs4all(child));
  }
  return convertEditorStepToNirs4all(singleStep);
}

function addGeneratorModifiers(
  result: Record<string, unknown>,
  step: EditorPipelineStep
) {
  const opts = step.generatorOptions || {};
  const count = opts.count ?? (step.params as Record<string, unknown>)?.count;
  if (typeof count === "number" && count > 0) result.count = count;
  const seed = (step.params as Record<string, unknown>)?._seed_;
  if (seed !== undefined) result._seed_ = seed;
}

function convertBranchAlternativeToNirs4all(
  branch: EditorPipelineStep[],
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep | Nirs4allStep[] {
  return branch.length === 1
    ? convertEditorStepToNirs4all(branch[0])
    : branch.map(step => convertEditorStepToNirs4all(step));
}

export function convertEditorGeneratorToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  const branches = step.branches || [];
  const opts = step.generatorOptions || {};

  if (step.generatorKind === "cartesian") {
    const stages = branches.map(stage =>
      convertCartesianStageToNirs4all(stage, convertEditorStepToNirs4all)
    );
    const result: Record<string, unknown> = { _cartesian_: stages };
    if (opts.pick) result.pick = opts.pick;
    if (opts.arrange) result.arrange = opts.arrange;
    addGeneratorModifiers(result, step);
    return result as unknown as Nirs4allStep;
  }

  if (step.generatorKind === "grid") {
    const grid: Record<string, unknown[]> = {};
    const entries = step.scalarGeneratorConfig?.entries;
    if (entries && entries.length > 0) {
      entries.forEach((entry, idx) => {
        grid[entry.key || `param_${idx}`] = entry.values ?? [];
      });
    } else {
      branches.forEach((branch, idx) => {
        const paramName = step.branchMetadata?.[idx]?.name || `param_${idx}`;
        grid[paramName] = branch.map(option => convertEditorStepToNirs4all(option));
      });
    }
    const result: Record<string, unknown> = { _grid_: grid };
    addGeneratorModifiers(result, step);
    return result as unknown as Nirs4allStep;
  }

  if (step.generatorKind === "zip") {
    const zipData: Record<string, unknown[]> = {};
    const entries = step.scalarGeneratorConfig?.entries;
    if (entries && entries.length > 0) {
      entries.forEach((entry, idx) => {
        zipData[entry.key || `param_${idx}`] = entry.values ?? [];
      });
    } else {
      branches.forEach((branch, idx) => {
        const paramName = step.branchMetadata?.[idx]?.name || `param_${idx}`;
        zipData[paramName] = branch.map(option => convertEditorStepToNirs4all(option));
      });
    }
    const result: Record<string, unknown> = { _zip_: zipData };
    addGeneratorModifiers(result, step);
    return result as unknown as Nirs4allStep;
  }

  if (step.generatorKind === "sample") {
    const sample: Record<string, unknown> = { ...(step.scalarGeneratorConfig?.sample ?? {}) };
    if ("choices" in sample) {
      sample.values = sample.choices;
      delete sample.choices;
    }
    const result: Record<string, unknown> = { _sample_: sample };
    addGeneratorModifiers(result, step);
    return result as unknown as Nirs4allStep;
  }

  if (step.generatorKind === "chain") {
    const configs = branches.map(branch =>
      convertBranchAlternativeToNirs4all(branch, convertEditorStepToNirs4all)
    );
    const result: Record<string, unknown> = { _chain_: configs };
    addGeneratorModifiers(result, step);
    return result as unknown as Nirs4allStep;
  }

  if (branches.length === 0) {
    return { _or_: [] } as unknown as Nirs4allStep;
  }

  const alternatives = branches.map(branch =>
    convertBranchAlternativeToNirs4all(branch, convertEditorStepToNirs4all)
  );

  const result: Record<string, unknown> = { _or_: alternatives };
  if (opts.pick) result.pick = opts.pick;
  if (opts.arrange) result.arrange = opts.arrange;
  if (opts.then_pick) result.then_pick = opts.then_pick;
  if (opts.then_arrange) result.then_arrange = opts.then_arrange;
  addGeneratorModifiers(result, step);

  return result as unknown as Nirs4allStep;
}

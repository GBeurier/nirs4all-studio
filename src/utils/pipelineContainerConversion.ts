import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { generateStepId } from "@/components/pipeline-editor/stepFactory";
import type {
  Nirs4allClassStep,
  Nirs4allConcatTransformStep,
  Nirs4allFeatureAugmentationStep,
  Nirs4allFilterWrapperStep,
  Nirs4allSampleAugmentationStep,
  Nirs4allSampleFilterStep,
  Nirs4allStep,
} from "./nirs4allPipelineTypes";
import {
  convertGeneratorAlternativeToEditor,
  createNoOpEditorStep,
} from "./pipelineGeneratorConversion";
import { resolveClassPath } from "./pipelineClassPathResolver";

type Nirs4allToEditorStepConverter = (step: Nirs4allStep) => EditorPipelineStep;
type EditorToNirs4allStepConverter = (step: EditorPipelineStep) => Nirs4allStep;
type ExportableStepParamsResolver = (step: EditorPipelineStep) => Record<string, unknown>;

type ConcatTransformBranchConfig = Array<{
  id: string;
  name: string;
  classPath?: string;
  params: Record<string, unknown>;
  enabled?: boolean;
}>;

function buildConcatTransformConfigEntry(transform: Nirs4allStep): ConcatTransformBranchConfig[number] {
  if (typeof transform === "string") {
    const { name } = resolveClassPath(transform);
    return { id: generateStepId(), name, classPath: transform, params: {}, enabled: true };
  }

  const classStep = transform as Nirs4allClassStep;
  const { name } = resolveClassPath(classStep.class);
  return {
    id: generateStepId(),
    name,
    classPath: classStep.class,
    params: classStep.params || {},
    enabled: true,
  };
}

export function convertSampleAugmentationToEditor(
  step: Nirs4allSampleAugmentationStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const aug = step.sample_augmentation;
  const childSteps = aug.transformers.map(transform =>
    convertStepToEditor(transform as Nirs4allStep)
  );

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_augmentation",
    name: "SampleAugmentation",
    params: {
      count: aug.count || 1,
      selection: aug.selection || "random",
      random_state: aug.random_state ?? 42,
      variation_scope: aug.variation_scope || "sample",
    },
    children: childSteps,
  };
}

export function convertFeatureAugmentationToEditor(
  step: Nirs4allFeatureAugmentationStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const aug = step.feature_augmentation;

  if (Array.isArray(aug)) {
    const childSteps = aug.map(transform => convertStepToEditor(transform));

    return {
      id: generateStepId(),
      type: "flow",
      subType: "feature_augmentation",
      name: "FeatureAugmentation",
      params: { action: step.action || "extend" },
      children: childSteps,
    };
  }

  const childSteps = aug._or_?.map((transform: string | Nirs4allClassStep | null) =>
    transform === null ? createNoOpEditorStep() : convertStepToEditor(transform as Nirs4allStep)
  ) || [];

  return {
    id: generateStepId(),
    type: "flow",
    subType: "feature_augmentation",
    name: "FeatureAugmentation",
    params: {
      action: step.action || "extend",
      pick: aug.pick,
      count: aug.count || 0,
    },
    children: childSteps,
    branches: aug._or_?.map((transform: string | Nirs4allClassStep | null) =>
      convertGeneratorAlternativeToEditor(transform, convertStepToEditor)
    ) || [],
    generatorKind: "or",
    generatorOptions: {
      pick: aug.pick,
      count: aug.count,
    },
  };
}

export function convertSampleFilterToEditor(
  step: Nirs4allSampleFilterStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const filter = step.sample_filter;
  const childSteps = filter.filters.map(filterStep =>
    convertStepToEditor(filterStep as Nirs4allStep)
  );

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_filter",
    name: "SampleFilter",
    params: {
      mode: filter.mode || "any",
      report: filter.report ?? true,
    },
    children: childSteps,
    filterOrigin: "sample_filter",
  };
}

export function convertFilterWrapperToEditor(
  step: Nirs4allFilterWrapperStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const origin = "exclude" in step ? "exclude" : "tag";
  const rawFilters = step[origin];
  const filters = Array.isArray(rawFilters)
    ? rawFilters
    : rawFilters !== undefined
      ? [rawFilters]
      : [];
  const childSteps = filters.map(filterStep => convertStepToEditor(filterStep as Nirs4allStep));

  return {
    id: generateStepId(),
    type: "flow",
    subType: "sample_filter",
    name: origin === "tag" ? "TagFilter" : "SampleFilter",
    params: origin === "exclude" && step.mode ? { mode: step.mode } : {},
    children: childSteps,
    filterOrigin: origin,
  };
}

export function convertConcatTransformToEditor(
  step: Nirs4allConcatTransformStep,
  convertStepToEditor: Nirs4allToEditorStepConverter
): EditorPipelineStep {
  const branches: EditorPipelineStep[][] = [];
  const branchConfigs: ConcatTransformBranchConfig[] = [];
  const childSteps: EditorPipelineStep[] = [];

  for (const transform of step.concat_transform) {
    if (Array.isArray(transform)) {
      branches.push(transform.map(item => convertStepToEditor(item)));
      branchConfigs.push(transform.map(item => buildConcatTransformConfigEntry(item)));
      transform.forEach(item => childSteps.push(convertStepToEditor(item)));
    } else {
      branches.push([convertStepToEditor(transform)]);
      childSteps.push(convertStepToEditor(transform));
      branchConfigs.push([buildConcatTransformConfigEntry(transform)]);
    }
  }

  return {
    id: generateStepId(),
    type: "flow",
    subType: "concat_transform",
    name: "ConcatTransform",
    params: {},
    children: childSteps,
    branches,
    concatTransformConfig: {
      branches: branchConfigs,
    },
  };
}

export function convertEditorSampleAugmentationToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  if (step.children && step.children.length > 0) {
    const transformers = step.children.map(child =>
      convertEditorStepToNirs4all(child)
    ) as Array<string | Nirs4allClassStep>;
    return {
      sample_augmentation: {
        transformers,
        count: (step.params.count as number) || 1,
        selection: (step.params.selection as string) || "random",
        random_state: (step.params.random_state as number) ?? 42,
        variation_scope: (step.params.variation_scope as string) || "sample",
      },
    };
  }

  return {
    sample_augmentation: {
      transformers: [],
      count: 1,
      selection: "random",
    },
  };
}

export function convertEditorFeatureAugmentationToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  if (step.children && step.children.length > 0) {
    const isGeneratorMode = step.generatorKind === "or";

    if (isGeneratorMode) {
      const orList = step.children.map(child => convertEditorStepToNirs4all(child));
      const augConfig: Record<string, unknown> = { _or_: orList };
      if (step.generatorOptions?.pick !== undefined) {
        augConfig.pick = step.generatorOptions.pick;
      }
      if (step.generatorOptions?.count !== undefined) {
        augConfig.count = step.generatorOptions.count;
      }
      const result: Record<string, unknown> = { feature_augmentation: augConfig };
      if (step.params.action) {
        result.action = step.params.action;
      }
      return result as Nirs4allStep;
    }

    const transformList = step.children.map(child => convertEditorStepToNirs4all(child));
    const result: Record<string, unknown> = { feature_augmentation: transformList };
    if (step.params.action) {
      result.action = step.params.action;
    }
    return result as Nirs4allStep;
  }

  return { feature_augmentation: [] };
}

export function convertEditorSampleFilterToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter
): Nirs4allStep {
  const origin = step.filterOrigin || "sample_filter";
  const filters = (step.children ?? []).map(child =>
    convertEditorStepToNirs4all(child)
  ) as Array<string | Nirs4allClassStep>;

  if (origin === "sample_filter") {
    return {
      sample_filter: {
        filters,
        mode: (step.params.mode as string) || "any",
        report: (step.params.report as boolean) ?? true,
      },
    };
  }

  const wrapper: Record<string, unknown> = {
    [origin]: filters.length === 1 ? filters[0] : filters,
  };
  if (origin === "exclude" && (step.params.mode as string)) {
    wrapper.mode = step.params.mode as string;
  }
  return wrapper as Nirs4allStep;
}

function exportConcatConfigTransform(
  transform: ConcatTransformBranchConfig[number],
  getExportableStepParams: ExportableStepParamsResolver
): Nirs4allStep {
  if (transform.classPath) {
    const params = getExportableStepParams(transform as EditorPipelineStep);
    if (Object.keys(params).length > 0) {
      return { class: transform.classPath, params };
    }
    return transform.classPath;
  }
  return transform.name;
}

export function convertEditorConcatTransformToNirs4all(
  step: EditorPipelineStep,
  convertEditorStepToNirs4all: EditorToNirs4allStepConverter,
  getExportableStepParams: ExportableStepParamsResolver
): Nirs4allStep {
  if (step.concatTransformConfig) {
    const branches = step.concatTransformConfig.branches.map(branch => {
      if (branch.length === 1) {
        return exportConcatConfigTransform(branch[0], getExportableStepParams);
      }
      return branch.map(transform =>
        exportConcatConfigTransform(transform, getExportableStepParams)
      );
    });

    return { concat_transform: branches };
  }

  if (step.branches?.length) {
    const branches = step.branches.map(branch =>
      branch.length === 1
        ? convertEditorStepToNirs4all(branch[0])
        : branch.map(child => convertEditorStepToNirs4all(child))
    );
    return { concat_transform: branches };
  }

  if (step.children && step.children.length > 0) {
    const transforms = step.children.map(child => convertEditorStepToNirs4all(child));
    return { concat_transform: transforms };
  }

  return { concat_transform: [] };
}

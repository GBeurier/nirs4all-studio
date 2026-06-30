import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  getDefaultParamsForStep,
  inferFunctionModelFramework,
  isFunctionModelPath,
  resolveConfiguredClassPath,
} from "./pipelineClassPathResolver";
import { castParams } from "./pipelineEditorImportConversion";

export function hydrateMissingStepParams(step: EditorPipelineStep): EditorPipelineStep {
  if (step.type === "flow" || step.type === "utility") {
    return step;
  }

  const defaults = getDefaultParamsForStep(step);
  if (Object.keys(defaults).length === 0) {
    return step;
  }

  const currentParams = castParams(step.params);
  const hydratedKeys = new Set(
    Array.isArray(step.hydratedDefaultParams)
      ? step.hydratedDefaultParams.filter(
          (key): key is string => typeof key === "string" && key.length > 0
        )
      : []
  );
  const mergedParams: Record<string, unknown> = { ...defaults };
  let changed = false;

  for (const [key, value] of Object.entries(currentParams)) {
    mergedParams[key] = value;
  }

  for (const key of Object.keys(defaults)) {
    if (!(key in currentParams)) {
      hydratedKeys.add(key);
      changed = true;
    }
  }

  if (!changed) {
    return step;
  }

  return {
    ...step,
    params: mergedParams,
    hydratedDefaultParams: Array.from(hydratedKeys),
  };
}

export function hydrateEditorStep(step: EditorPipelineStep): EditorPipelineStep {
  let hydrated = hydrateMissingStepParams(step);

  if (
    !hydrated.functionPath &&
    hydrated.rawNirs4all === undefined &&
    hydrated.type !== "flow" &&
    hydrated.type !== "utility"
  ) {
    const classPath = resolveConfiguredClassPath(
      hydrated.type,
      hydrated.name,
      hydrated.classPath
    );
    if (classPath.includes(".")) {
      hydrated = { ...hydrated, classPath };
    }
  }

  if (hydrated.type === "model" && !hydrated.functionPath && isFunctionModelPath(hydrated.classPath)) {
    hydrated = {
      ...hydrated,
      functionPath: hydrated.classPath,
      framework: hydrated.framework || inferFunctionModelFramework(hydrated.classPath),
    };
  }

  if (hydrated.branches) {
    hydrated = {
      ...hydrated,
      branches: hydrated.branches.map(branch => branch.map(child => hydrateEditorStep(child))),
    };
  }

  if (hydrated.children) {
    hydrated = {
      ...hydrated,
      children: hydrated.children.map(child => hydrateEditorStep(child)),
    };
  }

  return hydrated;
}

export function hydrateEditorPipelineSteps(steps: EditorPipelineStep[]): EditorPipelineStep[] {
  return steps.map(step => hydrateEditorStep(step));
}

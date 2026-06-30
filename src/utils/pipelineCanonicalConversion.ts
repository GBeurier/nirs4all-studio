/**
 * Pipeline Canonical Conversion
 * =============================
 *
 * Transitional browser-side orchestration between nirs4all canonical pipeline
 * payloads and the legacy Studio editor step format.
 */

import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  convertBranchToEditor,
  convertEditorBranchToNirs4all,
  convertEditorMergeToNirs4all,
  convertMergeToEditor,
} from "./pipelineBranchMergeConversion";
import {
  convertConcatTransformToEditor,
  convertEditorConcatTransformToNirs4all,
  convertEditorFeatureAugmentationToNirs4all,
  convertEditorSampleAugmentationToNirs4all,
  convertEditorSampleFilterToNirs4all,
  convertFeatureAugmentationToEditor,
  convertFilterWrapperToEditor,
  convertSampleAugmentationToEditor,
  convertSampleFilterToEditor,
} from "./pipelineContainerConversion";
import {
  buildClassStep,
  convertEditorAugmentationToNirs4all,
  convertEditorChartToNirs4all,
  convertEditorFilterToNirs4all,
  convertEditorModelToNirs4all,
  convertEditorYProcessingToNirs4all,
  getExportableStepParams,
} from "./pipelineEditorExportConversion";
import { hydrateEditorPipelineSteps } from "./pipelineEditorHydration";
import {
  convertChartToEditor,
  convertClassPathToEditor,
  convertClassStepToEditor,
  convertCommentToEditor,
  convertModelStepToEditor,
  convertPreprocessingToEditor,
  convertSplitToEditor,
  convertUnknownStepToEditor,
  convertYProcessingToEditor,
} from "./pipelineEditorImportConversion";
import {
  convertCartesianGeneratorToEditor,
  convertChainGeneratorToEditor,
  convertEditorGeneratorToNirs4all,
  convertGridGeneratorToEditor,
  convertOrGeneratorToEditor,
  convertRangeGeneratorToEditor,
  convertSampleGeneratorToEditor,
  convertZipGeneratorToEditor,
  createNoOpEditorStep,
  createSequentialEditorStep,
} from "./pipelineGeneratorConversion";
import {
  getClassPath,
  resolveRequiredClassPath,
} from "./pipelineClassPathResolver";
import type {
  Nirs4allBranchStep,
  Nirs4allChartStep,
  Nirs4allClassStep,
  Nirs4allConcatTransformStep,
  Nirs4allFeatureAugmentationStep,
  Nirs4allFilterWrapperStep,
  Nirs4allGeneratorStep,
  Nirs4allMergeStep,
  Nirs4allModelStep,
  Nirs4allPipeline,
  Nirs4allPreprocessingStep,
  Nirs4allSampleAugmentationStep,
  Nirs4allSampleFilterStep,
  Nirs4allSplitStep,
  Nirs4allStep,
  Nirs4allYProcessingStep,
} from "./nirs4allPipelineTypes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isClassStepReference(value: unknown): value is Nirs4allClassStep {
  return isRecord(value) && typeof value.class === "string";
}

function isFunctionModelReference(
  value: unknown
): value is { function: string; params?: Record<string, unknown>; framework?: string } {
  return isRecord(value) && typeof value.function === "string";
}

function isCommentStep(step: object): step is { _comment: string } {
  return "_comment" in step && typeof (step as { _comment?: unknown })._comment === "string";
}

function isModelStep(step: object): step is Nirs4allModelStep {
  if (!("model" in step)) {
    return false;
  }
  const model = (step as { model?: unknown }).model;
  return (
    typeof model === "string" ||
    isClassStepReference(model) ||
    isFunctionModelReference(model)
  );
}

/**
 * Convert a nirs4all canonical pipeline to editor format.
 */
export function importFromNirs4all(pipeline: Nirs4allPipeline | Nirs4allStep[]): EditorPipelineStep[] {
  const steps = Array.isArray(pipeline) ? pipeline : pipeline.pipeline;
  return hydrateEditorPipelineSteps(steps.map(step => convertStepToEditor(step)));
}

function convertStepToEditor(step: Nirs4allStep): EditorPipelineStep {
  if (step === null) {
    return createNoOpEditorStep();
  }

  if (typeof step === "string") {
    return convertClassPathToEditor(step);
  }

  if (Array.isArray(step)) {
    return createSequentialEditorStep(
      step.map(item => item === null ? createNoOpEditorStep() : convertStepToEditor(item))
    );
  }

  if (isCommentStep(step)) {
    return convertCommentToEditor(step._comment);
  }

  if (isModelStep(step)) {
    return convertModelStepToEditor(step);
  }

  if ("y_processing" in step) {
    return convertYProcessingToEditor(step as Nirs4allYProcessingStep);
  }

  if ("split" in step) {
    return convertSplitToEditor(step as Nirs4allSplitStep);
  }

  if ("branch" in step) {
    return convertBranchToEditor(step as Nirs4allBranchStep, convertStepToEditor);
  }

  if ("merge" in step) {
    return convertMergeToEditor(step as Nirs4allMergeStep);
  }

  if ("sample_augmentation" in step) {
    return convertSampleAugmentationToEditor(step as Nirs4allSampleAugmentationStep, convertStepToEditor);
  }

  if ("feature_augmentation" in step) {
    return convertFeatureAugmentationToEditor(step as Nirs4allFeatureAugmentationStep, convertStepToEditor);
  }

  if ("sample_filter" in step) {
    return convertSampleFilterToEditor(step as Nirs4allSampleFilterStep, convertStepToEditor);
  }

  if ("exclude" in step || "tag" in step) {
    return convertFilterWrapperToEditor(step as Nirs4allFilterWrapperStep, convertStepToEditor);
  }

  if ("concat_transform" in step) {
    return convertConcatTransformToEditor(step as Nirs4allConcatTransformStep, convertStepToEditor);
  }

  if ("preprocessing" in step) {
    return convertPreprocessingToEditor(step as Nirs4allPreprocessingStep);
  }

  if ("chart_2d" in step || "chart_y" in step) {
    return convertChartToEditor(step as Nirs4allChartStep);
  }

  if ("_or_" in step) {
    return convertOrGeneratorToEditor(step as Nirs4allGeneratorStep, convertStepToEditor);
  }
  if ("_cartesian_" in step) {
    return convertCartesianGeneratorToEditor(step as Nirs4allGeneratorStep, convertStepToEditor);
  }
  if ("_range_" in step || "_log_range_" in step) {
    return convertRangeGeneratorToEditor(step as Nirs4allGeneratorStep);
  }
  if ("_grid_" in step) {
    return convertGridGeneratorToEditor(step as Nirs4allGeneratorStep);
  }
  if ("_zip_" in step) {
    return convertZipGeneratorToEditor(step as Nirs4allGeneratorStep);
  }
  if ("_chain_" in step) {
    return convertChainGeneratorToEditor(step as Nirs4allGeneratorStep, convertStepToEditor);
  }
  if ("_sample_" in step) {
    return convertSampleGeneratorToEditor(step as Nirs4allGeneratorStep);
  }

  if ("class" in step) {
    return convertClassStepToEditor(step);
  }

  return convertUnknownStepToEditor(step);
}

/**
 * Convert editor steps to nirs4all canonical format.
 */
export function exportToNirs4all(steps: EditorPipelineStep[], options?: {
  name?: string;
  description?: string;
  includeWrapper?: boolean;
}): Nirs4allPipeline | Nirs4allStep[] {
  const nirs4allSteps = steps.map(step => convertEditorStepToNirs4all(step));

  if (options?.includeWrapper) {
    return {
      name: options.name || "pipeline",
      description: options.description || "",
      pipeline: nirs4allSteps,
    };
  }

  return nirs4allSteps;
}

function convertEditorStepToNirs4all(step: EditorPipelineStep): Nirs4allStep {
  if (step.rawNirs4all !== undefined) {
    return step.rawNirs4all as Nirs4allStep;
  }

  const classPath = step.type === "flow" || step.type === "utility"
    ? step.classPath || getClassPath(step.type, step.name)
    : resolveRequiredClassPath(step);

  if (step.type === "flow" && step.subType) {
    switch (step.subType) {
      case "branch":
        return convertEditorBranchToNirs4all(step, convertEditorStepToNirs4all);
      case "merge":
        return convertEditorMergeToNirs4all(step);
      case "generator":
        return convertEditorGeneratorToNirs4all(step, convertEditorStepToNirs4all);
      case "sample_augmentation":
        return convertEditorSampleAugmentationToNirs4all(step, convertEditorStepToNirs4all);
      case "feature_augmentation":
        return convertEditorFeatureAugmentationToNirs4all(step, convertEditorStepToNirs4all);
      case "sample_filter":
        return convertEditorSampleFilterToNirs4all(step, convertEditorStepToNirs4all);
      case "concat_transform":
        return convertEditorConcatTransformToNirs4all(
          step,
          convertEditorStepToNirs4all,
          getExportableStepParams
        );
      case "sequential":
        if (step.children?.length) {
          return step.children.map(child => convertEditorStepToNirs4all(child)) as unknown as Nirs4allStep;
        }
        return buildClassStep(step, classPath);
    }
  }

  if (step.type === "utility" && step.subType) {
    switch (step.subType) {
      case "chart":
        return convertEditorChartToNirs4all(step);
      case "comment":
        return { _comment: step.params.text as string || "" } as unknown as Nirs4allStep;
      case "generator":
        return convertEditorGeneratorToNirs4all(step, convertEditorStepToNirs4all);
    }
  }

  switch (step.type) {
    case "model":
      return convertEditorModelToNirs4all(step, classPath);

    case "y_processing":
      return convertEditorYProcessingToNirs4all(step, classPath);

    case "augmentation":
      return convertEditorAugmentationToNirs4all(step, convertEditorStepToNirs4all);

    case "filter":
      return convertEditorFilterToNirs4all(step, convertEditorStepToNirs4all);

    default:
      return buildClassStep(step, classPath);
  }
}

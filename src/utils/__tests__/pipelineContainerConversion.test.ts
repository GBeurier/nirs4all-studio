import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
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
} from "../pipelineContainerConversion";
import type {
  Nirs4allClassStep,
  Nirs4allConcatTransformStep,
  Nirs4allFeatureAugmentationStep,
  Nirs4allFilterWrapperStep,
  Nirs4allSampleAugmentationStep,
  Nirs4allSampleFilterStep,
  Nirs4allStep,
} from "../nirs4allPipelineTypes";

function stepName(classPath: string): string {
  return classPath.split(".").pop() || classPath;
}

function isClassStep(step: Nirs4allStep): step is Nirs4allClassStep {
  return (
    step !== null &&
    typeof step === "object" &&
    !Array.isArray(step) &&
    "class" in step &&
    typeof step.class === "string"
  );
}

function editorStepFromCanonical(step: Nirs4allStep): EditorPipelineStep {
  if (step === null) {
    return {
      id: "editor-noop",
      type: "utility",
      subType: "comment",
      name: "NoOp",
      params: {},
      isNoOp: true,
      rawNirs4all: null,
    };
  }

  if (typeof step === "string") {
    return {
      id: `editor-${step}`,
      type: "preprocessing",
      name: stepName(step),
      params: {},
      classPath: step,
    };
  }

  if (Array.isArray(step)) {
    return {
      id: "editor-sequential",
      type: "flow",
      subType: "sequential",
      name: "Sequential",
      params: {},
      children: step.map(editorStepFromCanonical),
    };
  }

  if (isClassStep(step)) {
    return {
      id: `editor-${step.class}`,
      type: "preprocessing",
      name: stepName(step.class),
      params: step.params || {},
      classPath: step.class,
    };
  }

  return {
    id: "editor-raw",
    type: "preprocessing",
    name: "RawStep",
    params: {},
    rawNirs4all: step,
  };
}

function canonicalStepFromEditor(step: EditorPipelineStep): Nirs4allStep {
  if (step.rawNirs4all !== undefined) {
    return step.rawNirs4all as Nirs4allStep;
  }

  if (step.classPath) {
    if (Object.keys(step.params).length > 0) {
      return { class: step.classPath, params: step.params };
    }
    return step.classPath;
  }

  if (step.children?.length) {
    return step.children.map(canonicalStepFromEditor);
  }

  return step.name;
}

function exportableParams(step: EditorPipelineStep): Record<string, unknown> {
  return { ...step.params };
}

describe("pipelineContainerConversion", () => {
  it("imports and exports sample augmentation scalars and transformers", () => {
    const canonical: Nirs4allSampleAugmentationStep = {
      sample_augmentation: {
        transformers: [
          "nirs4all.operators.augmentation.random.Rotate_Translate",
          {
            class: "nirs4all.operators.augmentation.random.Jitter",
            params: { scale: 0.1 },
          },
        ],
        count: 2,
        selection: "all",
        random_state: 7,
        variation_scope: "batch",
      },
    };

    const editor = convertSampleAugmentationToEditor(canonical, editorStepFromCanonical);

    expect(editor).toMatchObject({
      type: "flow",
      subType: "sample_augmentation",
      params: {
        count: 2,
        selection: "all",
        random_state: 7,
        variation_scope: "batch",
      },
    });
    expect(editor.children?.map((child) => child.name)).toEqual(["Rotate_Translate", "Jitter"]);
    expect(convertEditorSampleAugmentationToNirs4all(editor, canonicalStepFromEditor)).toEqual(canonical);
  });

  it("round-trips direct-list feature augmentation from children", () => {
    const canonical: Nirs4allFeatureAugmentationStep = {
      feature_augmentation: [
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
        { class: "nirs4all.operators.transforms.signal.Gaussian", params: { sigma: 2 } },
      ],
      action: "add",
    };

    const editor = convertFeatureAugmentationToEditor(canonical, editorStepFromCanonical);

    expect(editor).toMatchObject({
      type: "flow",
      subType: "feature_augmentation",
      params: { action: "add" },
    });
    expect(editor.generatorKind).toBeUndefined();
    expect(editor.children?.map((child) => child.name)).toEqual(["StandardNormalVariate", "Gaussian"]);
    expect(convertEditorFeatureAugmentationToNirs4all(editor, canonicalStepFromEditor)).toEqual(canonical);
  });

  it("round-trips generator feature augmentation with no-op alternatives", () => {
    const canonical: Nirs4allFeatureAugmentationStep = {
      feature_augmentation: {
        _or_: [
          "nirs4all.operators.transforms.scalers.StandardNormalVariate",
          null,
          {
            class: "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection",
            params: { reference: "mean" },
          },
        ],
        pick: 1,
        count: 2,
      },
      action: "extend",
    };

    const editor = convertFeatureAugmentationToEditor(canonical, editorStepFromCanonical);

    expect(editor.generatorKind).toBe("or");
    expect(editor.generatorOptions).toMatchObject({ pick: 1, count: 2 });
    expect(editor.children?.[1]).toMatchObject({ isNoOp: true, rawNirs4all: null });
    expect(editor.branches?.[1]?.[0]).toMatchObject({ isNoOp: true, rawNirs4all: null });
    expect(convertEditorFeatureAugmentationToNirs4all(editor, canonicalStepFromEditor)).toEqual(canonical);
  });

  it("imports and exports sample filters and filter wrappers", () => {
    const sampleFilter: Nirs4allSampleFilterStep = {
      sample_filter: {
        filters: [
          { class: "nirs4all.operators.filters.YOutlierFilter", params: { method: "iqr" } },
        ],
        mode: "all",
        report: false,
      },
    };
    const excludeWrapper: Nirs4allFilterWrapperStep = {
      exclude: "nirs4all.operators.filters.SpectralQualityFilter",
      mode: "any",
    };
    const tagWrapper: Nirs4allFilterWrapperStep = {
      tag: [
        "nirs4all.operators.filters.SpectralQualityFilter",
        "nirs4all.operators.filters.InstrumentFilter",
      ],
    };

    const sampleEditor = convertSampleFilterToEditor(sampleFilter, editorStepFromCanonical);
    const excludeEditor = convertFilterWrapperToEditor(excludeWrapper, editorStepFromCanonical);
    const tagEditor = convertFilterWrapperToEditor(tagWrapper, editorStepFromCanonical);

    expect(sampleEditor).toMatchObject({
      subType: "sample_filter",
      filterOrigin: "sample_filter",
      params: { mode: "all", report: false },
    });
    expect(excludeEditor).toMatchObject({ filterOrigin: "exclude", params: { mode: "any" } });
    expect(tagEditor).toMatchObject({ filterOrigin: "tag", params: {} });
    expect(convertEditorSampleFilterToNirs4all(sampleEditor, canonicalStepFromEditor)).toEqual(sampleFilter);
    expect(convertEditorSampleFilterToNirs4all(excludeEditor, canonicalStepFromEditor)).toEqual(excludeWrapper);
    expect(convertEditorSampleFilterToNirs4all(tagEditor, canonicalStepFromEditor)).toEqual(tagWrapper);
  });

  it("preserves concat transform branch structure on import and export", () => {
    const canonical: Nirs4allConcatTransformStep = {
      concat_transform: [
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
        [
          { class: "nirs4all.operators.transforms.signal.Gaussian", params: { sigma: 2 } },
          "nirs4all.operators.transforms.nirs.MultiplicativeScatterCorrection",
        ],
      ],
    };

    const editor = convertConcatTransformToEditor(canonical, editorStepFromCanonical);

    expect(editor).toMatchObject({
      type: "flow",
      subType: "concat_transform",
      children: expect.arrayContaining([
        expect.objectContaining({ name: "StandardNormalVariate" }),
        expect.objectContaining({ name: "Gaussian" }),
        expect.objectContaining({ name: "MultiplicativeScatterCorrection" }),
      ]),
    });
    expect(editor.branches?.map((branch) => branch.length)).toEqual([1, 2]);
    expect(editor.concatTransformConfig?.branches.map((branch) => branch.length)).toEqual([1, 2]);
    expect(convertEditorConcatTransformToNirs4all(
      editor,
      canonicalStepFromEditor,
      exportableParams
    )).toEqual(canonical);
  });

  it("exports concat transform from legacy config and flat children fallbacks", () => {
    const configStep: EditorPipelineStep = {
      id: "concat-config",
      type: "flow",
      subType: "concat_transform",
      name: "ConcatTransform",
      params: {},
      concatTransformConfig: {
        branches: [
          [{ id: "snv", name: "SNV", classPath: "SNV", params: {}, enabled: true }],
          [{ id: "gaussian", name: "Gaussian", classPath: "Gaussian", params: { sigma: 1 } }],
        ],
      },
    };
    const flatStep: EditorPipelineStep = {
      id: "concat-flat",
      type: "flow",
      subType: "concat_transform",
      name: "ConcatTransform",
      params: {},
      children: [
        editorStepFromCanonical("SNV"),
        editorStepFromCanonical({ class: "Gaussian", params: { sigma: 1 } } as Nirs4allClassStep),
      ],
    };

    expect(convertEditorConcatTransformToNirs4all(
      configStep,
      canonicalStepFromEditor,
      exportableParams
    )).toEqual({
      concat_transform: ["SNV", { class: "Gaussian", params: { sigma: 1 } }],
    });
    expect(convertEditorConcatTransformToNirs4all(
      flatStep,
      canonicalStepFromEditor,
      exportableParams
    )).toEqual({
      concat_transform: ["SNV", { class: "Gaussian", params: { sigma: 1 } }],
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildStudioTuningSpacePreview } from "@/components/pipeline-editor/finetuning/tuningSpacePreview";
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
  extractInlineComponentParams,
} from "../pipelineEditorImportConversion";
import type {
  Nirs4allClassStep,
  Nirs4allModelStep,
  Nirs4allSplitStep,
  Nirs4allYProcessingStep,
} from "../nirs4allPipelineTypes";

describe("pipelineEditorImportConversion", () => {
  it("imports string class paths, chart strings, comments, and class steps", () => {
    expect(convertClassPathToEditor("chart_2d")).toMatchObject({
      type: "utility",
      subType: "chart",
      name: "chart_2d",
      chartConfig: { chartType: "chart_2d" },
    });
    expect(convertClassPathToEditor(
      "nirs4all.operators.transforms.scalers.StandardNormalVariate"
    )).toMatchObject({
      type: "preprocessing",
      name: "SNV",
      classPath: "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    });
    expect(convertCommentToEditor("note")).toMatchObject({
      type: "utility",
      subType: "comment",
      params: { text: "note" },
    });
    expect(convertClassStepToEditor({
      class: "sklearn.preprocessing._data.MinMaxScaler",
      params: { clip: true },
    })).toMatchObject({
      type: "preprocessing",
      name: "MinMaxScaler",
      params: { clip: true },
      classPath: "sklearn.preprocessing._data.MinMaxScaler",
    });
  });

  it("extracts inline params and imports split/preprocessing/y-processing wrappers", () => {
    expect(extractInlineComponentParams({
      split: "KennardStoneSplitter",
      test_size: 0.25,
      _grid_: { ignored: [1, 2] },
    }, ["split"])).toEqual({ test_size: 0.25 });

    expect(convertSplitToEditor({
      split: {
        class: "nirs4all.operators.splitters.splitters.KennardStoneSplitter",
        params: { test_size: 0.2 },
      },
      random_state: 42,
    } as Nirs4allSplitStep)).toMatchObject({
      type: "splitting",
      name: "KennardStone",
      params: { test_size: 0.2, random_state: 42 },
    });

    expect(convertPreprocessingToEditor({
      preprocessing: {
        class: "nirs4all.operators.transforms.signal.Gaussian",
        params: { sigma: 2 },
      } as Nirs4allClassStep,
      copy: false,
    })).toMatchObject({
      name: "Gaussian",
      params: { sigma: 2, copy: false },
    });

    expect(convertYProcessingToEditor({
      y_processing: {
        class: "sklearn.preprocessing._data.StandardScaler",
        params: { with_std: false },
      },
      with_mean: false,
    } as Nirs4allYProcessingStep)).toMatchObject({
      type: "y_processing",
      name: "StandardScaler",
      params: { with_std: false, with_mean: false },
    });
  });

  it("imports model class/function definitions with tuning metadata", () => {
    const classModel = convertModelStepToEditor({
      model: {
        class: "sklearn.linear_model.Ridge",
        params: { alpha: 1.5 },
      },
      name: "ridge-main",
      finetune_params: {
        n_trials: 8,
        approach: "single",
        eval_mode: "best",
        sample: "random",
        verbose: 1,
        storage: "sqlite:///optuna-study.db",
        study_name: "ridge-study",
        model_params: {
          alpha: ["log_float", 0.001, 10],
        },
        train_params: {
          epochs: ["int", 10, 100],
        },
      },
      train_params: {
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001,
        patience: 5,
      },
      _grid_: { solver: ["auto", "svd"] },
    } as Nirs4allModelStep);

    const functionModel = convertModelStepToEditor({
      model: {
        function: "nirs4all.operators.models.pytorch.nicon.nicon",
        framework: "pytorch",
        params: { dropout_rate: 0.2 },
      },
    });

    expect(classModel).toMatchObject({
      type: "model",
      name: "Ridge",
      params: { alpha: 1.5 },
      customName: "ridge-main",
      trainingConfig: {
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001,
        patience: 5,
      },
      paramSweeps: {
        solver: { type: "or", choices: ["auto", "svd"] },
      },
    });
    expect(classModel.finetuneConfig).toMatchObject({
      enabled: true,
      n_trials: 8,
      sample: "random",
      verbose: 1,
      storage: "sqlite:///optuna-study.db",
      study_name: "ridge-study",
      model_params: [
        { name: "alpha", type: "log_float", low: 0.001, high: 10 },
      ],
      train_params: [
        { name: "epochs", type: "int", low: 10, high: 100 },
      ],
    });
    const tuningSpacePreview = buildStudioTuningSpacePreview(classModel.finetuneConfig!);
    expect(tuningSpacePreview.issues).toEqual([]);
    expect(tuningSpacePreview.preview?.parameters.map((parameter) => ({
      path: parameter.path,
      spec: parameter.spec,
    }))).toEqual([
      {
        path: "model.alpha",
        spec: ["log_float", 0.001, 10],
      },
      {
        path: "train.epochs",
        spec: ["int", 10, 100],
      },
    ]);
    expect(functionModel).toMatchObject({
      type: "model",
      name: "nicon",
      params: { dropout_rate: 0.2 },
      functionPath: "nirs4all.operators.models.pytorch.nicon.nicon",
      framework: "pytorch",
    });
  });

  it("imports chart objects and preserves unsupported raw steps", () => {
    expect(convertChartToEditor({
      chart_y: {
        include_excluded: true,
        palette: "target",
      },
    })).toMatchObject({
      type: "utility",
      subType: "chart",
      name: "chart_y",
      params: {
        include_excluded: true,
        palette: "target",
      },
      chartConfig: {
        chartType: "chart_y",
        include_excluded: true,
        palette: "target",
      },
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const raw = { unsupported: true } as unknown as Nirs4allClassStep;
    expect(convertUnknownStepToEditor(raw)).toMatchObject({
      type: "preprocessing",
      name: "Unknown",
      rawNirs4all: raw,
    });
    expect(warnSpy).toHaveBeenCalledWith("Unknown step type:", raw);
    warnSpy.mockRestore();
  });
});

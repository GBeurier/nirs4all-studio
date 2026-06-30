import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  buildClassStep,
  convertEditorAugmentationToNirs4all,
  convertEditorChartToNirs4all,
  convertEditorFilterToNirs4all,
  convertEditorModelToNirs4all,
  convertEditorYProcessingToNirs4all,
  getExportableStepParams,
} from "../pipelineEditorExportConversion";
import type { Nirs4allStep } from "../nirs4allPipelineTypes";

function canonicalStepFromEditor(step: EditorPipelineStep): Nirs4allStep {
  if (step.classPath) {
    if (Object.keys(step.params).length > 0) {
      return { class: step.classPath, params: step.params };
    }
    return step.classPath;
  }
  return step.name;
}

describe("pipelineEditorExportConversion", () => {
  it("filters only hydrated default params that still match registry defaults", () => {
    const params = getExportableStepParams({
      id: "bayes",
      type: "model",
      name: "BayesianRidge",
      params: {
        max_iter: 300,
        tol: 0.002,
        alpha_1: 1e-6,
      },
      hydratedDefaultParams: ["max_iter", "tol"],
    });

    expect(params).toEqual({
      tol: 0.002,
      alpha_1: 1e-6,
    });
  });

  it("builds class steps while dropping editor/internal params", () => {
    const classStep = buildClassStep({
      id: "gaussian",
      type: "preprocessing",
      name: "Gaussian",
      params: {
        sigma: 2,
        _uiExpanded: true,
      },
    }, "nirs4all.operators.transforms.signal.Gaussian");

    const emptyStep = buildClassStep({
      id: "snv",
      type: "preprocessing",
      name: "SNV",
      params: {},
    }, "nirs4all.operators.transforms.scalers.StandardNormalVariate");

    expect(classStep).toEqual({
      class: "nirs4all.operators.transforms.signal.Gaussian",
      params: { sigma: 2 },
    });
    expect(emptyStep).toBe("nirs4all.operators.transforms.scalers.StandardNormalVariate");
  });

  it("exports class and function model definitions with tuning metadata", () => {
    const classModel = convertEditorModelToNirs4all({
      id: "ridge",
      type: "model",
      name: "Ridge",
      params: { alpha: 1.5 },
      customName: "ridge-main",
      finetuneConfig: {
        enabled: true,
        n_trials: 8,
        approach: "single",
        eval_mode: "best",
        sample: "random",
        verbose: 1,
        model_params: [{ name: "alpha", type: "log_float", low: 0.001, high: 10 }],
        train_params: [{ name: "epochs", type: "int", low: 10, high: 100 }],
      },
      trainingConfig: {
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001,
        patience: 5,
      },
      paramSweeps: {
        solver: { type: "or", choices: ["auto", "svd"] },
      },
    }, "sklearn.linear_model.Ridge");

    const functionModel = convertEditorModelToNirs4all({
      id: "nicon",
      type: "model",
      name: "nicon",
      params: { dropout_rate: 0.2 },
      functionPath: "nirs4all.operators.models.pytorch.nicon.nicon",
      framework: "pytorch",
    }, "nirs4all.operators.models.pytorch.nicon.nicon");

    expect(classModel).toEqual({
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
        model_params: {
          alpha: { type: "log_float", low: 0.001, high: 10, log: true },
        },
        train_params: {
          epochs: { type: "int", low: 10, high: 100 },
        },
      },
      train_params: {
        epochs: 100,
        batch_size: 32,
        learning_rate: 0.001,
        patience: 5,
      },
      _grid_: { solver: ["auto", "svd"] },
    });
    expect(functionModel).toEqual({
      model: {
        function: "nirs4all.operators.models.pytorch.nicon.nicon",
        params: { dropout_rate: 0.2 },
        framework: "pytorch",
      },
    });
  });

  it("exports y-processing and chart utility nodes", () => {
    expect(convertEditorYProcessingToNirs4all({
      id: "y",
      type: "y_processing",
      name: "StandardScaler",
      params: { with_mean: false },
    }, "sklearn.preprocessing.StandardScaler")).toEqual({
      y_processing: {
        class: "sklearn.preprocessing.StandardScaler",
        params: { with_mean: false },
      },
    });

    expect(convertEditorChartToNirs4all({
      id: "chart",
      type: "utility",
      subType: "chart",
      name: "chart_2d",
      params: {},
      chartConfig: {
        chartType: "chart_2d",
        include_excluded: true,
        highlight_excluded: false,
        palette: "fold",
      },
    })).toEqual({
      chart_2d: {
        include_excluded: true,
        highlight_excluded: false,
        palette: "fold",
      },
    });
  });

  it("exports legacy augmentation/filter branch wrappers and single leaf steps", () => {
    const child: EditorPipelineStep = {
      id: "snv",
      type: "preprocessing",
      name: "SNV",
      params: {},
      classPath: "nirs4all.operators.transforms.scalers.StandardNormalVariate",
    };

    expect(convertEditorAugmentationToNirs4all({
      id: "aug",
      type: "augmentation",
      name: "SampleAugmentation",
      params: { count: 3, selection: "random", random_state: 42 },
      branches: [[child]],
    }, canonicalStepFromEditor)).toEqual({
      sample_augmentation: {
        transformers: ["nirs4all.operators.transforms.scalers.StandardNormalVariate"],
        count: 3,
        selection: "random",
        random_state: 42,
      },
    });

    expect(convertEditorFilterToNirs4all({
      id: "filter",
      type: "filter",
      name: "SampleFilter",
      params: { mode: "all", report: false },
      branches: [[child]],
    }, canonicalStepFromEditor)).toEqual({
      sample_filter: {
        filters: ["nirs4all.operators.transforms.scalers.StandardNormalVariate"],
        mode: "all",
        report: false,
      },
    });

    expect(convertEditorAugmentationToNirs4all({
      id: "noise",
      type: "augmentation",
      name: "GaussianNoise",
      params: { noise_level: 0.01 },
      classPath: "nirs4all.operators.transforms.GaussianAdditiveNoise",
    }, canonicalStepFromEditor)).toEqual({
      class: "nirs4all.operators.transforms.GaussianAdditiveNoise",
      params: { noise_level: 0.01 },
    });
  });
});

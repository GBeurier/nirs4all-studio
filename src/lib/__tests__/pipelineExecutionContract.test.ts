import { describe, expect, it } from "vitest";

import {
  formatPipelineExecutionMetricValue,
  getPipelineExecutionMetricObservations,
  getPrimaryPipelineExecutionMetrics,
  normalizePipelineExecutionConfig,
  normalizePipelineExecutionResult,
  toLegacyPipelineExecutePayload,
} from "../pipelineExecutionContract";

describe("pipelineExecutionContract", () => {
  it("normalizes legacy single-dataset execution configs", () => {
    expect(normalizePipelineExecutionConfig({
      pipelineId: "pipe-1",
      datasetId: "dataset-a",
    })).toMatchObject({
      pipelineId: "pipe-1",
      datasetId: "dataset-a",
      datasetIds: ["dataset-a"],
    });
  });

  it("projects future multi-dataset configs to the current legacy execute payload", () => {
    expect(toLegacyPipelineExecutePayload({
      pipelineId: "pipe-1",
      datasetIds: ["dataset-a", "dataset-b"],
      splitGroupByByDataset: {
        "dataset-a": "subject",
      },
      inlinePipeline: {
        name: "Inline",
        steps: [],
      },
      exportModel: false,
    })).toEqual({
      dataset_id: "dataset-a",
      verbose: 1,
      export_model: false,
      model_name: undefined,
      engine: "dag-ml",
      allow_fallback: false,
      split_group_by_by_dataset: {
        "dataset-a": "subject",
      },
      inline_pipeline: {
        name: "Inline",
        steps: [],
      },
    });
  });

  it("always projects the strict native engine contract", () => {
    expect(toLegacyPipelineExecutePayload({
      pipelineId: "pipe-1",
      datasetId: "dataset-a",
    })).toEqual({
      dataset_id: "dataset-a",
      verbose: 1,
      export_model: true,
      model_name: undefined,
      engine: "dag-ml",
      allow_fallback: false,
      split_group_by_by_dataset: {},
      inline_pipeline: null,
    });
  });

  it("preserves native finetuning optimizer persistence in inline execution payloads", () => {
    expect(toLegacyPipelineExecutePayload({
      pipelineId: "pipe-1",
      datasetId: "dataset-a",
      inlinePipeline: {
        name: "Native tuning",
        steps: [
          {
            id: "ridge",
            type: "model",
            name: "Ridge",
            params: {},
            finetuneConfig: {
              enabled: true,
              n_trials: 8,
              approach: "single",
              eval_mode: "best",
              storage: "sqlite:///optuna-study.db",
              study_name: "ridge-study",
              model_params: [
                { name: "alpha", type: "log_float", low: 0.001, high: 10 },
              ],
            },
          },
        ],
      },
    })).toMatchObject({
      engine: "dag-ml",
      inline_pipeline: {
        steps: [
          {
            finetuneConfig: {
              storage: "sqlite:///optuna-study.db",
              study_name: "ridge-study",
            },
          },
        ],
      },
    });
  });

  it("projects native robustness launch metadata to the execute payload", () => {
    expect(toLegacyPipelineExecutePayload({
      pipelineId: "pipe-1",
      datasetId: "dataset-a",
      robustness: {
        mode: "clean_frozen",
        scenarios: [
          { kind: "prediction_noise", severity: 0.1, distribution: "normal" },
        ],
        publish_evidence: {
          spectral_replay: {
            X: "dataset_partition",
            predictor_bundle: "exported_model_bundle",
            destination: "result_metadata.robustness_evidence",
            fail_closed: true,
          },
        },
      },
    })).toMatchObject({
      robustness: {
        mode: "clean_frozen",
        scenarios: [
          { kind: "prediction_noise", severity: 0.1, distribution: "normal" },
        ],
        publish_evidence: {
          spectral_replay: {
            X: "dataset_partition",
            predictor_bundle: "exported_model_bundle",
            destination: "result_metadata.robustness_evidence",
            fail_closed: true,
          },
        },
      },
    });
  });

  it("normalizes metric observations from generic execution results", () => {
    const result = normalizePipelineExecutionResult({
      success: true,
      metrics: {
        rmse: 0.12345,
        r2: 0.91,
        balanced_accuracy: 0.8,
      },
    });

    expect(result.metricObservations).toEqual([
      { key: "rmse", label: "Rmse", value: 0.12345 },
      { key: "r2", label: "R²", value: 0.91 },
      { key: "balanced_accuracy", label: "Balanced Accuracy", value: 0.8 },
    ]);
    expect(getPrimaryPipelineExecutionMetrics(result).map((metric) => metric.key)).toEqual([
      "rmse",
      "r2",
      "balanced_accuracy",
    ]);
    expect(formatPipelineExecutionMetricValue({ key: "r2", label: "R²", value: 0.91 })).toBe("91.00%");
  });

  it("merges explicit metric observations with legacy metrics without dropping context", () => {
    const result = normalizePipelineExecutionResult({
      success: true,
      metrics: {
        rmse: 0.4,
        r2: 0.92,
        mae: 0.11,
      },
      metricObservations: [
        {
          key: "rmse",
          label: "RMSE glucose",
          value: 0.38,
          target: "glucose",
          partition: "test",
          aggregation: "mean",
          dataset: "dataset-a",
          datasetId: "dataset-a-id",
          source: "cross-validation",
          dimensions: {
            target: "glucose",
            fold: 1,
            multimodal: true,
          },
        },
        {
          key: "score",
          label: "Score",
          value: 0.83,
          dimensions: {
            target: "glucose",
          },
        },
      ],
    });

    expect(result.metricObservations).toEqual([
      {
        key: "rmse",
        label: "RMSE glucose",
        value: 0.38,
        target: "glucose",
        partition: "test",
        aggregation: "mean",
        dataset: "dataset-a",
        datasetId: "dataset-a-id",
        source: "cross-validation",
        dimensions: {
          target: "glucose",
          fold: 1,
          multimodal: true,
        },
      },
      {
        key: "score",
        label: "Score",
        value: 0.83,
        dimensions: {
          target: "glucose",
        },
      },
      { key: "r2", label: "R²", value: 0.92 },
      { key: "mae", label: "Mae", value: 0.11 },
    ]);
    expect(getPrimaryPipelineExecutionMetrics(result).map((metric) => metric.key)).toEqual([
      "rmse",
      "r2",
      "mae",
    ]);
  });

  it("exposes a stable read-model helper for mixed metric observations", () => {
    expect(getPipelineExecutionMetricObservations({
      metrics: {
        rmse: 0.25,
        r2: 0.8,
      },
      metricObservations: [
        {
          key: "rmse",
          label: "",
          value: 0.22,
          dimensions: {
            target: "protein",
          },
        },
      ],
    })).toEqual([
      {
        key: "rmse",
        label: "Rmse",
        value: 0.22,
        dimensions: {
          target: "protein",
        },
      },
      { key: "r2", label: "R²", value: 0.8 },
    ]);
  });
});

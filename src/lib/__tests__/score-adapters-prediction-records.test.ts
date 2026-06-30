import { describe, expect, it } from "vitest";

import {
  predictionRecordBestParams,
  predictionRecordToRow,
} from "../score-adapters-prediction-records";
import { predictionRecordToRow as publicPredictionRecordToRow } from "../score-adapters";
import type { PredictionRecord } from "@/types/linked-workspaces";

function makePredictionRecord(overrides: Partial<PredictionRecord> = {}): PredictionRecord {
  return {
    id: overrides.id ?? "pred-1",
    source_dataset: overrides.source_dataset ?? "source-dataset",
    source_file: overrides.source_file ?? "predictions.meta.parquet",
    dataset_name: overrides.dataset_name ?? "fallback-dataset",
    model_name: overrides.model_name ?? "PLSRegression",
    partition: overrides.partition ?? "test",
    scores: overrides.scores ?? null,
    ...overrides,
  };
}

describe("predictionRecordBestParams", () => {
  it("returns non-empty object params from objects or JSON strings", () => {
    expect(predictionRecordBestParams({
      best_params: { n_components: 8 },
    })).toEqual({ n_components: 8 });

    expect(predictionRecordBestParams({
      best_params: JSON.stringify({ alpha: 0.1, solver: "svd" }),
    })).toEqual({ alpha: 0.1, solver: "svd" });
  });

  it("ignores empty, invalid, and non-object best params payloads", () => {
    expect(predictionRecordBestParams({ best_params: {} })).toBeNull();
    expect(predictionRecordBestParams({ best_params: "" })).toBeNull();
    expect(predictionRecordBestParams({ best_params: "not-json" })).toBeNull();
    expect(predictionRecordBestParams({ best_params: null })).toBeNull();
  });
});

describe("predictionRecordToRow", () => {
  it("projects prediction identity, provenance, scores, and scalar fields", () => {
    const row = predictionRecordToRow(makePredictionRecord({
      id: "pred-42",
      trace_id: "trace-42",
      source_dataset: "workspace-source",
      dataset_name: "display-dataset",
      model_name: "SVR",
      model_classname: "sklearn.svm.SVR",
      preprocessings: "SNV",
      fold_id: "3",
      partition: "val",
      n_samples: 17,
      metric: "rmse",
      task_type: "regression",
      scores: JSON.stringify({
        val: { rmse: "0.23", ignored: "n/a" },
        test: { r2: 0.91 },
        train: { rmse: 0.11 },
      }),
      best_params: JSON.stringify({ C: 10 }),
      test_score: 0.24,
      val_score: 0.23,
      train_score: 0.11,
    }));

    expect(row).toMatchObject({
      id: "pred-42",
      chainId: "trace-42",
      datasetName: "workspace-source",
      modelName: "SVR",
      modelClass: "sklearn.svm.SVR",
      preprocessings: "SNV",
      bestParams: { C: 10 },
      cardType: "train",
      foldId: "3",
      partition: "val",
      nSamplesEval: 17,
      metric: "rmse",
      taskType: "regression",
      primaryTestScore: 0.24,
      primaryValScore: 0.23,
      primaryTrainScore: 0.11,
      hasRefitArtifact: false,
    });
    expect(row.valScores).toEqual({ rmse: 0.23, ignored: null });
    expect(row.testScores).toEqual({ r2: 0.91 });
    expect(row.trainScores).toEqual({ rmse: 0.11 });
  });

  it("keeps the previous row identity fallbacks", () => {
    const row = predictionRecordToRow(makePredictionRecord({
      id: "pred-without-trace",
      source_dataset: "",
      dataset_name: "dataset-fallback",
      preprocessings: "",
      metric: "",
      task_type: "",
    }));

    expect(row.chainId).toBe("pred-without-trace");
    expect(row.datasetName).toBe("dataset-fallback");
    expect(row.modelClass).toBe("");
    expect(row.preprocessings).toBeNull();
    expect(row.metric).toBeNull();
    expect(row.taskType).toBeNull();
  });

  it("classifies result rows from fold ids and only marks exact final artifacts", () => {
    expect(predictionRecordToRow(makePredictionRecord({
      fold_id: "final",
      model_artifact_id: "artifact-final",
    }))).toMatchObject({
      cardType: "refit",
      hasRefitArtifact: true,
    });

    expect(predictionRecordToRow(makePredictionRecord({
      fold_id: "final_agg",
      model_artifact_id: "artifact-agg",
    }))).toMatchObject({
      cardType: "refit",
      hasRefitArtifact: false,
    });

    expect(predictionRecordToRow(makePredictionRecord({
      fold_id: "avg",
    })).cardType).toBe("crossval");

    expect(predictionRecordToRow(makePredictionRecord({
      fold_id: "w_avg_agg",
    })).cardType).toBe("crossval");
  });

  it("preserves the public score-adapters export path", () => {
    const record = makePredictionRecord({
      id: "public-export",
      fold_id: "avg",
      scores: { val: { rmse: 0.2 } },
    });

    expect(publicPredictionRecordToRow(record)).toEqual(predictionRecordToRow(record));
  });
});

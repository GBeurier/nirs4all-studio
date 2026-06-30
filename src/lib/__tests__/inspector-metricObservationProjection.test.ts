import { describe, expect, it } from "vitest";

import {
  buildInspectorScoreRefKey,
  projectInspectorChainMetricObservations,
  projectInspectorChainsMetricObservations,
  projectInspectorMetricObservation,
  projectInspectorScoreRef,
  resolveInspectorScoreColumnFromScoreRef,
} from "@/lib/inspector/metricObservationProjection";
import type { InspectorChainSummary, ScoreRef } from "@/types/inspector";

function chain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline 1",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: null,
    preprocessing_steps: [],
    branch_path: [],
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.12,
    cv_test_score: 0.2,
    cv_train_score: null,
    cv_fold_count: 5,
    final_test_score: 0.14,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector metric observation projection", () => {
  it("projects a ScoreColumn to a generic ScoreRef", () => {
    expect(projectInspectorScoreRef(chain(), "cv_val_score")).toEqual({
      key: "metric=rmse|protocol=cross_validation|partition=validation|aggregation=fold_mean",
      metric: "rmse",
      protocol: "cross_validation",
      partition: "validation",
      aggregation: "fold_mean",
      legacyScoreColumn: "cv_val_score",
    });

    expect(projectInspectorScoreRef(chain(), "final_test_score")).toEqual({
      key: "metric=rmse|protocol=final|partition=test|aggregation=final_model",
      metric: "rmse",
      protocol: "final",
      partition: "test",
      aggregation: "final_model",
      legacyScoreColumn: "final_test_score",
    });
  });

  it("resolves a generic ScoreRef back to the legacy ScoreColumn", () => {
    expect(resolveInspectorScoreColumnFromScoreRef(projectInspectorScoreRef(chain(), "cv_val_score"))).toBe("cv_val_score");
    expect(resolveInspectorScoreColumnFromScoreRef({
      protocol: "final",
      partition: "train",
      aggregation: "final_model",
      legacyScoreColumn: "cv_val_score",
    })).toBe("final_train_score");
    expect(resolveInspectorScoreColumnFromScoreRef({
      protocol: "final",
      partition: "validation",
      aggregation: "final_model",
    })).toBeNull();
  });

  it("accepts future ScoreRef metadata without coercing it to a legacy column", () => {
    const ref: ScoreRef = {
      key: "metric=balanced_accuracy|protocol=dag_ml|partition=outer_test|aggregation=macro_mean",
      metric: "balanced_accuracy",
      protocol: "dag_ml",
      partition: "outer_test",
      aggregation: "macro_mean",
    };

    expect(resolveInspectorScoreColumnFromScoreRef(ref)).toBeNull();
    expect(resolveInspectorScoreColumnFromScoreRef({
      protocol: "dag_ml",
      partition: "outer_test",
      aggregation: "macro_mean",
      legacyScoreColumn: "outer_test_macro_mean",
    })).toBeNull();
  });

  it("does not coerce target-aware refs onto matching legacy descriptors", () => {
    expect(resolveInspectorScoreColumnFromScoreRef({
      protocol: "cross_validation",
      partition: "validation",
      aggregation: "fold_mean",
      legacyScoreColumn: "cv_val_score",
      targetIndex: 1,
      targetName: "protein",
    })).toBeNull();
  });

  it("normalizes missing metric names without losing nullable metric semantics", () => {
    const ref = projectInspectorScoreRef(chain({ metric: "  " }), "cv_test_score");

    expect(ref).toMatchObject({
      key: "metric=unknown|protocol=cross_validation|partition=test|aggregation=fold_mean",
      metric: null,
      legacyScoreColumn: "cv_test_score",
    });
    expect(buildInspectorScoreRefKey(null, "cv_test_score")).toBe(ref.key);
  });

  it("projects finite scores to MetricObservation and keeps chain context", () => {
    expect(projectInspectorMetricObservation(chain(), "cv_val_score")).toEqual({
      id: "chain-1:metric=rmse|protocol=cross_validation|partition=validation|aggregation=fold_mean",
      chainId: "chain-1",
      runId: "run-1",
      pipelineId: "pipeline-1",
      datasetName: "Corn",
      taskType: "regression",
      ref: {
        key: "metric=rmse|protocol=cross_validation|partition=validation|aggregation=fold_mean",
        metric: "rmse",
        protocol: "cross_validation",
        partition: "validation",
        aggregation: "fold_mean",
        legacyScoreColumn: "cv_val_score",
      },
      value: 0.12,
    });
  });

  it("omits missing or non-finite observations", () => {
    expect(projectInspectorMetricObservation(chain({ cv_val_score: Number.NaN }), "cv_val_score")).toBeNull();
    expect(projectInspectorMetricObservation(chain({ cv_val_score: null }), "cv_val_score")).toBeNull();
  });

  it("builds chain and collection observation lists with explicit score columns", () => {
    const left = chain({ chain_id: "left", cv_val_score: { value: 0.1 } as unknown as number });
    const right = chain({ chain_id: "right", cv_val_score: 0.2, final_test_score: null });

    expect(projectInspectorChainMetricObservations(left, ["cv_val_score", "final_test_score"]).map(observation => ({
      chainId: observation.chainId,
      value: observation.value,
      legacyScoreColumn: observation.ref.legacyScoreColumn,
    }))).toEqual([
      { chainId: "left", value: 0.1, legacyScoreColumn: "cv_val_score" },
      { chainId: "left", value: 0.14, legacyScoreColumn: "final_test_score" },
    ]);

    expect(projectInspectorChainsMetricObservations([left, right], ["cv_val_score", "final_test_score"]).map(observation => ({
      chainId: observation.chainId,
      value: observation.value,
      legacyScoreColumn: observation.ref.legacyScoreColumn,
    }))).toEqual([
      { chainId: "left", value: 0.1, legacyScoreColumn: "cv_val_score" },
      { chainId: "left", value: 0.14, legacyScoreColumn: "final_test_score" },
      { chainId: "right", value: 0.2, legacyScoreColumn: "cv_val_score" },
    ]);
  });
});

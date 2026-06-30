import { describe, expect, it } from "vitest";

import { projectInspectorScoreRef } from "@/lib/inspector/metricObservationProjection";
import { buildResultAnalysisEntriesFromMetricRecords } from "@/lib/inspector/resultAnalysisMetricRecords";
import type { ScoreRef } from "@/types/inspector";

function futureScoreRef(overrides: Partial<ScoreRef> = {}): ScoreRef {
  return {
    key: "metric=balanced_accuracy|protocol=dag_ml|partition=outer_test|aggregation=macro_mean",
    metric: "balanced_accuracy",
    protocol: "dag_ml",
    partition: "outer_test",
    aggregation: "macro_mean",
    ...overrides,
  };
}

describe("resultAnalysisMetricRecords", () => {
  it("retains unmapped ScoreRef metadata without projecting a legacy score column", () => {
    const entries = buildResultAnalysisEntriesFromMetricRecords([
      {
        resultId: "candidate-a",
        pipelineId: "pipe-a",
        datasetName: "Corn",
        modelClass: "DAGMLModel",
        metric: "balanced_accuracy",
        metricVersion: "dag-ml.metrics.balanced_accuracy.v2",
        backend: "dag-ml",
        scoreRef: futureScoreRef({
          targetIndex: 1,
          targetName: "protein",
          sourceIndex: 2,
          sourceName: "nir",
        }),
        score: { value: 0.81 },
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      chainId: "candidate-a::balanced_accuracy",
      metric: "balanced_accuracy",
      pipelineId: "pipe-a",
      datasetName: "Corn",
      modelClass: "DAGMLModel",
    });
    expect(entries[0].scores ?? {}).toEqual({});
    expect(entries[0].variantParams).toEqual({
      result_metadata: {
        metric_version: "dag-ml.metrics.balanced_accuracy.v2",
        backend: "dag-ml",
        score_refs: [
          {
            key: "metric=balanced_accuracy|protocol=dag_ml|partition=outer_test|aggregation=macro_mean",
            metric: "balanced_accuracy",
            protocol: "dag_ml",
            partition: "outer_test",
            aggregation: "macro_mean",
            target_index: 1,
            target_name: "protein",
            source_index: 2,
            source_name: "nir",
            score: 0.81,
          },
        ],
      },
      result_source_indexes: [0],
    });
  });

  it("keeps legacy ScoreRef records on legacy score columns", () => {
    const entries = buildResultAnalysisEntriesFromMetricRecords([
      {
        resultId: "candidate-a",
        metric: "mae",
        scoreRef: projectInspectorScoreRef({ metric: "mae" }, "cv_val_score"),
        score: 0.08,
      },
      {
        resultId: "candidate-a",
        metric: "mae",
        ref: projectInspectorScoreRef({ metric: "mae" }, "final_test_score"),
        score: 0.1,
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].scores).toEqual({
      cv_val_score: 0.08,
      final_test_score: 0.1,
    });
    expect(entries[0].variantParams).toEqual({
      result_source_indexes: [0, 1],
    });
  });

  it("appends unmapped ScoreRef metadata to an existing legacy metric entry", () => {
    const entries = buildResultAnalysisEntriesFromMetricRecords([
      {
        resultId: "candidate-a",
        metric: "rmse",
        metricVersion: "dag-ml.metrics.rmse.v1",
        backend: "dag-ml",
        scoreColumn: "validation",
        score: 0.12,
      },
      {
        resultId: "candidate-a",
        metric: "rmse",
        scoreRef: futureScoreRef({
          key: "metric=rmse|protocol=dag_ml|partition=outer_test|aggregation=median",
          metric: "rmse",
          aggregation: "median",
        }),
        score: 0.15,
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].scores).toEqual({ cv_val_score: 0.12 });
    expect(entries[0].variantParams).toEqual({
      result_metadata: {
        metric_version: "dag-ml.metrics.rmse.v1",
        backend: "dag-ml",
        score_refs: [
          {
            key: "metric=rmse|protocol=dag_ml|partition=outer_test|aggregation=median",
            metric: "rmse",
            protocol: "dag_ml",
            partition: "outer_test",
            aggregation: "median",
            score: 0.15,
          },
        ],
      },
      result_source_indexes: [0, 1],
    });
  });
});

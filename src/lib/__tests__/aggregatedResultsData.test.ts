import { describe, expect, it } from "vitest";
import {
  buildAggregatedResultsFacets,
  buildAggregatedResultsStats,
  buildAggregatedResultsSummary,
  buildPredictionViewerStateFromSiblings,
  filterAndSortAggregatedResults,
  formatAggregatedScore,
  nextAggregatedResultsSortState,
  selectBestViewerPredictionGroup,
  splitAggregatedResultsSections,
} from "../aggregatedResultsData";
import type {
  ChainSummary,
  PartitionPrediction,
} from "@/types/aggregated-predictions";

function chain(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run",
    pipeline_id: "pipe",
    chain_id: "chain",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    branch_path: null,
    source_index: null,
    model_step_idx: 0,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: null,
    cv_val_score: 0.2,
    cv_test_score: 0.3,
    cv_train_score: 0.1,
    cv_fold_count: 3,
    cv_scores: null,
    final_test_score: null,
    final_train_score: null,
    final_scores: null,
    pipeline_status: "completed",
    fold_artifacts: null,
    ...overrides,
  };
}

function prediction(overrides: Partial<PartitionPrediction> = {}): PartitionPrediction {
  return {
    prediction_id: "pred-test",
    pipeline_id: "pipe",
    chain_id: "chain",
    dataset_name: "Corn",
    model_name: "PLS",
    model_class: "PLSRegression",
    fold_id: "0",
    partition: "test",
    val_score: null,
    test_score: 0.3,
    train_score: null,
    scores: null,
    best_params: null,
    metric: "rmse",
    task_type: "regression",
    n_samples: 12,
    n_features: 4,
    preprocessings: "SNV",
    ...overrides,
  };
}

describe("aggregatedResultsData", () => {
  it("builds facets, stats, filters, and sections from chain summaries", () => {
    const chains = [
      chain({ chain_id: "a", model_name: "PLS", dataset_name: "Corn", model_class: "PLSRegression", metric: "rmse", cv_val_score: 0.3 }),
      chain({ chain_id: "b", model_name: "SVM", dataset_name: "Wheat", model_class: "SVR", metric: "mae", cv_val_score: 0.1, final_test_score: 0.12 }),
      chain({ chain_id: "c", model_name: "CNN", dataset_name: "Corn", model_class: "CNN", metric: "rmse", cv_val_score: 0.2, preprocessings: "MSC" }),
    ];

    const expectedFacets = {
      datasets: ["Corn", "Wheat"],
      modelClasses: ["CNN", "PLSRegression", "SVR"],
      metrics: ["mae", "rmse"],
    };
    const expectedStats = {
      total: 3,
      datasets: 2,
      models: 3,
      metrics: 2,
    };

    expect(buildAggregatedResultsSummary(chains)).toEqual({
      facets: expectedFacets,
      stats: expectedStats,
    });
    expect(buildAggregatedResultsFacets(chains)).toEqual(expectedFacets);
    expect(buildAggregatedResultsStats(chains)).toEqual(expectedStats);

    const filtered = filterAndSortAggregatedResults(
      chains,
      {
        search: "corn",
        datasetFilter: "all",
        modelClassFilter: "all",
        metricFilter: "rmse",
      },
      { sortKey: "cv_val", sortAsc: true },
    );

    expect(filtered.map((item) => item.chain_id)).toEqual(["c", "a"]);
    expect(splitAggregatedResultsSections(chains)).toMatchObject({
      refitFiltered: [expect.objectContaining({ chain_id: "b" })],
      cvFiltered: [
        expect.objectContaining({ chain_id: "a" }),
        expect.objectContaining({ chain_id: "c" }),
      ],
    });
  });

  it("formats scores and resolves sort state transitions", () => {
    expect(formatAggregatedScore(null)).toBe("\u2014");
    expect(formatAggregatedScore(0.123456)).toBe("0.1235");
    expect(nextAggregatedResultsSortState({ sortKey: "cv_val", sortAsc: true }, "cv_val")).toEqual({
      sortKey: "cv_val",
      sortAsc: false,
    });
    expect(nextAggregatedResultsSortState({ sortKey: "model", sortAsc: false }, "final_test")).toEqual({
      sortKey: "final_test",
      sortAsc: true,
    });
    expect(nextAggregatedResultsSortState({ sortKey: "final_test", sortAsc: true }, "dataset")).toEqual({
      sortKey: "dataset",
      sortAsc: false,
    });
  });

  it("builds prediction viewer state from sibling partitions", () => {
    const state = buildPredictionViewerStateFromSiblings([
      prediction({ prediction_id: "pred-train", partition: "train", fold_id: "1", task_type: "classification" }),
      prediction({ prediction_id: "pred-val", partition: "val", fold_id: "1", task_type: "classification" }),
      prediction({ prediction_id: "pred-test", partition: "test", fold_id: "1", task_type: "classification" }),
    ]);

    expect(state).toMatchObject({
      initialKind: "confusion",
      header: { datasetName: "Corn", foldId: "1", taskType: "classification" },
      partitions: [
        { predictionId: "pred-train", partition: "train", source: "aggregated" },
        { predictionId: "pred-val", partition: "val", source: "aggregated" },
        { predictionId: "pred-test", partition: "test", source: "aggregated" },
      ],
    });
  });

  it("selects final fold predictions before largest fold group", () => {
    expect(selectBestViewerPredictionGroup([
      prediction({ prediction_id: "fold0-test", fold_id: "0" }),
      prediction({ prediction_id: "final-test", fold_id: "final" }),
    ]).map((item) => item.prediction_id)).toEqual(["final-test"]);

    expect(selectBestViewerPredictionGroup([
      prediction({ prediction_id: "fold0-test", fold_id: "0" }),
      prediction({ prediction_id: "fold1-val", fold_id: "1", partition: "val" }),
      prediction({ prediction_id: "fold1-test", fold_id: "1", partition: "test" }),
    ]).map((item) => item.prediction_id)).toEqual(["fold1-val", "fold1-test"]);
  });
});

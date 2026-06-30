import { describe, expect, it } from "vitest";
import {
  adaptDatasetTopChainsToEnrichedDataset,
  buildResultsDatasetView,
  buildResultsMetricSelectionContext,
  filterResultsDatasets,
  selectResultsMetricSourceDatasets,
} from "../resultsPageData";
import type { TopChainResult } from "@/types/enriched-runs";
import type { DatasetTopChains } from "@/types/runs";

function chain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: "chain",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    avg_val_score: 0.2,
    avg_test_score: 0.3,
    avg_train_score: 0.1,
    fold_count: 3,
    scores: {
      val: { rmse: 0.2 },
      test: { rmse: 0.3 },
    },
    final_test_score: null,
    final_train_score: null,
    final_scores: {},
    ...overrides,
  };
}

function dataset(overrides: Partial<DatasetTopChains> = {}): DatasetTopChains {
  return {
    dataset_name: "Corn",
    linked_dataset_id: "dataset-corn",
    metric: "rmse",
    task_type: "regression",
    top_chains: [
      chain({ chain_id: "slower", avg_val_score: 0.5, avg_test_score: 0.6, final_test_score: 0.7 }),
      chain({ chain_id: "best-cv", avg_val_score: 0.1, avg_test_score: 0.2, final_test_score: 0.4 }),
      chain({ chain_id: "best-final", avg_val_score: 0.3, avg_test_score: 0.4, final_test_score: 0.05 }),
    ],
    ...overrides,
  };
}

describe("resultsPageData", () => {
  it("adapts workspace summary datasets for DatasetResultCard", () => {
    expect(adaptDatasetTopChainsToEnrichedDataset(dataset())).toMatchObject({
      dataset_name: "Corn",
      best_avg_val_score: 0.1,
      best_avg_test_score: 0.2,
      best_final_score: 0.05,
      metric: "rmse",
      task_type: "regression",
      gain_from_previous_best: null,
      pipeline_count: 3,
    });
  });

  it("filters datasets by name and keeps all datasets as metric fallback when no result matches", () => {
    const datasets = [
      dataset({ dataset_name: "Corn" }),
      dataset({ dataset_name: "Wheat" }),
    ];

    expect(filterResultsDatasets(datasets, "whe").map((item) => item.dataset_name)).toEqual(["Wheat"]);
    expect(filterResultsDatasets(datasets, "  ").map((item) => item.dataset_name)).toEqual(["Corn", "Wheat"]);

    const emptyFiltered = filterResultsDatasets(datasets, "missing");
    expect(emptyFiltered).toEqual([]);
    expect(selectResultsMetricSourceDatasets(emptyFiltered, datasets)).toBe(datasets);
  });

  it("builds the filtered results dataset view with metric fallback datasets", () => {
    const datasets = [
      dataset({ dataset_name: "Corn" }),
      dataset({ dataset_name: "Wheat" }),
    ];

    const matchedView = buildResultsDatasetView(datasets, "whe");

    expect(matchedView.filteredDatasets.map((item) => item.dataset_name)).toEqual(["Wheat"]);
    expect(matchedView.metricSourceDatasets).toBe(matchedView.filteredDatasets);
    expect(matchedView.adaptedDatasets.map((item) => item.dataset_name)).toEqual(["Wheat"]);

    const emptyView = buildResultsDatasetView(datasets, "missing");

    expect(emptyView.filteredDatasets).toEqual([]);
    expect(emptyView.metricSourceDatasets).toBe(datasets);
    expect(emptyView.adaptedDatasets).toEqual([]);
  });

  it("builds MetricSelector context from visible result datasets", () => {
    const metricContext = buildResultsMetricSelectionContext(
      [
        dataset({ dataset_name: "Corn", metric: "rmse", task_type: "regression" }),
        dataset({
          dataset_name: "Wheat",
          metric: "accuracy",
          task_type: "classification",
          top_chains: [
            chain({
              chain_id: "classifier",
              avg_val_score: 0.91,
              avg_test_score: 0.89,
              final_test_score: 0.93,
              scores: {
                val: { accuracy: 0.91 },
                test: { accuracy: 0.89 },
              },
              final_scores: { accuracy: 0.93 },
            }),
          ],
        }),
      ],
      { id: "workspace", name: "Workspace" },
    );

    expect(metricContext).toEqual({
      taskType: null,
      taskTypes: ["classification", "regression"],
      availableMetricKeys: ["rmse", "accuracy"],
    });
  });
});

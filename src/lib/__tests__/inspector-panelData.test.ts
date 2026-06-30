import { describe, expect, it } from "vitest";

import { buildInspectorMetricObservationReadModel } from "@/lib/inspector/chartInputs";
import { buildInspectorPanelData, buildInspectorPanelDataFromStore } from "@/lib/inspector/panelData";
import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(
  chainId: string,
  overrides: Partial<InspectorChainSummary> = {},
): InspectorChainSummary {
  return {
    chain_id: chainId,
    run_id: "run-1",
    pipeline_id: "pipe-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLSRegression",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: ["root"],
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "dataset-a",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.1,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector panel data", () => {
  const chains = [
    makeChain("chain-a", {
      model_class: "PLSRegression",
      dataset_name: "diesel",
      preprocessings: "SNV",
      best_params: { n_components: 8, alpha: 0.1 },
      cv_val_score: 0.12,
    }),
    makeChain("chain-b", {
      model_class: "PLSRegression",
      dataset_name: "corn",
      preprocessings: "MSC",
      best_params: { n_components: 10, alpha: 0.2 },
      cv_val_score: 0.16,
    }),
    makeChain("chain-c", {
      model_class: "RandomForestRegressor",
      dataset_name: "diesel",
      preprocessings: "MSC",
      best_params: { max_depth: 6, alpha: 0.3 },
      cv_val_score: 0.2,
    }),
  ];

  it("builds the local Inspector panel payloads from one contract", () => {
    const panelData = buildInspectorPanelData({
      chains,
      scoreColumn: "cv_val_score",
      selection: {
        heatmapXAxis: "dataset_name",
        heatmapYAxis: "model_class",
        selectedHyperParam: "alpha",
      },
      rankingLimit: 2,
    });

    expect(panelData.overviewStats.totalChains).toBe(3);
    expect(panelData.rankingsData.rankings.map(row => row.chain_id)).toEqual(["chain-a", "chain-b"]);
    expect(panelData.histogramData.total_chains).toBe(3);
    expect(panelData.chartInputs.heatmapAxes).toEqual({
      xVariable: "dataset_name",
      yVariable: "model_class",
    });
    expect(panelData.chartInputs.activeHyperParam).toBe("alpha");
    expect(panelData.heatmapData.x_variable).toBe("dataset_name");
    expect(panelData.candlestickData.category_variable).toBe("model_class");
    expect(panelData.preprocessingImpactData.total_chains).toBe(3);
    expect(panelData.hyperparameterData.points).toHaveLength(3);
    expect(panelData.branchComparisonData.total_chains).toBe(3);
  });

  it("builds panel payloads from a result analysis store", () => {
    const panelData = buildInspectorPanelDataFromStore({
      store: buildResultAnalysisStore({ chains }),
      scoreColumn: "cv_val_score",
      selection: {
        heatmapXAxis: "dataset_name",
        heatmapYAxis: "model_class",
        selectedHyperParam: "alpha",
      },
      rankingLimit: 1,
    });

    expect(panelData.overviewStats.totalChains).toBe(3);
    expect(panelData.rankingsData.rankings.map(row => row.chain_id)).toEqual(["chain-a"]);
    expect(panelData.heatmapData.cells).toHaveLength(3);
    expect(panelData.hyperparameterData.param_name).toBe("alpha");
  });

  it("uses metric-observation availability to keep score-based panel payloads populated when the requested score is absent", () => {
    const observedScoreChains = [
      makeChain("chain-a", {
        dataset_name: "diesel",
        model_class: "PLSRegression",
        preprocessings: "SNV",
        preprocessing_steps: ["SNV"],
        branch_path: ["root", "pls"],
        best_params: { alpha: 0.1 },
        cv_val_score: null,
        cv_train_score: null,
        final_test_score: 0.12,
      }),
      makeChain("chain-b", {
        dataset_name: "corn",
        model_class: "RandomForestRegressor",
        preprocessings: "MSC",
        preprocessing_steps: ["MSC"],
        branch_path: ["root", "rf"],
        best_params: { alpha: 0.2 },
        cv_val_score: null,
        cv_train_score: null,
        final_test_score: 0.18,
      }),
    ];

    const panelData = buildInspectorPanelData({
      chains: observedScoreChains,
      scoreColumn: "cv_train_score",
      metricObservations: buildInspectorMetricObservationReadModel(observedScoreChains),
      selection: {
        heatmapXAxis: "dataset_name",
        heatmapYAxis: "model_class",
        selectedHyperParam: "alpha",
      },
    });

    expect(panelData.overviewStats.scoredChains).toBe(2);
    expect(panelData.rankingsData.score_column).toBe("final_test_score");
    expect(panelData.rankingsData.total).toBe(2);
    expect(panelData.histogramData.score_column).toBe("final_test_score");
    expect(panelData.histogramData.total_chains).toBe(2);
    expect(panelData.heatmapData.score_column).toBe("final_test_score");
    expect(panelData.heatmapData.cells).toHaveLength(2);
    expect(panelData.candlestickData.score_column).toBe("final_test_score");
    expect(panelData.candlestickData.categories).toHaveLength(2);
    expect(panelData.preprocessingImpactData.score_column).toBe("final_test_score");
    expect(panelData.preprocessingImpactData.total_chains).toBe(2);
    expect(panelData.hyperparameterData.score_column).toBe("final_test_score");
    expect(panelData.hyperparameterData.points).toHaveLength(2);
    expect(panelData.branchComparisonData.score_column).toBe("final_test_score");
    expect(panelData.branchComparisonData.total_chains).toBe(2);
  });
});

import { describe, expect, it } from "vitest";

import { buildResultAnalysisStore } from "@/lib/inspector/resultAnalysisStore";
import {
  buildInspectorWorkspaceSummary,
  buildInspectorWorkspaceSummaryFromStore,
} from "@/lib/inspector/workspaceSummary";
import type { InspectorChainSummary } from "@/types/inspector";

function makeChain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-1",
    run_id: "run-1",
    pipeline_id: "pipeline-1",
    pipeline_name: "Pipeline",
    model_class: "PLSRegression",
    model_name: "PLS",
    preprocessings: "SNV",
    preprocessing_steps: ["SNV"],
    branch_path: [],
    source_index: null,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Dataset A",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.1234,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

describe("inspector workspace summary", () => {
  it("formats the best score and exposes focus metadata for the workspace strip", () => {
    expect(buildInspectorWorkspaceSummary({
      overviewStats: {
        bestScore: 0.1234,
        bestChain: makeChain({
          chain_id: "best",
          model_name: "PLS 8",
          model_class: "PLSRegression",
          metric: "rmse",
        }),
        modelCount: 2,
        datasetCount: 3,
        mixedMetrics: false,
        mixedTaskTypes: true,
      },
      focus: {
        labelChains: [{ chain_id: "chain-a", label: "PLS 8" }],
        mode: "selection",
      },
    })).toEqual({
      bestScoreLabel: "0.123",
      bestChainLabel: "PLS 8",
      focusChains: [{ chain_id: "chain-a", label: "PLS 8" }],
      focusMode: "selection",
      modelCount: 2,
      datasetCount: 3,
      mixedMetrics: false,
      mixedTaskTypes: true,
    });
  });

  it("falls back to model class and empty score labels when no score is available", () => {
    expect(buildInspectorWorkspaceSummary({
      overviewStats: {
        bestScore: null,
        bestChain: makeChain({
          chain_id: "fallback",
          model_name: null,
          model_class: "RandomForestRegressor",
          metric: "r2",
        }),
        modelCount: 1,
        datasetCount: 1,
        mixedMetrics: false,
        mixedTaskTypes: false,
      },
      focus: {
        labelChains: [],
        mode: "top",
      },
    })).toMatchObject({
      bestScoreLabel: null,
      bestChainLabel: "RandomForestRegressor",
      focusChains: [],
      focusMode: "top",
    });
  });

  it("builds the workspace summary from a result analysis store", () => {
    const store = buildResultAnalysisStore({
      chains: [
        makeChain({ chain_id: "best", model_name: "PLS 8", cv_val_score: 0.1234 }),
        makeChain({
          chain_id: "other",
          dataset_name: "Dataset B",
          metric: "mae",
          model_class: "SVR",
          model_name: null,
          cv_val_score: 0.4,
        }),
      ],
    });

    expect(buildInspectorWorkspaceSummaryFromStore({
      store,
      scoreColumn: "cv_val_score",
      focus: {
        labelChains: [{ chain_id: "best", label: "PLS 8" }],
        mode: "selection",
      },
    })).toEqual({
      bestScoreLabel: "0.123",
      bestChainLabel: "PLS 8",
      focusChains: [{ chain_id: "best", label: "PLS 8" }],
      focusMode: "selection",
      modelCount: 2,
      datasetCount: 2,
      mixedMetrics: true,
      mixedTaskTypes: false,
    });
  });

  it("keeps store-backed workspace best labels empty when the scope has no scored chains", () => {
    const store = buildResultAnalysisStore({
      chains: [makeChain({ cv_val_score: null, model_name: "Unscored" })],
    });

    expect(buildInspectorWorkspaceSummaryFromStore({
      store,
      scoreColumn: "cv_val_score",
      focus: { labelChains: [], mode: "top" },
    })).toMatchObject({
      bestScoreLabel: null,
      bestChainLabel: null,
      modelCount: 1,
      datasetCount: 1,
    });
  });
});

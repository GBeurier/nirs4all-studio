import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisStoreFromImport,
  buildResultAnalysisViewFromImport,
  buildResultAnalysisViewsFromImport,
} from "@/lib/inspector/resultAnalysisImport";
import {
  buildResultAnalysisStore,
} from "@/lib/inspector/resultAnalysisStore";
import { projectInspectorScoreRef } from "@/lib/inspector/metricObservationProjection";
import type { WorkspaceResultsResponse } from "@/api/linkedWorkspaces";
import type { ChainSummary } from "@/types/aggregated-predictions";
import type { TopChainResult } from "@/types/enriched-runs";
import type { InspectorChainSummary } from "@/types/inspector";
import type { AvailableModelsResponse } from "@/types/shap";

function chain(overrides: Partial<InspectorChainSummary> = {}): InspectorChainSummary {
  return {
    chain_id: "chain-a",
    run_id: "run-a",
    pipeline_id: "pipe-a",
    pipeline_name: "Pipeline A",
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
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 0,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

function topChain(overrides: Partial<TopChainResult> = {}): TopChainResult {
  return {
    chain_id: "top-chain-a",
    run_id: "run-a",
    pipeline_id: "pipe-a",
    pipeline_name: "Pipeline A",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    avg_val_score: 0.12,
    avg_test_score: 0.2,
    avg_train_score: 0.08,
    fold_count: 5,
    scores: {
      val: { rmse: 0.12, mae: 0.08 },
      test: { rmse: 0.2 },
    },
    cv_source_chain_id: null,
    final_test_score: 0.14,
    final_train_score: 0.1,
    final_scores: { test: { rmse: 0.14, r2: 0.9 }, train: { rmse: 0.1 } },
    final_agg_test_score: 0.13,
    final_agg_train_score: 0.09,
    final_agg_scores: { test: { rmse: 0.13 }, train: { rmse: 0.09 } },
    best_params: { n_components: 8 },
    variant_params: { variant: "a" },
    is_refit_only: false,
    synthetic_refit: false,
    ...overrides,
  };
}

function chainSummary(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run-a",
    pipeline_id: "pipe-a",
    chain_id: "summary-chain-a",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    branch_path: [],
    source_index: null,
    model_step_idx: 1,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: { n_components: 8 },
    variant_params: null,
    cv_val_score: 0.12,
    cv_test_score: null,
    cv_train_score: null,
    cv_fold_count: 5,
    cv_scores: null,
    final_test_score: 0.14,
    final_train_score: null,
    final_scores: null,
    pipeline_status: "completed",
    fold_artifacts: { final: "artifact-final" },
    ...overrides,
  };
}

describe("resultAnalysisImport", () => {
  it("passes existing stores through without rebuilding", () => {
    const store = buildResultAnalysisStore({
      chains: [chain()],
      source: { id: "existing", kind: "inspector_chain_summaries" },
    });

    expect(buildResultAnalysisStoreFromImport({ kind: "store", store })).toBe(store);
  });

  it("builds a queryable view from inspector chains", () => {
    const view = buildResultAnalysisViewFromImport(
      {
        kind: "inspector_chains",
        chains: [
          chain(),
          chain({
            chain_id: "chain-b",
            dataset_name: "Soy",
            model_class: "RandomForestRegressor",
            cv_val_score: 0.2,
          }),
        ],
        source: { id: "current", kind: "inspector_chain_summaries", label: "Current" },
      },
      {
        kind: "leaderboard",
        scoreColumn: "cv_val_score",
        query: {
          datasetNames: ["Corn"],
        },
      },
    );

    expect(view).toMatchObject({
      id: "current-leaderboard",
      source: { id: "current", kind: "inspector_chain_summaries", label: "Current" },
      chainIds: ["chain-a"],
      matchedCount: 1,
      displayedCount: 1,
    });
  });

  it("builds multiple views from metric records through one import source", () => {
    const views = buildResultAnalysisViewsFromImport(
      {
        kind: "metric_records",
        source: { id: "bench", kind: "benchmark_export", label: "Benchmark" },
        defaults: { runId: "run-b", taskType: "regression" },
        records: [
          {
            resultId: "candidate-a",
            pipelineId: "pipe-a",
            datasetName: "Corn",
            modelClass: "PLSRegression",
            metric: "rmse",
            scoreColumn: "validation",
            score: 0.12,
          },
          {
            resultId: "candidate-b",
            pipelineId: "pipe-b",
            datasetName: "Soy",
            modelClass: "SVR",
            metric: "r2",
            scoreColumn: "validation",
            score: 0.9,
          },
        ],
      },
      [
        {
          kind: "leaderboard",
          scoreColumn: "cv_val_score",
          query: { metrics: ["rmse"] },
        },
        {
          kind: "matrix",
          scoreColumn: "cv_val_score",
          query: { metrics: ["r2"] },
        },
      ],
    );

    expect(views.map(view => view.chainIds)).toEqual([
      ["candidate-a::rmse"],
      ["candidate-b::r2"],
    ]);
    expect(views.every(view => view.source.id === "bench")).toBe(true);
  });

  it("routes metric-record imports that use Inspector ScoreRef", () => {
    const store = buildResultAnalysisStoreFromImport({
      kind: "metric_records",
      source: { id: "score-ref-import", kind: "benchmark_export" },
      defaults: { runId: "run-score-ref", taskType: "regression" },
      records: [
        {
          resultId: "candidate-a",
          pipelineId: "pipe-a",
          datasetName: "Corn",
          modelClass: "PLSRegression",
          scoreRef: projectInspectorScoreRef({ metric: "rmse" }, "cv_val_score"),
          score: 0.12,
        },
      ],
    });

    expect(store.chainIds).toEqual(["candidate-a::rmse"]);
    expect(store.chains[0]).toMatchObject({
      metric: "rmse",
      cv_val_score: 0.12,
    });
    expect(store.metricObservations[0]).toMatchObject({
      value: 0.12,
      ref: {
        metric: "rmse",
        legacyScoreColumn: "cv_val_score",
      },
    });
  });

  it("routes current Result entities and workspace result responses through repository adapters", () => {
    const resultStore = buildResultAnalysisStoreFromImport({
      kind: "results",
      results: [
        {
          id: "result-a",
          run_id: "run-a",
          dataset: "Corn",
          pipeline_config: "PLS pipeline",
          pipeline_config_id: "pipe-a",
          best_model: "PLSRegression",
          metric: "rmse",
          task_type: "regression",
          val_score: 0.12,
        },
      ],
    });

    const responseStore = buildResultAnalysisStoreFromImport({
      kind: "result_list_response",
      response: {
        workspace_id: "workspace-a",
        results: [
          {
            id: "result-b",
            dataset: "Soy",
            pipeline_config: "RF pipeline",
            pipeline_config_id: "pipe-b",
            best_model: "RandomForestRegressor",
            metric: "accuracy",
            task_type: "classification",
            best_score: 0.8,
          },
        ],
      },
    });

    expect(resultStore.source).toEqual({
      id: "result-repository",
      kind: "result_repository",
      label: undefined,
    });
    expect(resultStore.chains[0]).toMatchObject({
      chain_id: "result-a",
      pipeline_id: "pipe-a",
      model_class: "PLSRegression",
      cv_val_score: 0.12,
    });
    expect(responseStore.source.id).toBe("workspace-workspace-a-results");
    expect(responseStore.chains[0]).toMatchObject({
      chain_id: "result-b",
      model_class: "RandomForestRegressor",
      metric: "accuracy",
      cv_val_score: 0.8,
    });
  });

  it("routes raw workspace results endpoint responses explicitly", () => {
    const response: WorkspaceResultsResponse = {
      workspace_id: "workspace-raw",
      total: 1,
      limit: 100,
      offset: 0,
      has_more: false,
      results: [
        {
          id: "workspace-result-a",
          run_id: "run-a",
          template_id: "template-a",
          dataset: "Corn",
          pipeline_config: "Workspace pipeline",
          pipeline_config_id: "pipe-a",
          created_at: "2026-06-28T12:00:00Z",
          best_score: 0.18,
          best_model: "SVR",
          metric: "rmse",
          predictions_count: 4,
          artifact_count: 2,
          manifest_path: "runs/run-a/results/workspace-result-a/manifest.json",
          test_score: 0.2,
          has_refit: true,
          refit_model_id: "refit-a",
        },
      ],
    };

    const store = buildResultAnalysisStoreFromImport({
      kind: "workspace_results_response",
      response,
      defaults: {
        taskType: "regression",
        pipelineStatus: "completed",
      },
    });

    expect(store.source).toEqual({
      id: "workspace-workspace-raw-results",
      kind: "result_repository",
      label: undefined,
    });
    expect(store.chainIds).toEqual(["workspace-result-a"]);
    expect(store.chains[0]).toMatchObject({
      chain_id: "workspace-result-a",
      run_id: "run-a",
      pipeline_id: "pipe-a",
      pipeline_name: "Workspace pipeline",
      model_class: "SVR",
      model_name: "SVR",
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      cv_val_score: 0.18,
      final_test_score: 0.2,
      pipeline_status: "completed",
    });
    expect(store.chains[0].variant_params).toEqual({
      result_metadata: {
        result_id: "workspace-result-a",
        result_index: 0,
        run_id: "run-a",
        template_id: "template-a",
        created_at: "2026-06-28T12:00:00Z",
        best_score: 0.18,
        predictions_count: 4,
        artifact_count: 2,
        manifest_path: "runs/run-a/results/workspace-result-a/manifest.json",
        refit: true,
        refit_model_id: "refit-a",
      },
    });
  });

  it("routes aggregated prediction summaries through chain-summary adapters", () => {
    const store = buildResultAnalysisStoreFromImport({
      kind: "aggregated_predictions_response",
      response: {
        predictions: [
          chainSummary(),
          chainSummary({
            chain_id: "summary-chain-b",
            metric: "r2",
            cv_val_score: 0.91,
            final_test_score: 0.93,
          }),
        ],
      },
      source: { id: "prediction-summary", kind: "result_repository" },
    });

    expect(store.source.id).toBe("prediction-summary");
    expect(store.chainIds).toEqual(["summary-chain-a", "summary-chain-b"]);
    expect(store.scope.metrics).toEqual(["r2", "rmse"]);
    expect(store.chains[0]).toMatchObject({
      chain_id: "summary-chain-a",
      model_class: "PLSRegression",
      metric: "rmse",
      cv_val_score: 0.12,
      final_test_score: 0.14,
    });
    expect(store.chains[0].variant_params).toEqual({
      prediction_metadata: {
        model_step_idx: 1,
        fold_artifacts: { final: "artifact-final" },
      },
    });
  });

  it("routes SHAP available-model responses through result-analysis stores", () => {
    const response: AvailableModelsResponse = {
      datasets: [
        {
          dataset_name: "Corn",
          metric: "rmse",
          task_type: "regression",
          chains: [
            {
              chain_id: "shap-chain-a",
              dataset_name: "Corn",
              model_class: "PLSRegression",
              model_name: "PLS",
              preprocessings: "SNV",
              run_id: "run-shap",
              metric: "rmse",
              cv_val_score: 0.12,
              final_test_score: 0.14,
              cv_fold_count: 5,
              has_refit: true,
            },
          ],
        },
      ],
      bundles: [
        {
          bundle_path: "/exports/model.n4a",
          display_name: "model.n4a",
          dataset_name: "Corn",
        },
      ],
    };

    const store = buildResultAnalysisStoreFromImport({
      kind: "shap_available_models_response",
      response,
      source: { id: "shap-models", kind: "result_repository", label: "SHAP models" },
    });

    expect(store.source).toEqual({ id: "shap-models", kind: "result_repository", label: "SHAP models" });
    expect(store.chainIds).toEqual(["shap-chain-a"]);
    expect(store.chains[0]).toMatchObject({
      chain_id: "shap-chain-a",
      run_id: "run-shap",
      model_class: "PLSRegression",
      metric: "rmse",
      dataset_name: "Corn",
      cv_val_score: 0.12,
      final_test_score: 0.14,
    });
  });

  it("routes Results summary datasets through metric-record imports", () => {
    const store = buildResultAnalysisStoreFromImport({
      kind: "results_summary_response",
      response: {
        workspace_id: "workspace-a",
        datasets: [
          {
            dataset_name: "Corn",
            linked_dataset_id: "dataset-a",
            metric: "rmse",
            task_type: "regression",
            top_chains: [topChain()],
          },
        ],
      },
    });

    expect(store.source).toEqual({
      id: "workspace-workspace-a-results-summary",
      kind: "result_repository",
      label: undefined,
    });
    expect(store.scope.metrics).toEqual(["mae", "r2", "rmse"]);
    expect(store.chainIds).toEqual([
      "top-chain-a::mae",
      "top-chain-a::r2",
      "top-chain-a::rmse",
    ]);
    expect(store.chainById.get("top-chain-a::rmse")).toMatchObject({
      run_id: "run-a",
      pipeline_id: "pipe-a",
      pipeline_name: "Pipeline A",
      model_class: "PLSRegression",
      model_name: "PLS",
      preprocessings: "SNV",
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      best_params: { n_components: 8 },
      cv_val_score: 0.12,
      cv_test_score: 0.2,
      cv_train_score: 0.08,
      final_test_score: 0.14,
      final_train_score: 0.1,
      cv_fold_count: 5,
    });
    expect(store.chainById.get("top-chain-a::r2")).toMatchObject({
      metric: "r2",
      cv_val_score: null,
      final_test_score: 0.9,
    });
    expect(store.chainById.get("top-chain-a::rmse")?.variant_params).toEqual({
      variant: "a",
      result_summary: {
        linked_dataset_id: "dataset-a",
        cv_source_chain_id: null,
        final_agg_test_score: 0.13,
        final_agg_train_score: 0.09,
        final_scores: { test: { rmse: 0.14, r2: 0.9 }, train: { rmse: 0.1 } },
        final_agg_scores: { test: { rmse: 0.13 }, train: { rmse: 0.09 } },
        is_refit_only: false,
        synthetic_refit: false,
      },
      result_metadata: {
        source_ref: "results_summary",
        dimensions: {
          result_source: "results_summary",
        },
      },
      result_source_indexes: [2, 3, 4, 5, 6],
    });
  });
});

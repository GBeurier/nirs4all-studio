import { describe, expect, it } from "vitest";

import { projectInspectorScoreRef } from "@/lib/inspector/metricObservationProjection";
import {
  buildResultAnalysisScopeSummary,
  buildResultAnalysisStore,
  buildResultAnalysisStoreFromAggregatedPredictionsResponse,
  buildResultAnalysisStoreFromChainSummaries,
  buildResultAnalysisStoreFromEntries,
  buildResultAnalysisStoreFromMetricRecords,
  buildResultAnalysisStoreFromResultListResponse,
  buildResultAnalysisStoreFromResults,
  buildResultAnalysisStoreFromShapAvailableModels,
  getResultAnalysisBestScoreEntry,
  getResultAnalysisChains,
  getResultAnalysisMetricObservationById,
  getResultAnalysisMetricObservations,
  getResultAnalysisScope,
  isResultAnalysisClassificationTask,
  isResultAnalysisRegressionTask,
} from "@/lib/inspector/resultAnalysisStore";
import type { ChainSummary } from "@/types/aggregated-predictions";
import type { InspectorChainSummary } from "@/types/inspector";
import type { AvailableChain, DatasetChains } from "@/types/shap";

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
    metric: "r2",
    task_type: "regression",
    dataset_name: "Dataset A",
    best_params: null,
    variant_params: null,
    cv_val_score: 0.8,
    cv_test_score: 0.75,
    cv_train_score: 0.9,
    cv_fold_count: 5,
    final_test_score: null,
    final_train_score: null,
    pipeline_status: "completed",
    ...overrides,
  };
}

function chainSummary(overrides: Partial<ChainSummary> = {}): ChainSummary {
  return {
    run_id: "run-1",
    pipeline_id: "pipe-a",
    chain_id: "chain-a",
    model_name: "PLS",
    model_class: "PLSRegression",
    preprocessings: "SNV",
    branch_path: ["branch", 0],
    source_index: 2,
    model_step_idx: 3,
    metric: "rmse",
    task_type: "regression",
    dataset_name: "Corn",
    best_params: { n_components: 8 },
    variant_params: { variant: "a" },
    cv_val_score: 0.12,
    cv_test_score: 0.2,
    cv_train_score: 0.08,
    cv_fold_count: 5,
    cv_scores: { val: { rmse: 0.12 }, test: { rmse: 0.2 } },
    cv_source_chain_id: "chain-a-cv",
    final_test_score: 0.14,
    final_train_score: 0.1,
    final_scores: { test: { rmse: 0.14 }, train: { rmse: 0.1 } },
    final_agg_test_score: 0.13,
    final_agg_train_score: 0.09,
    final_agg_scores: { test: { rmse: 0.13 }, train: { rmse: 0.09 } },
    synthetic_refit: false,
    is_refit_only: false,
    pipeline_status: "completed",
    fold_artifacts: { final: "artifact-final", fold_0: "artifact-fold-0" },
    ...overrides,
  };
}

function shapChain(overrides: Partial<AvailableChain> = {}): AvailableChain {
  return {
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
    ...overrides,
  };
}

function shapDataset(overrides: Partial<DatasetChains> = {}): DatasetChains {
  return {
    dataset_name: "Corn",
    metric: "rmse",
    task_type: "regression",
    chains: [shapChain()],
    ...overrides,
  };
}

describe("resultAnalysisStore", () => {
  it("builds a stable read model over inspector chain summaries", () => {
    const chains = [
      chain(),
      chain({
        chain_id: "chain-2",
        run_id: "run-2",
        pipeline_id: "pipeline-2",
        model_class: "RandomForestClassifier",
        metric: "accuracy",
        task_type: "classification",
        dataset_name: "Dataset B",
      }),
    ];

    const store = buildResultAnalysisStore({
      chains,
      source: { id: "bench-1", kind: "benchmark_export", label: "Benchmark 1" },
    });

    expect(store.source).toEqual({ id: "bench-1", kind: "benchmark_export", label: "Benchmark 1" });
    expect(store.chainIds).toEqual(["chain-1", "chain-2"]);
    expect(store.chainById.get("chain-2")?.model_class).toBe("RandomForestClassifier");
    expect(getResultAnalysisChains(store)).toEqual(chains);
    expect(getResultAnalysisMetricObservations(store).map(observation => ({
      chainId: observation.chainId,
      value: observation.value,
      legacyScoreColumn: observation.ref.legacyScoreColumn,
      metric: observation.ref.metric,
    }))).toEqual([
      { chainId: "chain-1", value: 0.8, legacyScoreColumn: "cv_val_score", metric: "r2" },
      { chainId: "chain-1", value: 0.75, legacyScoreColumn: "cv_test_score", metric: "r2" },
      { chainId: "chain-1", value: 0.9, legacyScoreColumn: "cv_train_score", metric: "r2" },
      { chainId: "chain-2", value: 0.8, legacyScoreColumn: "cv_val_score", metric: "accuracy" },
      { chainId: "chain-2", value: 0.75, legacyScoreColumn: "cv_test_score", metric: "accuracy" },
      { chainId: "chain-2", value: 0.9, legacyScoreColumn: "cv_train_score", metric: "accuracy" },
    ]);
    expect(getResultAnalysisMetricObservationById(
      store,
      "chain-2:metric=accuracy|protocol=cross_validation|partition=validation|aggregation=fold_mean",
    )).toMatchObject({
      chainId: "chain-2",
      value: 0.8,
      ref: {
        metric: "accuracy",
        legacyScoreColumn: "cv_val_score",
      },
    });
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["accuracy", "r2"],
      taskTypes: ["classification", "regression"],
      datasetNames: ["Dataset A", "Dataset B"],
      runIds: ["run-1", "run-2"],
      modelClasses: ["PLSRegression", "RandomForestClassifier"],
      pipelineIds: ["pipeline-1", "pipeline-2"],
      hasMixedMetrics: true,
      hasMixedTaskTypes: true,
      hasRegression: true,
      hasClassification: true,
    });
  });

  it("preserves top-level inspector score payloads as prediction metadata", () => {
    const store = buildResultAnalysisStore({
      chains: [
        chain({
          variant_params: { result_metadata: { target_name: "protein" } },
          score_maps: { cv: { targets: { protein: { rmse: 0.31 } } } },
          final_agg_scores: { test: { rmse: 0.27 } },
          final_agg_test_score: 0.27,
        }),
      ],
      source: { id: "inspector", kind: "inspector_chain_summaries", label: "Inspector" },
    });

    expect(store.chains[0].variant_params).toEqual({
      result_metadata: { target_name: "protein" },
      prediction_metadata: {
        score_maps: { cv: { targets: { protein: { rmse: 0.31 } } } },
        final_agg_scores: { test: { rmse: 0.27 } },
        final_agg_test_score: 0.27,
      },
    });
  });

  it("uses inspector-compatible defaults for current local scopes", () => {
    const store = buildResultAnalysisStore({ chains: [chain()] });

    expect(store.source).toEqual({
      id: "current-inspector-scope",
      kind: "inspector_chain_summaries",
      label: undefined,
    });
  });

  it("exposes scope and the best scored chain through store selectors", () => {
    const store = buildResultAnalysisStore({
      chains: [
        chain({ chain_id: "unscored", metric: "rmse", cv_val_score: null }),
        chain({ chain_id: "worst", metric: "rmse", cv_val_score: 0.4 }),
        chain({ chain_id: "best", metric: "rmse", cv_val_score: 0.12 }),
      ],
    });

    expect(getResultAnalysisScope(store).totalChains).toBe(3);
    expect(getResultAnalysisBestScoreEntry(store, "cv_val_score")).toMatchObject({
      chain: expect.objectContaining({ chain_id: "best" }),
      score: 0.12,
    });
    expect(getResultAnalysisBestScoreEntry(
      buildResultAnalysisStore({ chains: [chain({ cv_val_score: null })] }),
      "cv_val_score",
    )).toBeNull();
  });

  it("builds a store from benchmark-style result entries without requiring chain summaries", () => {
    const store = buildResultAnalysisStoreFromEntries({
      source: { id: "benchmark-42", kind: "benchmark_export", label: "Benchmark 42" },
      defaults: {
        runId: "benchmark-run",
        modelClass: "PLSRegression",
        preprocessingSteps: ["SNV"],
        metric: "rmse",
        taskType: "regression",
        datasetName: "Diesel",
        cvFoldCount: 4,
        pipelineStatus: "completed",
      },
      entries: [
        {
          chainId: " bench-chain ",
          pipelineId: "pipe-a",
          pipelineName: "Pipeline A",
          modelName: "PLS 8",
          bestParams: { n_components: 8 },
          scores: {
            cv_val_score: 0.11,
            cv_test_score: Number.POSITIVE_INFINITY,
            final_test_score: 0.13,
          },
        },
        {
          chainId: "nan-chain",
          modelClass: "SVR",
          datasetName: "Corn",
          scores: { cv_val_score: Number.NaN },
        },
      ],
    });

    expect(store.source).toEqual({ id: "benchmark-42", kind: "benchmark_export", label: "Benchmark 42" });
    expect(store.chainIds).toEqual(["bench-chain", "nan-chain"]);
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["rmse"],
      datasetNames: ["Corn", "Diesel"],
      modelClasses: ["PLSRegression", "SVR"],
    });
    expect(store.chains[0]).toMatchObject({
      run_id: "benchmark-run",
      pipeline_id: "pipe-a",
      pipeline_name: "Pipeline A",
      model_class: "PLSRegression",
      model_name: "PLS 8",
      preprocessings: "SNV",
      preprocessing_steps: ["SNV"],
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Diesel",
      best_params: { n_components: 8 },
      cv_val_score: 0.11,
      cv_test_score: null,
      final_test_score: 0.13,
      cv_fold_count: 4,
      pipeline_status: "completed",
    });
    expect(store.chains[1].cv_val_score).toBeNull();
    expect(getResultAnalysisBestScoreEntry(store, "cv_val_score")?.chain.chain_id).toBe("bench-chain");
  });

  it("uses deterministic repository-entry fallbacks for sparse result inputs", () => {
    const store = buildResultAnalysisStoreFromEntries({
      source: { id: "repo-scope", kind: "result_repository" },
      entries: [
        {
          chainId: " ",
          scores: { final_test_score: 0.91 },
        },
      ],
    });

    expect(store.chains[0]).toMatchObject({
      chain_id: "repo-scope-chain-1",
      run_id: "repo-scope",
      pipeline_id: "external-pipeline",
      pipeline_name: null,
      model_class: "UnknownModel",
      model_name: null,
      preprocessings: null,
      preprocessing_steps: [],
      metric: null,
      task_type: null,
      dataset_name: null,
      cv_val_score: null,
      final_test_score: 0.91,
      cv_fold_count: 0,
      pipeline_status: null,
    });
  });

  it("builds a store from row-oriented metric records without chain summaries", () => {
    const store = buildResultAnalysisStoreFromMetricRecords({
      source: { id: "arena-export", kind: "benchmark_export", label: "Arena export" },
      defaults: {
        runId: "arena-run",
        taskType: "regression",
        pipelineStatus: "completed",
      },
      records: [
        {
          resultId: "candidate-a",
          pipelineId: "pipe-a",
          pipelineName: "Pipeline A",
          datasetName: "Corn",
          modelClass: "PLSRegression",
          metric: "rmse",
          metricVersion: "n4a.metrics.rmse.v1",
          scoreColumn: "validation",
          score: { value: 0.12 },
          targetName: "moisture",
          split: "cv",
          foldIndex: 3,
          randomSeed: 123,
          refit: false,
          backend: "dag-ml",
          contentAddress: "sha256:abc",
          dimensions: { repetition_group: "source:A" },
          variantParams: {
            repository_id: "asset-1",
            result_metadata: {
              source: "benchmark",
            },
          },
        },
        {
          resultId: "candidate-a",
          pipelineId: "pipe-a",
          datasetName: "Corn",
          modelClass: "PLSRegression",
          metric: "rmse",
          metricVersion: "n4a.metrics.rmse.v1",
          scoreColumn: "holdout",
          score: 0.14,
          targetName: "moisture",
          split: "final",
          foldIndex: 3,
          randomSeed: 123,
          refit: false,
          backend: "dag-ml",
        },
        {
          resultId: "candidate-a",
          pipelineId: "pipe-a",
          datasetName: "Corn",
          modelClass: "PLSRegression",
          metric: "r2",
          metricVersion: "n4a.metrics.r2.v1",
          scoreColumn: "cv_val_score",
          score: 0.92,
          targetName: "moisture",
          randomSeed: 123,
        },
      ],
    });

    expect(store.source).toEqual({ id: "arena-export", kind: "benchmark_export", label: "Arena export" });
    expect(store.chainIds).toEqual(["candidate-a::rmse", "candidate-a::r2"]);
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["r2", "rmse"],
      datasetNames: ["Corn"],
      modelClasses: ["PLSRegression"],
      hasMixedMetrics: true,
    });
    expect(store.chains[0]).toMatchObject({
      chain_id: "candidate-a::rmse",
      run_id: "arena-run",
      pipeline_id: "pipe-a",
      pipeline_name: "Pipeline A",
      model_class: "PLSRegression",
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      cv_val_score: 0.12,
      final_test_score: 0.14,
      cv_fold_count: 4,
      pipeline_status: "completed",
    });
    expect(store.chains[0].variant_params).toEqual({
      repository_id: "asset-1",
      result_metadata: {
        source: "benchmark",
        metric_version: "n4a.metrics.rmse.v1",
        target_name: "moisture",
        split: "cv",
        fold_index: 3,
        random_seed: 123,
        refit: false,
        backend: "dag-ml",
        content_address: "sha256:abc",
        dimensions: { repetition_group: "source:A" },
      },
      result_source_indexes: [0, 1],
    });
    expect(getResultAnalysisBestScoreEntry(store, "cv_val_score")?.chain.chain_id).toBe("candidate-a::rmse");
  });

  it("skips unsupported metric score slots and normalizes sparse metric-record fallbacks", () => {
    const store = buildResultAnalysisStoreFromMetricRecords({
      source: { id: "repo-results", kind: "result_repository" },
      records: [
        {
          metric: "accuracy",
          scoreColumn: "not_supported" as "cv_val_score",
          score: 0.7,
        },
        {
          metric: "accuracy",
          scoreColumn: "test",
          score: Number.POSITIVE_INFINITY,
          backend: "sklearn",
          variantParams: { repository_id: "asset-1" },
        },
      ],
    });

    expect(store.chainIds).toEqual(["sklearn__2::accuracy"]);
    expect(store.chains[0]).toMatchObject({
      chain_id: "sklearn__2::accuracy",
      run_id: "repo-results",
      pipeline_id: "external-pipeline",
      model_class: "UnknownModel",
      metric: "accuracy",
      cv_test_score: null,
    });
    expect(store.chains[0].variant_params).toEqual({
      repository_id: "asset-1",
      result_metadata: {
        backend: "sklearn",
      },
      result_source_indexes: [1],
    });
  });

  it("builds metric-record stores from Inspector ScoreRef without a parallel scoreColumn contract", () => {
    const store = buildResultAnalysisStoreFromMetricRecords({
      source: { id: "score-ref-export", kind: "benchmark_export" },
      defaults: {
        runId: "score-ref-run",
        taskType: "regression",
      },
      records: [
        {
          resultId: "candidate-score-ref",
          pipelineId: "pipe-score-ref",
          datasetName: "Corn",
          modelClass: "SVR",
          scoreRef: projectInspectorScoreRef({ metric: "mae" }, "cv_val_score"),
          score: 0.08,
        },
        {
          resultId: "candidate-score-ref",
          pipelineId: "pipe-score-ref",
          datasetName: "Corn",
          modelClass: "SVR",
          ref: projectInspectorScoreRef({ metric: "mae" }, "final_test_score"),
          score: 0.1,
        },
      ],
    });

    expect(store.chainIds).toEqual(["candidate-score-ref::mae"]);
    expect(store.chains[0]).toMatchObject({
      chain_id: "candidate-score-ref::mae",
      run_id: "score-ref-run",
      pipeline_id: "pipe-score-ref",
      model_class: "SVR",
      metric: "mae",
      task_type: "regression",
      dataset_name: "Corn",
      cv_val_score: 0.08,
      final_test_score: 0.1,
    });
    expect(store.metricObservations.map(observation => ({
      value: observation.value,
      key: observation.ref.key,
      legacyScoreColumn: observation.ref.legacyScoreColumn,
      metric: observation.ref.metric,
    }))).toEqual([
      {
        value: 0.08,
        key: "metric=mae|protocol=cross_validation|partition=validation|aggregation=fold_mean",
        legacyScoreColumn: "cv_val_score",
        metric: "mae",
      },
      {
        value: 0.1,
        key: "metric=mae|protocol=final|partition=test|aggregation=final_model",
        legacyScoreColumn: "final_test_score",
        metric: "mae",
      },
    ]);
  });

  it("builds a repository result-analysis store from current Result entities", () => {
    const store = buildResultAnalysisStoreFromResults({
      source: { id: "repo-results", kind: "result_repository", label: "Repository results" },
      defaults: {
        pipelineStatus: "completed",
      },
      results: [
        {
          id: "result-a",
          run_id: "run-1",
          template_id: "template-a",
          dataset: "Corn",
          pipeline_config: "PLS pipeline",
          pipeline_config_id: "pipe-a",
          created_at: "2026-06-28T12:00:00Z",
          schema_version: "results.v2",
          generator_choices: [{ node: "pls", n_components: 8 }],
          best_score: 0.12,
          best_model: "PLSRegression",
          metric: "rmse",
          task_type: "regression",
          n_samples: 120,
          n_features: 256,
          predictions_count: 24,
          artifact_count: 3,
          manifest_path: "runs/run-1/result-a/manifest.json",
          val_score: null,
          test_score: 0.14,
          has_refit: true,
          refit_model_id: "model-a",
        },
        {
          id: "result-b",
          run_id: "run-1",
          dataset: "Soy",
          pipeline_config: "RF pipeline",
          pipeline_config_id: "pipe-b",
          best_score: 0.4,
          best_model: "RandomForestRegressor",
          metric: "rmse",
          task_type: "regression",
          val_score: 0.2,
        },
      ],
    });

    expect(store.source).toEqual({ id: "repo-results", kind: "result_repository", label: "Repository results" });
    expect(store.chainIds).toEqual(["result-a", "result-b"]);
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["rmse"],
      datasetNames: ["Corn", "Soy"],
      modelClasses: ["PLSRegression", "RandomForestRegressor"],
      pipelineIds: ["pipe-a", "pipe-b"],
    });
    expect(store.chains[0]).toMatchObject({
      chain_id: "result-a",
      run_id: "run-1",
      pipeline_id: "pipe-a",
      pipeline_name: "PLS pipeline",
      model_class: "PLSRegression",
      model_name: "PLSRegression",
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      cv_val_score: 0.12,
      final_test_score: 0.14,
      pipeline_status: "completed",
    });
    expect(store.chains[0].variant_params).toEqual({
      result_metadata: {
        result_id: "result-a",
        result_index: 0,
        run_id: "run-1",
        template_id: "template-a",
        created_at: "2026-06-28T12:00:00Z",
        schema_version: "results.v2",
        generator_choices: [{ node: "pls", n_components: 8 }],
        best_score: 0.12,
        n_samples: 120,
        n_features: 256,
        predictions_count: 24,
        artifact_count: 3,
        manifest_path: "runs/run-1/result-a/manifest.json",
        refit: true,
        refit_model_id: "model-a",
      },
    });
    expect(store.chains[1].cv_val_score).toBe(0.2);
  });

  it("builds a repository result-analysis store from result list responses", () => {
    const store = buildResultAnalysisStoreFromResultListResponse({
      response: {
        workspace_id: "workspace-a",
        results: [
          {
            id: "sparse-result",
            dataset: "Dataset A",
            pipeline_config: "Pipeline A",
            pipeline_config_id: "pipe-a",
            test_score: Number.NaN,
          },
        ],
      },
      defaults: {
        modelClass: "FallbackModel",
        metric: "accuracy",
        taskType: "classification",
      },
    });

    expect(store.source).toEqual({
      id: "workspace-workspace-a-results",
      kind: "result_repository",
      label: undefined,
    });
    expect(store.chains[0]).toMatchObject({
      chain_id: "sparse-result",
      run_id: "workspace-workspace-a-results",
      pipeline_id: "pipe-a",
      pipeline_name: "Pipeline A",
      model_class: "FallbackModel",
      metric: "accuracy",
      task_type: "classification",
      dataset_name: "Dataset A",
      final_test_score: null,
    });
  });

  it("builds a store from aggregated prediction chain summaries while preserving prediction metadata", () => {
    const store = buildResultAnalysisStoreFromChainSummaries({
      source: { id: "aggregated", kind: "result_repository", label: "Aggregated predictions" },
      defaults: {
        preprocessingSteps: ["SNV"],
      },
      summaries: [
        chainSummary({
          score_maps: {
            cv: {
              targets: { protein: { rmse: 0.31 } },
            },
          },
        }),
        chainSummary({
          chain_id: "chain-b",
          model_class: "RandomForestRegressor",
          best_params: "not-a-record",
          variant_params: null,
          final_test_score: null,
          final_train_score: null,
          final_agg_test_score: 0.18,
          final_agg_train_score: 0.11,
          fold_artifacts: null,
        }),
      ],
    });

    expect(store.source).toEqual({ id: "aggregated", kind: "result_repository", label: "Aggregated predictions" });
    expect(store.chainIds).toEqual(["chain-a", "chain-b"]);
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["rmse"],
      datasetNames: ["Corn"],
      modelClasses: ["PLSRegression", "RandomForestRegressor"],
    });
    expect(store.chains[0]).toMatchObject({
      chain_id: "chain-a",
      run_id: "run-1",
      pipeline_id: "pipe-a",
      pipeline_name: null,
      model_class: "PLSRegression",
      model_name: "PLS",
      preprocessings: "SNV",
      preprocessing_steps: ["SNV"],
      branch_path: ["branch", 0],
      source_index: 2,
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      best_params: { n_components: 8 },
      cv_val_score: 0.12,
      cv_test_score: 0.2,
      cv_train_score: 0.08,
      cv_fold_count: 5,
      final_test_score: 0.14,
      final_train_score: 0.1,
      pipeline_status: "completed",
    });
    expect(store.chains[0].variant_params).toEqual({
      variant: "a",
      prediction_metadata: {
        model_step_idx: 3,
        cv_scores: { val: { rmse: 0.12 }, test: { rmse: 0.2 } },
        score_maps: { cv: { targets: { protein: { rmse: 0.31 } } } },
        cv_source_chain_id: "chain-a-cv",
        final_scores: { test: { rmse: 0.14 }, train: { rmse: 0.1 } },
        final_agg_scores: { test: { rmse: 0.13 }, train: { rmse: 0.09 } },
        final_agg_test_score: 0.13,
        final_agg_train_score: 0.09,
        fold_artifacts: { final: "artifact-final", fold_0: "artifact-fold-0" },
        synthetic_refit: false,
        is_refit_only: false,
      },
    });
    expect(store.chains[1]).toMatchObject({
      chain_id: "chain-b",
      best_params: null,
      final_test_score: 0.18,
      final_train_score: 0.11,
    });
  });

  it("builds a store from aggregated predictions responses", () => {
    const store = buildResultAnalysisStoreFromAggregatedPredictionsResponse({
      response: {
        predictions: [
          chainSummary({
            chain_id: "chain-response",
            cv_val_score: 0.31,
          }),
        ],
      },
    });

    expect(store.source).toEqual({
      id: "aggregated-predictions",
      kind: "result_repository",
      label: undefined,
    });
    expect(store.chainIds).toEqual(["chain-response"]);
    expect(store.chains[0].cv_val_score).toBe(0.31);
  });

  it("builds a store from SHAP available-model responses", () => {
    const store = buildResultAnalysisStoreFromShapAvailableModels({
      response: {
        datasets: [
          shapDataset({
            chains: [
              shapChain(),
              shapChain({
                chain_id: "shap-chain-b",
                model_class: "RandomForestRegressor",
                model_name: "",
                preprocessings: "",
                metric: "",
                cv_val_score: null,
                final_test_score: 0.2,
                has_refit: false,
              }),
            ],
          }),
        ],
      },
      defaults: {
        pipelineStatus: "completed",
      },
    });

    expect(store.source).toEqual({
      id: "shap-available-models",
      kind: "result_repository",
      label: undefined,
    });
    expect(store.chainIds).toEqual(["shap-chain-a", "shap-chain-b"]);
    expect(store.scope).toMatchObject({
      totalChains: 2,
      metrics: ["rmse"],
      datasetNames: ["Corn"],
      runIds: ["run-shap"],
      modelClasses: ["PLSRegression", "RandomForestRegressor"],
    });
    expect(store.chains[0]).toMatchObject({
      chain_id: "shap-chain-a",
      run_id: "run-shap",
      pipeline_id: "external-pipeline",
      model_class: "PLSRegression",
      model_name: "PLS",
      preprocessings: "SNV",
      metric: "rmse",
      task_type: "regression",
      dataset_name: "Corn",
      cv_val_score: 0.12,
      final_test_score: 0.14,
      cv_fold_count: 5,
      pipeline_status: "completed",
    });
    expect(store.chains[0].variant_params).toEqual({
      shap_metadata: {
        source: "shap_available_models",
        dataset_name: "Corn",
        dataset_metric: "rmse",
        dataset_task_type: "regression",
        has_refit: true,
      },
    });
    expect(store.chains[1]).toMatchObject({
      chain_id: "shap-chain-b",
      metric: "rmse",
      cv_val_score: null,
      final_test_score: 0.2,
    });
    expect(store.chains[1].variant_params).toEqual({
      shap_metadata: {
        source: "shap_available_models",
        dataset_name: "Corn",
        dataset_metric: "rmse",
        dataset_task_type: "regression",
        has_refit: false,
      },
    });
  });

  it("derives empty and single-task scope summaries without false mixed flags", () => {
    expect(buildResultAnalysisScopeSummary([])).toEqual({
      totalChains: 0,
      metrics: [],
      taskTypes: [],
      datasetNames: [],
      runIds: [],
      modelClasses: [],
      pipelineIds: [],
      hasMixedMetrics: false,
      hasMixedTaskTypes: false,
      hasRegression: false,
      hasClassification: false,
    });

    const summary = buildResultAnalysisScopeSummary([chain({ metric: null, task_type: null })]);
    expect(summary.metrics).toEqual([]);
    expect(summary.taskTypes).toEqual([]);
    expect(summary.hasMixedMetrics).toBe(false);
    expect(summary.hasMixedTaskTypes).toBe(false);
    expect(summary.hasRegression).toBe(true);
    expect(summary.hasClassification).toBe(false);
  });

  it("normalizes task-family checks for future result adapters", () => {
    expect(isResultAnalysisClassificationTask("binary_classification")).toBe(true);
    expect(isResultAnalysisClassificationTask("regression")).toBe(false);
    expect(isResultAnalysisRegressionTask("continuous")).toBe(true);
    expect(isResultAnalysisRegressionTask(null)).toBe(true);
    expect(isResultAnalysisRegressionTask("multiclass_classification")).toBe(false);
  });
});

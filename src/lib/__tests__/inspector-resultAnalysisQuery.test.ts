import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisStoreFromMetricRecords,
  buildResultAnalysisStoreFromResults,
} from "@/lib/inspector/resultAnalysisStore";
import {
  buildResultAnalysisComplementarityViewModel,
  buildResultAnalysisLeaderboardViewModel,
  buildResultAnalysisMatrixViewModel,
  buildResultAnalysisRobustnessViewModel,
  buildResultAnalysisView,
  filterResultAnalysisStoreByQuery,
  queryResultAnalysisStore,
  queryResultAnalysisStoreWithMetadataFacets,
  sortResultAnalysisChains,
} from "@/lib/inspector/resultAnalysisQuery";

const store = buildResultAnalysisStoreFromMetricRecords({
  source: { id: "arena", kind: "benchmark_export", label: "Arena" },
  defaults: { runId: "run-a", taskType: "regression", pipelineStatus: "completed" },
  records: [
    {
      resultId: "candidate-a",
      pipelineId: "pipe-a",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      metricVersion: "rmse-v1",
      scoreColumn: "validation",
      score: 0.12,
      targetName: "moisture",
      backend: "dag-ml",
      contentAddress: "sha256:a",
      dimensions: { source: "nir", repetition_policy: "aggregate" },
    },
    {
      resultId: "candidate-a",
      pipelineId: "pipe-a",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "r2",
      metricVersion: "r2-v1",
      scoreColumn: "validation",
      score: 0.92,
      targetName: "moisture",
      backend: "dag-ml",
      contentAddress: "sha256:a",
      dimensions: { source: "nir", repetition_policy: "aggregate" },
    },
    {
      resultId: "candidate-b",
      pipelineId: "pipe-b",
      datasetName: "Soy",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      metricVersion: "rmse-v1",
      scoreColumn: "validation",
      score: 0.2,
      targetName: "protein",
      backend: "sklearn",
      contentAddress: "sha256:b",
      dimensions: { source: "nir", repetition_policy: "raw" },
    },
    {
      resultId: "candidate-c",
      pipelineId: "pipe-c",
      datasetName: "Corn",
      modelClass: "SVR",
      metric: "rmse",
      scoreColumn: "validation",
      score: null,
      targetName: "moisture",
      backend: "dag-ml",
      dimensions: { source: "lab", repetition_policy: "aggregate" },
    },
  ],
});

const complementarityStore = buildResultAnalysisStoreFromMetricRecords({
  source: { id: "comparison", kind: "benchmark_export", label: "Comparison" },
  defaults: { runId: "run-b", taskType: "regression", pipelineStatus: "completed" },
  records: [
    {
      resultId: "pls-corn",
      pipelineId: "pipe-pls",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.12,
    },
    {
      resultId: "pls-corn-alt",
      pipelineId: "pipe-pls",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.14,
    },
    {
      resultId: "rf-corn",
      pipelineId: "pipe-rf",
      datasetName: "Corn",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.1,
    },
    {
      resultId: "pls-soy",
      pipelineId: "pipe-pls",
      datasetName: "Soy",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.3,
    },
    {
      resultId: "rf-soy",
      pipelineId: "pipe-rf",
      datasetName: "Soy",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.35,
    },
  ],
});

describe("result analysis query", () => {
  it("filters store chains by source dimensions and result metadata", () => {
    const chains = filterResultAnalysisStoreByQuery(store, {
      metrics: ["rmse"],
      datasetNames: ["Corn"],
      targetNames: ["moisture"],
      backends: ["dag-ml"],
      dimensions: { repetition_policy: ["aggregate"] },
    });

    expect(chains.map(chain => chain.chain_id)).toEqual(["candidate-a::rmse", "candidate-c::rmse"]);
  });

  it("filters repository result chains by top-level result metadata fields", () => {
    const repositoryStore = buildResultAnalysisStoreFromResults({
      results: [
        {
          id: "result-a",
          run_id: "run-a",
          template_id: "template-a",
          dataset: "Corn",
          pipeline_config: "Pipeline A",
          pipeline_config_id: "pipe-a",
          metric: "rmse",
          task_type: "regression",
          best_model: "PLSRegression",
          best_score: 0.12,
          val_score: 0.12,
          artifact_count: 3,
          has_refit: true,
          refit_model_id: "refit-a",
          manifest_path: "manifest-a.json",
        },
        {
          id: "result-b",
          run_id: "run-b",
          template_id: "template-b",
          dataset: "Corn",
          pipeline_config: "Pipeline B",
          pipeline_config_id: "pipe-b",
          metric: "rmse",
          task_type: "regression",
          best_model: "SVR",
          best_score: 0.2,
          val_score: 0.2,
          artifact_count: 1,
          has_refit: false,
        },
      ],
      source: { id: "repo", kind: "result_repository" },
    });

    expect(filterResultAnalysisStoreByQuery(repositoryStore, {
      metrics: ["rmse"],
      resultMetadata: {
        template_id: ["template-a"],
        refit: [true],
        artifact_count: ["3"],
      },
    }).map(chain => chain.chain_id)).toEqual(["result-a"]);

    expect(filterResultAnalysisStoreByQuery(repositoryStore, {
      metrics: ["rmse"],
      resultMetadata: { template_id: ["template-a"] },
      score: { column: "cv_val_score", max: 0.15, requireFinite: true },
    }).map(chain => chain.chain_id)).toEqual(["result-a"]);
  });

  it("filters by finite score ranges when requested", () => {
    const chains = filterResultAnalysisStoreByQuery(store, {
      metrics: ["rmse"],
      score: {
        column: "cv_val_score",
        max: 0.15,
        requireFinite: true,
      },
    });

    expect(chains.map(chain => chain.chain_id)).toEqual(["candidate-a::rmse"]);
  });

  it("sorts score queries by best and worst score direction", () => {
    const rmseChains = filterResultAnalysisStoreByQuery(store, {
      metrics: ["rmse"],
      score: { column: "cv_val_score", requireFinite: true },
    });

    expect(sortResultAnalysisChains(rmseChains, {
      by: "score",
      scoreColumn: "cv_val_score",
      direction: "best",
      lowerBetter: true,
    }).map(chain => chain.chain_id)).toEqual(["candidate-a::rmse", "candidate-b::rmse"]);

    expect(sortResultAnalysisChains(rmseChains, {
      by: "score",
      scoreColumn: "cv_val_score",
      direction: "worst",
      lowerBetter: true,
    }).map(chain => chain.chain_id)).toEqual(["candidate-b::rmse", "candidate-a::rmse"]);
  });

  it("returns query result counts and applies limits after sorting", () => {
    const result = queryResultAnalysisStore(store, {
      metrics: ["rmse"],
      sort: {
        by: "score",
        scoreColumn: "cv_val_score",
        direction: "best",
        lowerBetter: true,
      },
      limit: 2,
    });

    expect(result.chainIds).toEqual(["candidate-a::rmse", "candidate-b::rmse"]);
    expect(result.matchedCount).toBe(3);
    expect(result.displayedCount).toBe(2);
    expect(result.truncated).toBe(true);
  });

  it("builds metadata facets from the queried result chains", () => {
    const result = queryResultAnalysisStoreWithMetadataFacets(store, {
      metrics: ["rmse"],
      sort: {
        by: "score",
        scoreColumn: "cv_val_score",
        direction: "best",
        lowerBetter: true,
      },
      limit: 2,
    });

    const facetByKey = new Map(result.metadataFacets.map(facet => [`${facet.kind}:${facet.key}`, facet]));

    expect(result.chainIds).toEqual(["candidate-a::rmse", "candidate-b::rmse"]);
    expect(result.matchedCount).toBe(3);
    expect(result.displayedCount).toBe(2);
    expect(result.truncated).toBe(true);
    expect(facetByKey.get("metadata:backend")).toEqual({
      kind: "metadata",
      key: "backend",
      values: [
        { value: "dag-ml", count: 1 },
        { value: "sklearn", count: 1 },
      ],
    });
    expect(facetByKey.get("dimension:repetition_policy")).toEqual({
      kind: "dimension",
      key: "repetition_policy",
      values: [
        { value: "aggregate", count: 1 },
        { value: "raw", count: 1 },
      ],
    });
  });

  it("passes metadata facet options through the faceted query helper", () => {
    const result = queryResultAnalysisStoreWithMetadataFacets(store, {
      metrics: ["rmse"],
      datasetNames: ["Corn"],
    }, {
      includeMetadataFields: false,
    });

    expect(result.metadataFacets.map(facet => `${facet.kind}:${facet.key}`)).toEqual([
      "dimension:repetition_policy",
      "dimension:source",
    ]);
  });

  it("builds a stable leaderboard view from a store query", () => {
    const view = buildResultAnalysisView(store, {
      id: "rmse-leaderboard",
      kind: "leaderboard",
      title: "RMSE Leaderboard",
      scoreColumn: "cv_val_score",
      query: {
        metrics: ["rmse"],
        score: { column: "cv_val_score", requireFinite: true },
      },
      limit: 1,
      sort: {
        by: "score",
        scoreColumn: "cv_val_score",
        direction: "best",
        lowerBetter: true,
      },
    });

    expect(view).toMatchObject({
      id: "rmse-leaderboard",
      kind: "leaderboard",
      title: "RMSE Leaderboard",
      scoreColumn: "cv_val_score",
      matchedCount: 2,
      displayedCount: 1,
      truncated: true,
      chainIds: ["candidate-a::rmse"],
    });
  });

  it("sorts textual result fields with chain-id tie breaking", () => {
    const result = queryResultAnalysisStore(store, {
      metrics: ["rmse"],
      sort: { by: "dataset_name", direction: "asc" },
    });

    expect(result.chainIds).toEqual([
      "candidate-a::rmse",
      "candidate-c::rmse",
      "candidate-b::rmse",
    ]);
  });

  it("builds a leaderboard view model with rank and score availability counts", () => {
    const view = buildResultAnalysisView(store, {
      kind: "leaderboard",
      scoreColumn: "cv_val_score",
      query: {
        metrics: ["rmse"],
      },
      sort: {
        by: "score",
        scoreColumn: "cv_val_score",
        direction: "best",
        lowerBetter: true,
      },
    });

    const model = buildResultAnalysisLeaderboardViewModel(view);

    expect(model.scoreColumn).toBe("cv_val_score");
    expect(model.finiteScoreCount).toBe(2);
    expect(model.missingScoreCount).toBe(1);
    expect(model.rows.map(row => [row.rank, row.chainId, row.score, row.datasetName, row.modelClass])).toEqual([
      [1, "candidate-a::rmse", 0.12, "Corn", "PLSRegression"],
      [2, "candidate-b::rmse", 0.2, "Soy", "RandomForestRegressor"],
      [3, "candidate-c::rmse", null, "Corn", "SVR"],
    ]);
  });

  it("builds a matrix view model with best and mean scores per cell", () => {
    const view = buildResultAnalysisView(store, {
      kind: "matrix",
      scoreColumn: "cv_val_score",
      query: {
        metrics: ["rmse"],
      },
    });

    const matrix = buildResultAnalysisMatrixViewModel(view, {
      rowField: "dataset_name",
      columnField: "model_class",
      lowerBetter: true,
    });

    expect(matrix.rowKeys).toEqual(["Corn", "Soy"]);
    expect(matrix.columnKeys).toEqual(["PLSRegression", "RandomForestRegressor", "SVR"]);
    expect(matrix.cells.map(cell => ({
      row: cell.rowKey,
      column: cell.columnKey,
      count: cell.count,
      bestChainId: cell.bestChainId,
      bestScore: cell.bestScore,
      meanScore: cell.meanScore,
    }))).toEqual([
      {
        row: "Corn",
        column: "PLSRegression",
        count: 1,
        bestChainId: "candidate-a::rmse",
        bestScore: 0.12,
        meanScore: 0.12,
      },
      {
        row: "Corn",
        column: "SVR",
        count: 1,
        bestChainId: null,
        bestScore: null,
        meanScore: null,
      },
      {
        row: "Soy",
        column: "RandomForestRegressor",
        count: 1,
        bestChainId: "candidate-b::rmse",
        bestScore: 0.2,
        meanScore: 0.2,
      },
    ]);
    expect(matrix.cellByKey.get("Corn::PLSRegression")?.chainIds).toEqual(["candidate-a::rmse"]);
  });

  it("builds a robustness view model with score coverage and best/worst scores per group", () => {
    const view = buildResultAnalysisView(store, {
      kind: "robustness",
      scoreColumn: "cv_val_score",
      query: {
        metrics: ["rmse"],
      },
    });

    const robustness = buildResultAnalysisRobustnessViewModel(view, {
      groupField: "backend",
      lowerBetter: true,
    });

    expect(robustness.groupField).toBe("backend");
    expect(robustness.lowerBetter).toBe(true);
    expect(robustness.groups.map(group => ({
      key: group.key,
      count: group.count,
      finite: group.finiteScoreCount,
      missing: group.missingScoreCount,
      bestChainId: group.bestChainId,
      bestScore: group.bestScore,
      worstChainId: group.worstChainId,
      worstScore: group.worstScore,
      meanScore: group.meanScore,
      scoreRange: group.scoreRange,
    }))).toEqual([
      {
        key: "dag-ml",
        count: 2,
        finite: 1,
        missing: 1,
        bestChainId: "candidate-a::rmse",
        bestScore: 0.12,
        worstChainId: "candidate-a::rmse",
        worstScore: 0.12,
        meanScore: 0.12,
        scoreRange: [0.12, 0.12],
      },
      {
        key: "sklearn",
        count: 1,
        finite: 1,
        missing: 0,
        bestChainId: "candidate-b::rmse",
        bestScore: 0.2,
        worstChainId: "candidate-b::rmse",
        worstScore: 0.2,
        meanScore: 0.2,
        scoreRange: [0.2, 0.2],
      },
    ]);
    expect(robustness.groupByKey.get("dag-ml")?.chainIds).toEqual(["candidate-a::rmse", "candidate-c::rmse"]);
  });

  it("builds a complementarity view model from best candidate scores per context", () => {
    const view = buildResultAnalysisView(complementarityStore, {
      kind: "complementarity",
      scoreColumn: "cv_val_score",
      query: {
        metrics: ["rmse"],
      },
    });

    const complementarity = buildResultAnalysisComplementarityViewModel(view, {
      candidateField: "model_class",
      contextField: "dataset_name",
      lowerBetter: true,
    });

    expect(complementarity.candidateKeys).toEqual(["PLSRegression", "RandomForestRegressor"]);
    expect(complementarity.contextKeys).toEqual(["Corn", "Soy"]);
    expect(complementarity.entries.map(entry => ({
      candidate: entry.candidateKey,
      context: entry.contextKey,
      chainId: entry.chainId,
      score: entry.score,
    }))).toEqual([
      {
        candidate: "PLSRegression",
        context: "Corn",
        chainId: "pls-corn::rmse",
        score: 0.12,
      },
      {
        candidate: "PLSRegression",
        context: "Soy",
        chainId: "pls-soy::rmse",
        score: 0.3,
      },
      {
        candidate: "RandomForestRegressor",
        context: "Corn",
        chainId: "rf-corn::rmse",
        score: 0.1,
      },
      {
        candidate: "RandomForestRegressor",
        context: "Soy",
        chainId: "rf-soy::rmse",
        score: 0.35,
      },
    ]);

    expect(complementarity.entryByKey.get("PLSRegression::Corn")?.chainId).toBe("pls-corn::rmse");
    expect(complementarity.pairs).toHaveLength(1);
    expect(complementarity.pairs[0]).toMatchObject({
      leftKey: "PLSRegression",
      rightKey: "RandomForestRegressor",
      sharedContextCount: 2,
      leftWins: 1,
      rightWins: 1,
      ties: 0,
      comparedContextKeys: ["Corn", "Soy"],
    });
    expect(complementarity.pairs[0].leftScoreMean).toBeCloseTo(0.21);
    expect(complementarity.pairs[0].rightScoreMean).toBeCloseTo(0.225);
  });
});

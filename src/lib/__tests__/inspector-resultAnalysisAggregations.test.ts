import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisComplementarityViewModel,
  buildResultAnalysisRobustnessViewModel,
  getResultAnalysisDisplayCellKey,
  getResultAnalysisInternalCellKey,
  getResultAnalysisMeanScore,
  getResultAnalysisScoreRange,
  isPreferredResultAnalysisScore,
} from "@/lib/inspector/resultAnalysisAggregations";
import { buildResultAnalysisStoreFromMetricRecords } from "@/lib/inspector/resultAnalysisStore";

const aggregationStore = buildResultAnalysisStoreFromMetricRecords({
  source: { id: "aggregation", kind: "benchmark_export", label: "Aggregation" },
  defaults: { runId: "run-a", taskType: "regression", pipelineStatus: "completed" },
  records: [
    {
      resultId: "dag-slow",
      pipelineId: "pipe-dag",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.2,
      backend: "dag-ml",
    },
    {
      resultId: "dag-fast",
      pipelineId: "pipe-dag",
      datasetName: "Soy",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.1,
      backend: "dag-ml",
    },
    {
      resultId: "dag-missing",
      pipelineId: "pipe-dag",
      datasetName: "Wheat",
      modelClass: "SVR",
      metric: "rmse",
      scoreColumn: "validation",
      score: null,
      backend: "dag-ml",
    },
    {
      resultId: "sklearn",
      pipelineId: "pipe-sklearn",
      datasetName: "Corn",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.3,
      backend: "sklearn",
    },
  ],
});

const complementarityStore = buildResultAnalysisStoreFromMetricRecords({
  source: { id: "comparison", kind: "benchmark_export", label: "Comparison" },
  defaults: { runId: "run-b", taskType: "regression", pipelineStatus: "completed" },
  records: [
    {
      resultId: "pls-corn-slower",
      pipelineId: "pipe-pls",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.14,
    },
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
      resultId: "pls-soy",
      pipelineId: "pipe-pls",
      datasetName: "Soy",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.3,
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
      resultId: "rf-soy",
      pipelineId: "pipe-rf",
      datasetName: "Soy",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.35,
    },
    {
      resultId: "svr-corn",
      pipelineId: "pipe-svr",
      datasetName: "Corn",
      modelClass: "SVR",
      metric: "rmse",
      scoreColumn: "validation",
      score: null,
    },
  ],
});

describe("result analysis aggregations", () => {
  it("builds robustness groups with score coverage and backend metadata labels", () => {
    const robustness = buildResultAnalysisRobustnessViewModel(
      { scoreColumn: "cv_val_score", chains: aggregationStore.chains },
      { groupField: "backend", lowerBetter: true },
    );

    expect(robustness.groups.map(group => ({
      key: group.key,
      chainIds: group.chainIds,
      finite: group.finiteScoreCount,
      missing: group.missingScoreCount,
      best: group.bestChainId,
      worst: group.worstChainId,
      mean: group.meanScore,
      range: group.scoreRange,
    }))).toEqual([
      {
        key: "dag-ml",
        chainIds: ["dag-slow::rmse", "dag-fast::rmse", "dag-missing::rmse"],
        finite: 2,
        missing: 1,
        best: "dag-fast::rmse",
        worst: "dag-slow::rmse",
        mean: 0.15000000000000002,
        range: [0.1, 0.2],
      },
      {
        key: "sklearn",
        chainIds: ["sklearn::rmse"],
        finite: 1,
        missing: 0,
        best: "sklearn::rmse",
        worst: "sklearn::rmse",
        mean: 0.3,
        range: [0.3, 0.3],
      },
    ]);
    expect(robustness.groupByKey.get("dag-ml")?.count).toBe(3);
  });

  it("builds complementarity pairs from each candidate's best finite score per context", () => {
    const complementarity = buildResultAnalysisComplementarityViewModel(
      { scoreColumn: "cv_val_score", chains: complementarityStore.chains },
      {
        candidateField: "model_class",
        contextField: "dataset_name",
        lowerBetter: true,
      },
    );

    expect(complementarity.candidateKeys).toEqual(["PLSRegression", "RandomForestRegressor", "SVR"]);
    expect(complementarity.contextKeys).toEqual(["Corn", "Soy"]);
    expect(complementarity.entryByKey.get("PLSRegression::Corn")?.chainId).toBe("pls-corn::rmse");
    expect(complementarity.entryByKey.get("SVR::Corn")).toBeUndefined();
    expect(complementarity.pairs).toEqual([
      {
        leftKey: "PLSRegression",
        rightKey: "RandomForestRegressor",
        sharedContextCount: 2,
        leftWins: 1,
        rightWins: 1,
        ties: 0,
        comparedContextKeys: ["Corn", "Soy"],
        leftScoreMean: 0.21,
        rightScoreMean: 0.22499999999999998,
      },
    ]);
  });

  it("keeps score helper behavior deterministic for matrix and pair aggregation", () => {
    expect(getResultAnalysisMeanScore([])).toBeNull();
    expect(getResultAnalysisMeanScore([1, 2, 3])).toBe(2);
    expect(getResultAnalysisScoreRange([])).toBeNull();
    expect(getResultAnalysisScoreRange([3, 1, 2])).toEqual([1, 3]);
    expect(getResultAnalysisInternalCellKey("a", "b")).toBe("a\u0000b");
    expect(getResultAnalysisDisplayCellKey("a", "b")).toBe("a::b");
    expect(isPreferredResultAnalysisScore(0.1, 0.2, "chain-b", "chain-a", true)).toBe(true);
    expect(isPreferredResultAnalysisScore(0.2, 0.2, "chain-a", "chain-b", true)).toBe(true);
    expect(isPreferredResultAnalysisScore(0.2, 0.2, "chain-c", "chain-b", true)).toBe(false);
  });

  it("requires score columns and distinct complementarity axes", () => {
    expect(() => buildResultAnalysisRobustnessViewModel(
      { chains: aggregationStore.chains },
      { groupField: "backend" },
    )).toThrow("requires a score column");

    expect(() => buildResultAnalysisComplementarityViewModel(
      { scoreColumn: "cv_val_score", chains: complementarityStore.chains },
      {
        candidateField: "model_class",
        contextField: "model_class",
      },
    )).toThrow("requires distinct candidate and context fields");
  });
});

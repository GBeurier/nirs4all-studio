import { describe, expect, it } from "vitest";

import {
  buildResultAnalysisLeaderboardViewModel,
  buildResultAnalysisMatrixViewModel,
  buildResultAnalysisViewModelSummaryCounters,
} from "@/lib/inspector/resultAnalysisViewModels";
import { buildResultAnalysisStoreFromMetricRecords } from "@/lib/inspector/resultAnalysisStore";

const store = buildResultAnalysisStoreFromMetricRecords({
  source: { id: "view-models", kind: "benchmark_export", label: "View Models" },
  defaults: { runId: "run-a", taskType: "regression", pipelineStatus: "completed" },
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
      resultId: "pls-corn-best",
      pipelineId: "pipe-pls",
      datasetName: "Corn",
      modelClass: "PLSRegression",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.1,
    },
    {
      resultId: "rf-corn",
      pipelineId: "pipe-rf",
      datasetName: "Corn",
      modelClass: "RandomForestRegressor",
      metric: "rmse",
      scoreColumn: "validation",
      score: 0.2,
    },
    {
      resultId: "svr-soy",
      pipelineId: "pipe-svr",
      datasetName: "Soy",
      modelClass: "SVR",
      metric: "rmse",
      scoreColumn: "validation",
      score: null,
    },
  ],
});

describe("result analysis view models", () => {
  it("builds leaderboard rows with rank and score availability counts", () => {
    const leaderboard = buildResultAnalysisLeaderboardViewModel({
      scoreColumn: "cv_val_score",
      chains: store.chains,
    });

    expect(leaderboard.finiteScoreCount).toBe(3);
    expect(leaderboard.missingScoreCount).toBe(1);
    expect(leaderboard.rows.map(row => [row.rank, row.chainId, row.score, row.datasetName, row.modelClass])).toEqual([
      [1, "pls-corn::rmse", 0.12, "Corn", "PLSRegression"],
      [2, "pls-corn-best::rmse", 0.1, "Corn", "PLSRegression"],
      [3, "rf-corn::rmse", 0.2, "Corn", "RandomForestRegressor"],
      [4, "svr-soy::rmse", null, "Soy", "SVR"],
    ]);
  });

  it("builds matrix cells with sorted keys, best score selection, and means", () => {
    const matrix = buildResultAnalysisMatrixViewModel(
      {
        scoreColumn: "cv_val_score",
        chains: store.chains,
      },
      {
        rowField: "dataset_name",
        columnField: "model_class",
        lowerBetter: true,
      },
    );

    expect(matrix.rowKeys).toEqual(["Corn", "Soy"]);
    expect(matrix.columnKeys).toEqual(["PLSRegression", "RandomForestRegressor", "SVR"]);
    expect(matrix.cellByKey.get("Corn::PLSRegression")).toMatchObject({
      rowKey: "Corn",
      columnKey: "PLSRegression",
      chainIds: ["pls-corn::rmse", "pls-corn-best::rmse"],
      count: 2,
      bestChainId: "pls-corn-best::rmse",
      bestScore: 0.1,
      meanScore: 0.11,
    });
    expect(matrix.cellByKey.get("Soy::SVR")).toMatchObject({
      bestChainId: null,
      bestScore: null,
      meanScore: null,
    });
  });

  it("requires score columns for scored view models", () => {
    expect(() => buildResultAnalysisLeaderboardViewModel({ chains: store.chains })).toThrow("requires a score column");
    expect(() => buildResultAnalysisMatrixViewModel(
      { chains: store.chains },
      {
        rowField: "dataset_name",
        columnField: "model_class",
      },
    )).toThrow("requires a score column");
  });

  it("projects leaderboard and matrix view models into UI-ready summary counters", () => {
    const leaderboard = buildResultAnalysisLeaderboardViewModel({
      scoreColumn: "cv_val_score",
      chains: store.chains,
    });
    const matrix = buildResultAnalysisMatrixViewModel(
      {
        scoreColumn: "cv_val_score",
        chains: store.chains,
      },
      {
        rowField: "dataset_name",
        columnField: "model_class",
        lowerBetter: true,
      },
    );

    expect(buildResultAnalysisViewModelSummaryCounters({ leaderboard, matrix })).toEqual([
      {
        id: "leaderboard.total",
        source: "leaderboard",
        label: "Chains",
        value: 4,
        formattedValue: "4",
      },
      {
        id: "leaderboard.scored",
        source: "leaderboard",
        label: "Scored chains",
        value: 3,
        formattedValue: "3",
      },
      {
        id: "leaderboard.missing",
        source: "leaderboard",
        label: "Missing scores",
        value: 1,
        formattedValue: "1",
      },
      {
        id: "matrix.rows",
        source: "matrix",
        label: "Matrix rows",
        value: 2,
        formattedValue: "2",
      },
      {
        id: "matrix.columns",
        source: "matrix",
        label: "Matrix columns",
        value: 3,
        formattedValue: "3",
      },
      {
        id: "matrix.cells",
        source: "matrix",
        label: "Observed cells",
        value: 3,
        formattedValue: "3",
      },
      {
        id: "matrix.scoredCells",
        source: "matrix",
        label: "Scored cells",
        value: 2,
        formattedValue: "2",
      },
      {
        id: "matrix.assignments",
        source: "matrix",
        label: "Cell assignments",
        value: 4,
        formattedValue: "4",
      },
    ]);
  });

  it("returns no summary counters when no source view models are provided", () => {
    expect(buildResultAnalysisViewModelSummaryCounters({})).toEqual([]);
  });
});

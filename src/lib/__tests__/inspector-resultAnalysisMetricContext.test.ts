import { describe, expect, it } from "vitest";

import { buildResultAnalysisMetricSelectionContext } from "@/lib/inspector/resultAnalysisMetricContext";
import { buildResultAnalysisStoreFromEntries } from "@/lib/inspector/resultAnalysisStore";

describe("resultAnalysisMetricContext", () => {
  it("builds MetricSelector context from result-analysis store scope", () => {
    const store = buildResultAnalysisStoreFromEntries({
      source: { id: "summary", kind: "result_repository" },
      entries: [
        {
          chainId: "regression-a",
          metric: "rmse",
          taskType: "regression",
          scores: { cv_val_score: 0.12 },
        },
        {
          chainId: "classification-a",
          metric: "accuracy",
          taskType: "classification",
          scores: { cv_val_score: 0.9 },
        },
        {
          chainId: "unknown-metric",
          metric: "custom_metric",
          taskType: "classification",
          scores: { cv_val_score: 1 },
        },
      ],
    });

    expect(buildResultAnalysisMetricSelectionContext(store)).toEqual({
      taskType: null,
      taskTypes: ["classification", "regression"],
      availableMetricKeys: ["rmse", "accuracy"],
    });
  });

  it("returns a single task type when all chains share the same task family", () => {
    const store = buildResultAnalysisStoreFromEntries({
      source: { id: "summary", kind: "result_repository" },
      entries: [
        {
          chainId: "classification-a",
          metric: "accuracy",
          taskType: "binary_classification",
          scores: { cv_val_score: 0.9 },
        },
      ],
    });

    expect(buildResultAnalysisMetricSelectionContext(store)).toEqual({
      taskType: "classification",
      taskTypes: ["classification"],
      availableMetricKeys: ["accuracy"],
    });
  });

  it("fills incomplete scope metrics from metric observations ScoreRefs", () => {
    const store = buildResultAnalysisStoreFromEntries({
      source: { id: "summary", kind: "result_repository" },
      entries: [
        {
          chainId: "rmse-chain",
          metric: "rmse",
          taskType: "regression",
          scores: { cv_val_score: 0.12 },
        },
        {
          chainId: "r2-chain",
          metric: "r2",
          taskType: "regression",
          scores: { cv_val_score: 0.92 },
        },
        {
          chainId: "blank-metric-chain",
          metric: null,
          taskType: "regression",
          scores: { cv_val_score: 0.3 },
        },
      ],
    });

    expect(buildResultAnalysisMetricSelectionContext({
      ...store,
      scope: {
        ...store.scope,
        metrics: ["rmse"],
      },
    })).toEqual({
      taskType: "regression",
      taskTypes: ["regression"],
      availableMetricKeys: ["r2", "rmse"],
    });
  });
});

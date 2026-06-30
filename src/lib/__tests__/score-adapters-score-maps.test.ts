import { describe, expect, it } from "vitest";

import { collectScoreMetricKeys, projectFinalScoreMaps } from "../score-adapters-score-maps";

describe("score adapter score map projection", () => {
  it("collects known, flat, and nested partition metric keys", () => {
    expect(collectScoreMetricKeys(
      { custom_cv_metric: 0.3 },
      { test: { target_a_rmse: 0.2 }, train: { target_a_rmse: 0.1 } },
    )).toEqual(expect.arrayContaining([
      "rmse",
      "r2",
      "custom_cv_metric",
      "target_a_rmse",
    ]));
  });

  it("projects nested final scores while preserving metrics discovered from companion sources", () => {
    const projected = projectFinalScoreMaps(
      {
        test: { rmse: "0.21", target_a_rmse: 0.32 },
        train: { rmse: 0.11 },
      },
      { cv_only_metric: 0.4 },
      { test: { aggregated_only_metric: 0.18 } },
    );

    expect(projected.testScores.rmse).toBe(0.21);
    expect(projected.testScores.target_a_rmse).toBe(0.32);
    expect(projected.trainScores.rmse).toBe(0.11);
    expect(projected.testScores.cv_only_metric).toBeNull();
    expect(projected.testScores.aggregated_only_metric).toBeNull();
  });

  it("returns empty score maps when the source payload is missing", () => {
    expect(projectFinalScoreMaps(null, { rmse: 0.2 })).toEqual({
      testScores: {},
      trainScores: {},
    });
  });
});

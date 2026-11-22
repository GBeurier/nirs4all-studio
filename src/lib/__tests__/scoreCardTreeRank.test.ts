import { describe, expect, it } from "vitest";

import { resolveScoreCardRankMetric, sortScoreCardRowsByRank } from "@/lib/scoreCardTreeData";
import type { ScoreCardRow } from "@/types/score-cards";

function refit(chainId: string, cv: Record<string, number>, test: Record<string, number>, foldId = "final"): ScoreCardRow {
  return {
    id: `${chainId}-${foldId}`,
    chainId,
    modelName: "PLSRegression",
    modelClass: "PLSRegression",
    preprocessings: null,
    bestParams: null,
    cardType: "refit",
    foldId,
    metric: "rmse",
    taskType: "regression",
    testScores: test,
    valScores: {},
    trainScores: {},
    avgValScores: foldId === "final" ? cv : {},
    primaryTestScore: test.rmse ?? null,
    primaryValScore: foldId === "final" ? cv.rmse ?? null : null,
    primaryTrainScore: null,
  };
}

describe("score card ranking", () => {
  // a: best CV RMSE but worst test RMSE; b: worse CV RMSE, better test RMSE.
  const a = refit("a", { rmse: 0.2, r2: 0.80 }, { rmse: 0.5 });
  const b = refit("b", { rmse: 0.3, r2: 0.90 }, { rmse: 0.1 });

  it("ranks refit rows on the CV score, never on the retained test score", () => {
    expect(sortScoreCardRowsByRank([b, a], "rmse").map(row => row.chainId)).toEqual(["a", "b"]);
  });

  it("follows the first selected metric the rows carry, with its direction", () => {
    const metric = resolveScoreCardRankMetric([a, b], ["r2", "rmse"]);
    expect(metric).toBe("r2");
    expect(sortScoreCardRowsByRank([a, b], metric).map(row => row.chainId)).toEqual(["b", "a"]);
  });

  it("falls back to the primary metric when no selected metric is available", () => {
    expect(resolveScoreCardRankMetric([a, b], ["mae"])).toBe("rmse");
  });

  it("keeps an aggregated refit row with its chain's CV rank", () => {
    const aggregated = refit("b", {}, { rmse: 0.05 }, "final_agg");
    expect(sortScoreCardRowsByRank([aggregated, a, b], "rmse").map(row => row.id)).toEqual(["a-final", "b-final_agg", "b-final"]);
  });
});

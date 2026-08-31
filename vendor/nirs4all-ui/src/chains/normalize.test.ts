import { describe, expect, it } from "vitest";

import { computeChainPoints, orientedValue, percentileRanks, zScores } from "./normalize.js";
import type { ChainMetric, ScoredChain } from "./types.js";

const NRMSE: ChainMetric = { key: "nrmse", label: "nRMSE", lowerIsBetter: true };

describe("orientedValue", () => {
  it("flips error metrics so higher is better", () => {
    expect(orientedValue(0.2, true)).toBeLessThan(orientedValue(0.1, true));
    expect(orientedValue(0.9, false)).toBeGreaterThan(orientedValue(0.8, false));
  });
});

describe("percentileRanks", () => {
  it("maps best (largest) value to 1 and worst to 0", () => {
    const ranks = percentileRanks([10, 20, 30]);
    expect(ranks).toEqual([0, 0.5, 1]);
  });

  it("averages ties", () => {
    const ranks = percentileRanks([5, 5, 9]);
    expect(ranks[0]).toBeCloseTo(0.25, 6);
    expect(ranks[1]).toBeCloseTo(0.25, 6);
    expect(ranks[2]).toBeCloseTo(1, 6);
  });

  it("returns 0.5 for a single value and [] for none", () => {
    expect(percentileRanks([42])).toEqual([0.5]);
    expect(percentileRanks([])).toEqual([]);
  });
});

describe("zScores", () => {
  it("centers and scales to unit sd", () => {
    const z = zScores([1, 2, 3]);
    expect(z[1]).toBeCloseTo(0, 6);
    expect(z[0]).toBeCloseTo(-z[2]!, 6);
  });

  it("returns zeros for a zero-spread list", () => {
    expect(zScores([7, 7, 7])).toEqual([0, 0, 0]);
  });
});

describe("computeChainPoints", () => {
  const chains: ScoredChain[] = [
    { id: "a", score: 0.10, dataset: "d1", steps: [{ token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] },
    { id: "b", score: 0.20, dataset: "d1", steps: [{ token: "msc", role: "preprocess" }, { token: "pls", role: "model" }] },
    { id: "c", score: 5.00, dataset: "d2", steps: [{ token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] },
    { id: "d", score: 9.00, dataset: "d2", steps: [{ token: "msc", role: "preprocess" }, { token: "pls", role: "model" }] },
  ];

  it("normalizes rank within each dataset independently", () => {
    const points = computeChainPoints(chains, NRMSE, "rankByDataset");
    // within d1 the lower nRMSE (a) is best → goodness 1; within d2 (c) best → 1
    expect(points.find((p) => p.id === "a")!.goodness).toBeCloseTo(1, 6);
    expect(points.find((p) => p.id === "b")!.goodness).toBeCloseTo(0, 6);
    expect(points.find((p) => p.id === "c")!.goodness).toBeCloseTo(1, 6);
    expect(points.find((p) => p.id === "d")!.goodness).toBeCloseTo(0, 6);
  });

  it("keeps the raw oriented score under the raw lens", () => {
    const points = computeChainPoints(chains, NRMSE, "raw");
    expect(points.find((p) => p.id === "a")!.goodness).toBeCloseTo(-0.1, 6);
  });

  it("dedupes ordered tokens and records membership", () => {
    const points = computeChainPoints(
      [{ id: "x", score: 1, steps: [{ token: "snv", role: "preprocess" }, { token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] }],
      NRMSE,
      "raw",
    );
    expect(points[0]!.orderedTokens.map((t) => t.token)).toEqual(["snv", "pls"]);
    expect(points[0]!.tokens).toEqual(["snv", "pls"]);
    expect(points[0]!.dataset).toBe("∗");
  });
});

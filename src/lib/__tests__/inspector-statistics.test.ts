import { describe, expect, it } from "vitest";
import {
  aggregateScores,
  mean,
  quantile,
  summarizeScores,
} from "@/lib/inspector/statistics";

describe("inspector statistics", () => {
  it("computes interpolated quantiles and clamps q to [0, 1]", () => {
    const sorted = [0, 1, 2, 3, 4];
    expect(quantile(sorted, 0)).toBe(0);
    expect(quantile(sorted, 0.5)).toBe(2);
    expect(quantile(sorted, 0.25)).toBe(1);
    expect(quantile(sorted, 0.75)).toBe(3);
    expect(quantile(sorted, 1)).toBe(4);
    // out-of-range q is clamped to the array bounds
    expect(quantile(sorted, -1)).toBe(0);
    expect(quantile(sorted, 2)).toBe(4);
  });

  it("interpolates between neighbouring values", () => {
    expect(quantile([0, 10], 0.5)).toBe(5);
    expect(quantile([0, 10], 0.1)).toBeCloseTo(1, 10);
  });

  it("returns NaN for empty inputs", () => {
    expect(quantile([], 0.5)).toBeNaN();
    expect(mean([])).toBeNaN();
  });

  it("computes the arithmetic mean without mutating its input", () => {
    const values = [2, 4, 6];
    expect(mean(values)).toBe(4);
    expect(values).toEqual([2, 4, 6]);
  });

  it("summarizes unsorted scores and leaves the input untouched", () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6];
    const summary = summarizeScores(values);
    expect(summary.mean).toBeCloseTo(31 / 8, 10);
    expect(summary.median).toBe(3.5);
    expect(summary.q25).toBeCloseTo(1.75, 10);
    expect(summary.q75).toBeCloseTo(5.25, 10);
    expect(values).toEqual([3, 1, 4, 1, 5, 9, 2, 6]);
  });

  describe("aggregateScores", () => {
    const scores = [0.1, 0.5, 0.3, 0.9];

    it("honours metric direction for best/worst", () => {
      expect(aggregateScores(scores, true, "best")).toBe(0.1);
      expect(aggregateScores(scores, true, "worst")).toBe(0.9);
      expect(aggregateScores(scores, false, "best")).toBe(0.9);
      expect(aggregateScores(scores, false, "worst")).toBe(0.1);
    });

    it("ignores direction for mean/median", () => {
      expect(aggregateScores([1, 2, 3], true, "mean")).toBe(2);
      expect(aggregateScores([1, 2, 3], false, "mean")).toBe(2);
      expect(aggregateScores([1, 2, 3, 4], true, "median")).toBe(2.5);
    });

    it("does not mutate the input array", () => {
      const input = [0.9, 0.1, 0.5];
      aggregateScores(input, true, "best");
      expect(input).toEqual([0.9, 0.1, 0.5]);
    });
  });
});

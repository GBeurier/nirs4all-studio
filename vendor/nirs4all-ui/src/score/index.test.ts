/**
 * Pins the public surface of the `nirs4all-ui/score` foundation barrel.
 *
 * The barrel is the contract app code (and, later, a second host) imports
 * against. This test fails loudly if a re-export is dropped or renamed, and
 * doubles as a smoke test that the metricKeys → scoreValues/scoreMetricCatalog
 * layering is wired correctly through the barrel.
 */
import { describe, expect, it } from "vitest";

import * as scoreFoundation from "./index.js";

describe("nirs4all-ui/score barrel", () => {
  it("re-exports the metric-key helpers", () => {
    expect(typeof scoreFoundation.normalizeMetricLookupKey).toBe("function");
    expect(typeof scoreFoundation.canonicalMetricKey).toBe("function");
    expect(typeof scoreFoundation.metricKeyCandidates).toBe("function");
  });

  it("re-exports the score-value helpers", () => {
    expect(typeof scoreFoundation.parseScoreNumber).toBe("function");
    expect(typeof scoreFoundation.parseJsonRecord).toBe("function");
    expect(typeof scoreFoundation.isLowerBetter).toBe("function");
    expect(typeof scoreFoundation.isBetterScore).toBe("function");
    expect(typeof scoreFoundation.formatScore).toBe("function");
    expect(typeof scoreFoundation.formatMetricValue).toBe("function");
    expect(typeof scoreFoundation.formatMetricName).toBe("function");
    expect(typeof scoreFoundation.formatMetricDisplayName).toBe("function");
  });

  it("re-exports the metric catalog + selection helpers", () => {
    expect(typeof scoreFoundation.getAvailableMetrics).toBe("function");
    expect(typeof scoreFoundation.getMetricsForTaskType).toBe("function");
    expect(typeof scoreFoundation.orderMetricKeys).toBe("function");
    expect(typeof scoreFoundation.isClassificationTaskType).toBe("function");
    expect(Array.isArray(scoreFoundation.REGRESSION_METRICS)).toBe(true);
    expect(Array.isArray(scoreFoundation.CLASSIFICATION_METRICS)).toBe(true);
  });

  it("wires the layers together through the barrel (canonicalization → direction)", () => {
    // metricKeys canonicalization feeds scoreValues direction logic.
    expect(scoreFoundation.canonicalMetricKey("RMSEP")).toBe("rmse");
    expect(scoreFoundation.isLowerBetter("RMSEP")).toBe(true);
    expect(scoreFoundation.isBetterScore(0.3, 0.5, "rmsep")).toBe(true);
    expect(scoreFoundation.isBetterScore(0.9, 0.8, "r2")).toBe(true);
  });
});

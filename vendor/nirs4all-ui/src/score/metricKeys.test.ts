import { describe, expect, it } from "vitest";

import { canonicalMetricKey, metricKeyCandidates, normalizeMetricLookupKey } from "./metricKeys.js";

describe("normalizeMetricLookupKey", () => {
  it("lowercases, trims, and collapses spaces/hyphens to underscores", () => {
    expect(normalizeMetricLookupKey("  R2 Score ")).toBe("r2_score");
    expect(normalizeMetricLookupKey("Max-Error")).toBe("max_error");
    expect(normalizeMetricLookupKey("balanced   accuracy")).toBe("balanced_accuracy");
  });

  it("returns empty string for null/undefined/blank", () => {
    expect(normalizeMetricLookupKey(null)).toBe("");
    expect(normalizeMetricLookupKey(undefined)).toBe("");
    expect(normalizeMetricLookupKey("   ")).toBe("");
  });
});

describe("canonicalMetricKey", () => {
  it("maps known aliases onto canonical keys", () => {
    expect(canonicalMetricKey("root_mean_squared_error")).toBe("rmse");
    expect(canonicalMetricKey("RMSEP")).toBe("rmse");
    expect(canonicalMetricKey("rmsecv")).toBe("rmse");
    expect(canonicalMetricKey("r2_score")).toBe("r2");
    expect(canonicalMetricKey("AUC")).toBe("roc_auc");
    expect(canonicalMetricKey("mcc")).toBe("matthews_corrcoef");
  });

  it("passes through unknown but normalized keys", () => {
    expect(canonicalMetricKey("R2")).toBe("r2");
    expect(canonicalMetricKey("sep")).toBe("sep");
    expect(canonicalMetricKey("something_custom")).toBe("something_custom");
  });

  it("returns empty string for blank input", () => {
    expect(canonicalMetricKey(null)).toBe("");
    expect(canonicalMetricKey("")).toBe("");
  });
});

describe("metricKeyCandidates", () => {
  it("includes the canonical key, normalized input, and known aliases", () => {
    const candidates = metricKeyCandidates("RMSEP");
    expect(candidates).toContain("rmse");
    expect(candidates).toContain("rmsep");
    expect(candidates).toContain("rmsecv");
    // No duplicates
    expect(new Set(candidates).size).toBe(candidates.length);
  });

  it("puts the canonical key first", () => {
    expect(metricKeyCandidates("rmsep")[0]).toBe("rmse");
  });

  it("returns an empty array for blank input", () => {
    expect(metricKeyCandidates(null)).toEqual([]);
    expect(metricKeyCandidates("")).toEqual([]);
  });

  it("works for a key that is its own canonical form", () => {
    expect(metricKeyCandidates("r2")).toContain("r2");
  });
});

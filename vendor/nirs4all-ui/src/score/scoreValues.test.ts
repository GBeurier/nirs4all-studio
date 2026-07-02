import { describe, expect, it } from "vitest";

import {
  formatMetricDisplayName,
  formatMetricName,
  formatMetricValue,
  formatScore,
  isBetterScore,
  isLowerBetter,
  parseScoreNumber,
} from "./scoreValues.js";

describe("parseScoreNumber", () => {
  it("returns finite numbers as-is", () => {
    expect(parseScoreNumber(0.5)).toBe(0.5);
    expect(parseScoreNumber(0)).toBe(0);
    expect(parseScoreNumber(-3)).toBe(-3);
  });

  it("parses numeric strings", () => {
    expect(parseScoreNumber("1.25")).toBe(1.25);
    expect(parseScoreNumber("  2 ")).toBe(2);
  });

  it("returns null for non-finite, non-numeric, or other types", () => {
    expect(parseScoreNumber(Number.NaN)).toBeNull();
    expect(parseScoreNumber(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseScoreNumber("abc")).toBeNull();
    expect(parseScoreNumber(null)).toBeNull();
    expect(parseScoreNumber(undefined)).toBeNull();
    expect(parseScoreNumber({})).toBeNull();
  });
});

describe("isLowerBetter", () => {
  it("is true for error metrics (including aliases)", () => {
    expect(isLowerBetter("rmse")).toBe(true);
    expect(isLowerBetter("RMSEP")).toBe(true);
    expect(isLowerBetter("mae")).toBe(true);
    expect(isLowerBetter("log_loss")).toBe(true);
  });

  it("is false for higher-is-better metrics and unknowns", () => {
    expect(isLowerBetter("r2")).toBe(false);
    expect(isLowerBetter("accuracy")).toBe(false);
    expect(isLowerBetter(null)).toBe(false);
    expect(isLowerBetter("mystery")).toBe(false);
  });
});

describe("isBetterScore", () => {
  it("higher wins for higher-is-better metrics", () => {
    expect(isBetterScore(0.9, 0.8, "r2")).toBe(true);
    expect(isBetterScore(0.8, 0.9, "r2")).toBe(false);
  });

  it("lower wins for error metrics", () => {
    expect(isBetterScore(0.3, 0.5, "rmse")).toBe(true);
    expect(isBetterScore(0.5, 0.3, "rmse")).toBe(false);
  });
});

describe("formatScore", () => {
  it("formats to 4 decimals", () => {
    expect(formatScore(0.123456)).toBe("0.1235");
    expect(formatScore("0.5")).toBe("0.5000");
  });

  it("returns dash for null/undefined/non-finite", () => {
    expect(formatScore(null)).toBe("-");
    expect(formatScore(undefined)).toBe("-");
    expect(formatScore("abc")).toBe("-");
    expect(formatScore(Number.NaN)).toBe("-");
  });
});

describe("formatMetricValue", () => {
  it("uses 3 decimals for error metrics, 4 otherwise", () => {
    expect(formatMetricValue(0.123456, "rmse")).toBe("0.123");
    expect(formatMetricValue(0.123456, "r2")).toBe("0.1235");
    expect(formatMetricValue(0.123456)).toBe("0.1235");
  });

  it("returns dash for null/undefined/non-finite", () => {
    expect(formatMetricValue(null, "rmse")).toBe("-");
    expect(formatMetricValue("nope", "r2")).toBe("-");
  });
});

describe("formatMetricName", () => {
  it("uppercases the canonical key", () => {
    expect(formatMetricName("rmsep")).toBe("RMSE");
    expect(formatMetricName("r2_score")).toBe("R2");
  });

  it("falls back to the normalized key when not canonical", () => {
    expect(formatMetricName("my custom metric")).toBe("MY_CUSTOM_METRIC");
  });

  it("returns empty string for blank input", () => {
    expect(formatMetricName(null)).toBe("");
    expect(formatMetricName("")).toBe("");
  });
});

describe("formatMetricDisplayName", () => {
  it("formats canonical and aliased metric keys as readable labels", () => {
    expect(formatMetricDisplayName("rmsep")).toBe("RMSE");
    expect(formatMetricDisplayName("balanced_accuracy")).toBe("Balanced Accuracy");
    expect(formatMetricDisplayName("r2_score")).toBe("R2");
  });

  it("formats runtime-only benchmark and repository metric keys", () => {
    expect(formatMetricDisplayName("benchmark-latency-ms")).toBe("Benchmark Latency MS");
    expect(formatMetricDisplayName("repository custom score")).toBe("Repository Custom Score");
  });

  it("returns empty string for blank input", () => {
    expect(formatMetricDisplayName(null)).toBe("");
    expect(formatMetricDisplayName("")).toBe("");
  });
});

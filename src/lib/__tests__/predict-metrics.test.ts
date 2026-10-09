import { describe, expect, it } from "vitest";

import { enT } from "./enT";

import {
  getPredictionMetricLabel,
  getPredictionMetricName,
} from "@/lib/predict-metrics";

describe("predict metric labels", () => {
  it("renames rmse-like prediction metrics to RMSEP", () => {
    expect(getPredictionMetricName("rmse", enT)).toBe("RMSEP");
    expect(getPredictionMetricName("rmsep", enT)).toBe("RMSEP");
    expect(getPredictionMetricLabel("rmse", enT)).toBe("Prediction: RMSEP");
  });

  it("keeps non-rmse metrics readable", () => {
    expect(getPredictionMetricLabel("r2", enT)).toBe("Prediction: R2");
  });

  it("falls back to a translated generic name when no metric is known", () => {
    expect(getPredictionMetricName(null, enT)).toBe("Score");
  });
});

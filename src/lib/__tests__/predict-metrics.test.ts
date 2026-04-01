import { describe, expect, it } from "vitest";

import {
  getPredictionMetricLabel,
  getPredictionMetricName,
  getSelectionMetricLabel,
} from "@/lib/predict-metrics";

describe("predict metric labels", () => {
  it("renames rmse-like prediction metrics to RMSEP", () => {
    expect(getPredictionMetricName("rmse")).toBe("RMSEP");
    expect(getPredictionMetricName("rmsep")).toBe("RMSEP");
    expect(getPredictionMetricLabel("rmse")).toBe("Prediction: RMSEP");
  });

  it("renames rmse-like selection metrics to RMSECV", () => {
    expect(getSelectionMetricLabel("rmse")).toBe("Selection: RMSECV");
    expect(getSelectionMetricLabel("rmsep")).toBe("Selection: RMSECV");
  });

  it("keeps non-rmse metrics readable", () => {
    expect(getPredictionMetricLabel("r2")).toBe("Prediction: R2");
    expect(getSelectionMetricLabel("accuracy")).toBe("Selection: ACCURACY");
  });
});

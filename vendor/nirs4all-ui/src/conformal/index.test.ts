import { describe, expect, it } from "vitest";

import * as conformalFoundation from "./index.js";

describe("nirs4all-ui/conformal barrel", () => {
  it("re-exports conformal calibrated-result view-model helpers", () => {
    expect(typeof conformalFoundation.parseCalibratedRunResultArtifact).toBe("function");
    expect(typeof conformalFoundation.parseConformalMetricSet).toBe("function");
    expect(typeof conformalFoundation.createConformalGuaranteeView).toBe("function");
    expect(typeof conformalFoundation.createConformalGuaranteeViewForArtifact).toBe("function");
    expect(typeof conformalFoundation.createConformalCoverageOptions).toBe("function");
    expect(typeof conformalFoundation.createConformalIntervalSummaryRows).toBe("function");
    expect(typeof conformalFoundation.createConformalMetricRows).toBe("function");
    expect(typeof conformalFoundation.createConformalPredictionRows).toBe("function");
    expect(typeof conformalFoundation.parseDagMlConformalPresentationV1).toBe("function");
    expect(typeof conformalFoundation.createConformalPredictionRowsFromDagMlPresentation).toBe("function");
    expect(conformalFoundation.formatConformalCoverage(0.8)).toBe("80%");
  });
});

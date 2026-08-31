/**
 * Pins the public surface of the `nirs4all-ui/robustness` foundation barrel.
 */
import { describe, expect, it } from "vitest";

import * as robustnessFoundation from "./index.js";

describe("nirs4all-ui/robustness barrel", () => {
  it("re-exports robustness summary contract helpers", () => {
    expect(robustnessFoundation.ROBUSTNESS_SUMMARY_FORMAT).toBe("nirs4all.robustness.summary");
    expect(robustnessFoundation.ROBUSTNESS_SUMMARY_SCHEMA_VERSION).toBe(1);
    expect(typeof robustnessFoundation.isRobustnessSummaryArtifact).toBe("function");
    expect(typeof robustnessFoundation.parseRobustnessSummaryArtifact).toBe("function");
    expect(typeof robustnessFoundation.createRobustnessGuaranteeView).toBe("function");
    expect(typeof robustnessFoundation.createRobustnessSummaryCards).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessConformalGuaranteeStatus).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessSpectralReplay).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessCoverageStatus).toBe("function");
    expect(typeof robustnessFoundation.formatRobustnessSummaryMetric).toBe("function");
    expect(robustnessFoundation.ROBUSTNESS_SCENARIO_KINDS).toContain("spectral_shift");
    expect(robustnessFoundation.ROBUSTNESS_SCENARIO_DISTRIBUTIONS).toEqual(["normal", "uniform"]);
    expect(robustnessFoundation.ROBUSTNESS_MODES).toContain("clean_frozen");
    expect(robustnessFoundation.ROBUSTNESS_EXECUTABLE_MODES).toEqual(["clean_frozen"]);
    expect(typeof robustnessFoundation.validateRobustnessScenarioDraft).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessScenarioKindOptions).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessScenarioDistributionOptions).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessModeOptions).toBe("function");
    expect(typeof robustnessFoundation.getRobustnessModeOptionsFromRegistry).toBe("function");
  });
});

import { describe, expect, it } from "vitest";

import {
  buildDecisionView,
  DECISION_DISPLAY,
  isDecisionColor,
} from "./decision.js";

describe("lab/decision", () => {
  it("returns reliable for a clean, dense, in-domain prediction", () => {
    const v = buildDecisionView({ applicabilityScore: 0.2, localDensity: 0.8, intervalWidth: 0.1 });
    expect(v.color).toBe("reliable");
    expect(v.confidence).toBe("high");
    expect(v.detailAvailable).toBe(true);
    expect(v.colorClass).toBe(DECISION_DISPLAY.reliable.colorClass);
  });

  it("flags a strong outlier as out_of_domain (never auto-usable — golden rule)", () => {
    const v = buildDecisionView({ strongOutlier: true, applicabilityScore: 0.1 });
    expect(v.color).toBe("out_of_domain");
  });

  it("rejects a negative OOD gate outright", () => {
    expect(buildDecisionView({ gateRejected: true }).color).toBe("out_of_domain");
  });

  it("uses caution at the border of the domain", () => {
    const v = buildDecisionView({ applicabilityScore: 1.4 }, { adWarn: 1, adReject: 2 });
    expect(v.color).toBe("caution");
    expect(v.confidence).toBe("medium");
  });

  it("marks a clean but rare sample as informative (not 'good')", () => {
    const v = buildDecisionView({ applicabilityScore: 0.3, localDensity: 0.05 }, { lowDensity: 0.15 });
    expect(v.color).toBe("informative");
    expect(v.category).toBe("enrichment_candidate");
  });

  it("honours per-method interval thresholds", () => {
    const v = buildDecisionView({ intervalWidth: 5 }, { intervalMax: 4 });
    expect(v.color).toBe("out_of_domain");
    const caution = buildDecisionView({ intervalWidth: 3 }, { intervalWarn: 2, intervalMax: 4 });
    expect(caution.color).toBe("caution");
  });

  it("degrades gracefully with no signals", () => {
    expect(buildDecisionView({}).color).toBe("reliable");
  });

  it("isDecisionColor guards the union", () => {
    expect(isDecisionColor("reliable")).toBe(true);
    expect(isDecisionColor("nope")).toBe(false);
  });
});

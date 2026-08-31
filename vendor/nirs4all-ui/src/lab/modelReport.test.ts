import { describe, expect, it } from "vitest";

import { buildModelReportView, gradeModel } from "./modelReport.js";
import { summarizeHealth } from "./health.js";
import { buildBudgetCurveView } from "./budget.js";
import { buildWorklistItemView, resolveSafety, summarizeWorklist } from "./worklist.js";

describe("lab/modelReport", () => {
  it("grades quantification / screening / insufficient from RPD", () => {
    expect(gradeModel({ rpd: 3 })).toBe("quantification");
    expect(gradeModel({ rpd: 2.2 })).toBe("screening");
    expect(gradeModel({ rpd: 1.5 })).toBe("insufficient");
  });

  it("falls back to RPIQ when RPD is absent", () => {
    expect(gradeModel({ rpiq: 4.5 })).toBe("quantification");
    expect(gradeModel({ rpiq: 2.4 })).toBe("screening");
  });

  it("honours per-method threshold overrides", () => {
    expect(gradeModel({ rpd: 2.2 }, { rpdQuantification: 2 })).toBe("quantification");
  });

  it("builds a verdict + a metric reading per metric", () => {
    const v = buildModelReportView({ rpd: 2.4, r2: 0.92, rmse: 0.31, bias: 0.0, rpiq: 3 });
    expect(v.grade).toBe("screening");
    expect(v.metrics).toHaveLength(5);
    const rpd = v.metrics.find((m) => m.key === "rpd");
    expect(rpd?.reading).toContain("RPD");
    expect(rpd?.tone).toBe("fair");
  });
});

describe("lab/health summary", () => {
  it("docks the score per finding and reports the worst level", () => {
    const s = summarizeHealth([
      { id: "a", title: "x", severity: "warning" },
      { id: "b", title: "y", severity: "critical" },
    ]);
    expect(s.level).toBe("critical");
    expect(s.score).toBe(100 - 20 - 6);
    expect(s.counts.critical).toBe(1);
  });

  it("is clean with no findings", () => {
    const s = summarizeHealth([]);
    expect(s.score).toBe(100);
    expect(s.level).toBe("ok");
  });
});

describe("lab/budget curve", () => {
  it("detects diminishing returns at the knee", () => {
    const v = buildBudgetCurveView(
      [
        { n: 5, coverage: 0.5 },
        { n: 10, coverage: 0.8 },
        { n: 15, coverage: 0.81 },
        { n: 20, coverage: 0.815 },
      ],
      { kneeThreshold: 0.02 },
    );
    expect(v.recommendedN).toBe(10);
    expect(v.hasPredictive).toBe(false);
  });
});

describe("lab/worklist summary", () => {
  it("counts safe vs verify and mentions verification", () => {
    const s = summarizeWorklist(
      [{ sampleId: "a" }, { sampleId: "b", safety: "verify" }],
      "hplc",
    );
    expect(s.total).toBe(2);
    expect(s.verify).toBe(1);
    expect(s.headline).toContain("vérifier");
  });

  it("enforces the golden rule: a strong outlier is never auto-safe", () => {
    // no explicit safety, but flagged as a strong outlier → must be 'verify'
    expect(resolveSafety({ sampleId: "x", strongOutlier: true })).toBe("verify");
    expect(resolveSafety({ sampleId: "y", decisionColor: "out_of_domain" })).toBe("verify");
    expect(buildWorklistItemView({ sampleId: "x", strongOutlier: true }).safety).toBe("verify");
    // a clean candidate stays safe
    expect(resolveSafety({ sampleId: "z" })).toBe("safe");
    // explicit override still wins
    expect(resolveSafety({ sampleId: "w", strongOutlier: true, safety: "safe" })).toBe("safe");
  });
});

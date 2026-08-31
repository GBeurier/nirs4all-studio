import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ConformalPredictionTree,
  buildConformalTreeModel,
} from "./ConformalPredictionTree.js";
import type { ConformalPredictionRow } from "../conformal/result.js";

function row(index: number, yPred: number, bands: Array<[number, number, number]>): ConformalPredictionRow {
  return {
    index,
    sampleId: `s${index}`,
    yPred,
    yPredLabel: yPred.toFixed(2),
    intervals: bands.map(([coverage, lower, upper]) => ({
      coverage,
      coverageLabel: `${coverage * 100}%`,
      lower,
      lowerLabel: lower.toFixed(2),
      upper,
      upperLabel: upper.toFixed(2),
      width: upper - lower,
      widthLabel: (upper - lower).toFixed(2),
    })),
  };
}

const ROWS: ConformalPredictionRow[] = [
  row(0, 10, [[0.5, 9.6, 10.4], [0.9, 8.8, 11.2]]), // truth 10.1 → covered by tightest → core
  row(1, 12, [[0.5, 11.6, 12.4], [0.9, 10.8, 13.2]]), // truth 13.0 → only in 90% → within (<= target)
  row(2, 14, [[0.5, 13.6, 14.4], [0.9, 12.8, 15.2]]), // truth 20.0 → violation
];
const ACTUALS = [10.1, 13.0, 20.0];

describe("buildConformalTreeModel", () => {
  it("groups by conformance when ground truth is present", () => {
    const model = buildConformalTreeModel(ROWS, { actuals: ACTUALS, targetCoverage: 0.9 });
    expect(model.groupBy).toBe("conformance");
    expect(model.coverages).toEqual([0.9, 0.5]);
    const byId = Object.fromEntries(model.tiers.map((tier) => [tier.id, tier.count]));
    expect(byId.core).toBe(1);
    expect(byId.within).toBe(1);
    expect(byId.violation).toBe(1);
  });

  it("falls back to uncertainty grouping without ground truth", () => {
    const model = buildConformalTreeModel(ROWS);
    expect(model.groupBy).toBe("uncertainty");
    expect(model.tiers.reduce((sum, tier) => sum + tier.count, 0)).toBe(3);
  });

  it("marks coveredAtTarget from the tightest covering band", () => {
    const model = buildConformalTreeModel(ROWS, { actuals: ACTUALS, targetCoverage: 0.9 });
    const all = model.tiers.flatMap((tier) => tier.samples);
    expect(all.find((s) => s.index === 0)?.coveredAtTarget).toBe(true);
    expect(all.find((s) => s.index === 2)?.coveredAtTarget).toBe(false);
    expect(all.find((s) => s.index === 2)?.tightestCovering).toBeNull();
  });
});

describe("ConformalPredictionTree", () => {
  it("renders nested tiers, sample nodes, glyphs, and level rows", () => {
    const markup = renderToStaticMarkup(
      <ConformalPredictionTree rows={ROWS} actuals={ACTUALS} targetCoverage={0.9} unit="g/kg" />,
    );
    expect(markup).toContain("n4conf-tree");
    expect(markup).toContain("n4conf-tier");
    expect(markup).toContain("n4conf-sample");
    expect(markup).toContain("n4conf-glyph");
    expect(markup).toContain("n4conf-level");
    expect(markup).toContain("Truth in the tightest band");
    expect(markup).toContain("Interval violations");
    expect(markup).toContain("covered");
    expect(markup).toContain("missed");
  });

  it("shows the guarantee header when provided", () => {
    const markup = renderToStaticMarkup(
      <ConformalPredictionTree
        rows={ROWS}
        actuals={ACTUALS}
        guarantee={{
          calibrationReplayLabel: "x",
          calibrationReplaySource: null,
          coverageLabel: "90%",
          effectiveEngine: "dag-ml",
          invalidationReasons: [],
          label: "Active conformal guarantee",
          limitations: [],
          method: "split_conformal",
          requestedEngine: "dag-ml",
          scope: "graph",
          status: "active",
          tone: "success",
          tuningCalibrationLabel: "x",
          tuningCalibrationSource: null,
          unit: "g/kg",
        }}
      />,
    );
    expect(markup).toContain("n4conf-guarantee");
    expect(markup).toContain("Active conformal guarantee");
    expect(markup).toContain("split_conformal");
    expect(markup).toContain("dag-ml");
  });

  it("renders an empty container for no rows", () => {
    const markup = renderToStaticMarkup(<ConformalPredictionTree rows={[]} />);
    expect(markup).toContain("n4conf-tree");
    expect(markup).not.toContain("n4conf-tier");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FoldStabilityLines } from "./FoldStabilityLines.js";

describe("viz/FoldStabilityLines", () => {
  it("renders one faint line per series, a mean line, and a min/max band", () => {
    const markup = renderToStaticMarkup(
      <FoldStabilityLines
        series={[
          { id: "pls", label: "PLS", scores: [0.71, 0.74, 0.7, 0.73, 0.72] },
          { id: "ridge", label: "Ridge", scores: [0.6, 0.65, 0.62, 0.64, 0.61] },
        ]}
        title="Fold R² stability"
        yLabel="R²"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-foldstability");
    expect(markup).toContain("<title>Fold R² stability</title>");
    expect(markup).toContain("n4viz-line-mean");
    expect(markup).toContain("n4viz-band");
    // Default fold labels are derived from the longest series.
    expect(markup).toContain("F1");
    expect(markup).toContain("F5");
  });

  it("renders without the mean envelope when showMean is false", () => {
    const markup = renderToStaticMarkup(
      <FoldStabilityLines series={[{ id: "a", scores: [0.5, 0.6, 0.55] }]} showMean={false} />,
    );

    expect(markup).toContain("<svg");
    expect(markup).not.toContain("n4viz-line-mean");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ScoreHeatmap } from "./ScoreHeatmap.js";

describe("ScoreHeatmap", () => {
  it("renders model x preprocessing cells with values and blanks", () => {
    const markup = renderToStaticMarkup(
      <ScoreHeatmap
        rows={["PLS", "Ridge"]}
        cols={["Raw", "SNV"]}
        values={[
          [0.82, 0.91],
          [0.74, Number.NaN],
        ]}
        className="score-panel"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-heatmap");
    expect(markup).toContain("score-panel");
    expect(markup).toContain("Performance heatmap");
    expect(markup).toContain("n4viz-cell");
    // Row / column labels and a formatted finite value are present.
    expect(markup).toContain("Ridge");
    expect(markup).toContain("SNV");
    expect(markup).toContain("0.91");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BoxPlot } from "./BoxPlot.js";

describe("BoxPlot", () => {
  it("renders a box per category with whiskers, median and outliers", () => {
    const markup = renderToStaticMarkup(
      <BoxPlot
        groups={[
          { label: "PLS", values: [0.7, 0.72, 0.75, 0.76, 0.8, 0.82, 0.99] },
          { label: "Ridge", values: [0.6, 0.63, 0.65, 0.67, 0.7] },
        ]}
        title="Fold R² by model"
        yLabel="R²"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-boxplot");
    expect(markup).toContain("<title>Fold R² by model</title>");
    expect(markup).toContain("n4viz-box");
    expect(markup).toContain("n4viz-whisker");
    expect(markup).toContain("n4viz-median");
    expect(markup).toContain("PLS");
    expect(markup).toContain("Ridge");
  });

  it("renders an empty svg gracefully with no groups", () => {
    const markup = renderToStaticMarkup(<BoxPlot groups={[]} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-boxplot");
  });
});

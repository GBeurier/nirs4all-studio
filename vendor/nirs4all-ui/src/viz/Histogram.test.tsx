import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Histogram } from "./Histogram.js";

describe("Histogram", () => {
  it("renders a regression distribution from raw values with a mean line", () => {
    const markup = renderToStaticMarkup(
      <Histogram
        values={[0.1, 0.2, 0.2, 0.3, 0.35, 0.4, 0.5, 0.55, 0.6, 0.8]}
        binCount={6}
        meanLine
        xLabel="Protein (%)"
        title="Target distribution"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-histogram");
    expect(markup).toContain("<title>Target distribution</title>");
    expect(markup).toContain("n4viz-bar");
    expect(markup).toContain("n4viz-mean");
    expect(markup).toContain("Count");
  });

  it("renders precomputed classification bins with category labels", () => {
    const markup = renderToStaticMarkup(
      <Histogram
        variant="classification"
        bins={[
          { label: "healthy", count: 12 },
          { label: "stressed", count: 7 },
        ]}
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-bar");
    expect(markup).toContain("healthy");
    expect(markup).toContain("stressed");
  });

  it("renders an empty svg gracefully when no data is provided", () => {
    const markup = renderToStaticMarkup(<Histogram />);
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-histogram");
  });
});

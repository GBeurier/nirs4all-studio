import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BiasVarianceBars } from "./BiasVarianceBars.js";

describe("viz/BiasVarianceBars", () => {
  it("renders stacked bias²/variance bars per group with a legend", () => {
    const markup = renderToStaticMarkup(
      <BiasVarianceBars
        entries={[
          { label: "PLS", biasSquared: 0.04, variance: 0.02 },
          { label: "Ridge", biasSquared: 0.03, variance: 0.05 },
          { label: "RF", biasSquared: 0.01, variance: 0.08 },
        ]}
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-biasvariance");
    expect(markup).toContain("<title>Bias² / variance</title>");
    expect(markup).toContain("n4viz-bar");
    // Legend swatches label both components.
    expect(markup).toContain("Bias²");
    expect(markup).toContain("Variance");
    expect(markup).toContain("PLS");
    expect(markup).toContain("RF");
  });

  it("renders an empty svg gracefully with no entries", () => {
    const markup = renderToStaticMarkup(<BiasVarianceBars entries={[]} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-biasvariance");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ResidualPlot } from "./ResidualPlot.js";

describe("ResidualPlot", () => {
  it("renders residuals with a zero line and dashed sigma bands", () => {
    const markup = renderToStaticMarkup(
      <ResidualPlot
        points={[
          { predicted: 1.0, residual: 0.1, partition: "train" },
          { predicted: 2.0, residual: -0.2, partition: "test" },
          { predicted: 3.0, actual: 3.4 },
          { predicted: 4.0, residual: 0.05 },
          { predicted: 5.0, residual: -0.3 },
        ]}
        title="Residual diagnostics"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-residual");
    expect(markup).toContain("<title>Residual diagnostics</title>");
    expect(markup).toContain("n4viz-zero");
    expect(markup).toContain("n4viz-sigma");
    expect(markup).toContain("Predicted");
    expect(markup).toContain("Residual");
  });

  it("renders an empty svg gracefully with no points", () => {
    const markup = renderToStaticMarkup(<ResidualPlot points={[]} />);
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-zero");
  });
});

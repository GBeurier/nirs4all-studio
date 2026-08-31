import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SpectraPlot } from "./SpectraPlot.js";

describe("viz/SpectraPlot", () => {
  const wavelengths = [1000, 1100, 1200, 1300, 1400];

  it("renders overlaid series, a mean line, and a min/max band", () => {
    const markup = renderToStaticMarkup(
      <SpectraPlot
        wavelengths={wavelengths}
        series={[
          { id: "a", values: [0.1, 0.3, 0.25, 0.4, 0.35], partition: "train" },
          { id: "b", values: [0.12, 0.28, 0.27, 0.38, 0.33], partition: "test" },
        ]}
        mean={[0.11, 0.29, 0.26, 0.39, 0.34]}
        band={{ lower: [0.05, 0.2, 0.2, 0.3, 0.28], upper: [0.15, 0.35, 0.32, 0.45, 0.4] }}
      />,
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-spectra");
    expect(markup).toContain("n4viz-band");
    expect(markup).toContain("n4viz-line-mean");
    expect(markup).toContain("Wavelength (nm)");
  });

  it("renders without series or band", () => {
    const markup = renderToStaticMarkup(<SpectraPlot wavelengths={wavelengths} />);
    expect(markup).toContain("<svg");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { WaterfallChart } from "./WaterfallChart.js";

describe("viz/WaterfallChart", () => {
  it("renders floating contribution bars with base and prediction references", () => {
    const markup = renderToStaticMarkup(
      <WaterfallChart
        baseValue={4.2}
        contributions={[
          { label: "1450 nm", value: 0.8 },
          { label: "1940 nm", value: -0.45 },
          { label: "2100 nm", value: 0.2 },
        ]}
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-waterfall");
    expect(markup).toContain("<title>SHAP waterfall</title>");
    expect(markup).toContain("n4viz-bar");
    expect(markup).toContain("n4viz-base");
    expect(markup).toContain("n4viz-prediction");
    expect(markup).toContain("1450 nm");
    // Positive contributions are signed with a leading plus.
    expect(markup).toContain("+0.8");
  });

  it("keeps only the largest |value| contributions for topN", () => {
    const markup = renderToStaticMarkup(
      <WaterfallChart
        baseValue={0}
        topN={1}
        contributions={[
          { label: "small", value: 0.01 },
          { label: "large", value: -0.9 },
        ]}
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("large");
    expect(markup).not.toContain("small");
  });
});

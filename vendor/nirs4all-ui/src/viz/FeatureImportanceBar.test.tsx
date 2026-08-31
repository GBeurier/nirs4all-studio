import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FeatureImportanceBar } from "./FeatureImportanceBar.js";

describe("FeatureImportanceBar", () => {
  it("renders ranked horizontal bars for the top features", () => {
    const markup = renderToStaticMarkup(
      <FeatureImportanceBar
        items={[
          { label: "1450 nm", value: 0.12 },
          { label: "1940 nm", value: 0.41 },
          { label: "2100 nm", value: 0.27 },
        ]}
        topN={2}
        className="vi-panel"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-importance");
    expect(markup).toContain("vi-panel");
    expect(markup).toContain("Feature importance");
    expect(markup).toContain("n4viz-bar");
    // Highest-value feature is kept and labeled.
    expect(markup).toContain("1940 nm");
    expect(markup).toContain("0.41");
    // topN=2 drops the smallest importance.
    expect(markup).not.toContain("1450 nm");
  });
});

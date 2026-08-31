import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MetricValueBadge } from "./MetricValueBadge.js";

describe("MetricValueBadge", () => {
  it("formats canonical metric values and comparison state", () => {
    const markup = renderToStaticMarkup(
      <MetricValueBadge
        metric="rmsep"
        value={0.32742}
        compareTo={0.41291}
        className="metric"
        betterClassName="better"
      />,
    );

    expect(markup).toContain("class=\"metric better\"");
    expect(markup).toContain("data-metric=\"rmse\"");
    expect(markup).toContain("RMSE");
    expect(markup).toContain("0.327");
    expect(markup).toContain("better");
  });

  it("renders unknown metrics without comparison copy when requested", () => {
    const markup = renderToStaticMarkup(
      <MetricValueBadge
        metric="custom quality"
        value="0.81234"
        compareTo="0.81234"
        showDirection={false}
      />,
    );

    expect(markup).toContain("Custom Quality");
    expect(markup).toContain("0.8123");
    expect(markup).not.toContain("equal");
  });
});

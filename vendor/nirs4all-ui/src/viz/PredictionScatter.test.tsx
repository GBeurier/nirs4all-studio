import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PredictionScatter } from "./PredictionScatter.js";

describe("viz/PredictionScatter", () => {
  const points = [
    { actual: 1, predicted: 1.1, partition: "train" as const },
    { actual: 2, predicted: 1.8, partition: "test" as const },
    { actual: 3, predicted: 3.2, partition: "train" as const },
  ];

  it("renders points, the identity line, and a metric badge", () => {
    const markup = renderToStaticMarkup(
      <PredictionScatter points={points} regressionLine metrics={{ r2: 0.94, rmse: 0.21 }} />,
    );
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-scatter");
    expect(markup).toContain("n4viz-identity");
    expect(markup).toContain("R²");
    expect(markup).toContain("Observed");
  });

  it("renders with no points", () => {
    const markup = renderToStaticMarkup(<PredictionScatter points={[]} />);
    expect(markup).toContain("<svg");
  });
});

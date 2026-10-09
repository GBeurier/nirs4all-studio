import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MetricsCard } from "./MetricsCard";

describe("stored run score", () => {
  it("shows an owner score even when detailed metrics are unavailable", () => {
    const html = renderToStaticMarkup(<MetricsCard label="Best completed" metrics={{ score: 0.3159, score_metric: "balanced_accuracy" }} />);
    expect(html).toContain("0.3159");
    expect(html).toContain("BALANCED ACCURACY");
  });
});

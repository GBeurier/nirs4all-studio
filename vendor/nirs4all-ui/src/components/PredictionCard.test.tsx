import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PredictionCard } from "./PredictionCard.js";

describe("PredictionCard", () => {
  it("renders a host-styled prediction identity card", () => {
    const markup = renderToStaticMarkup(
      <PredictionCard
        sampleId="S-042"
        predicted={12.34}
        unit="%"
        interval="[11.9, 12.8]"
        targetLabel="Protein"
        meta={[{ label: "Model", value: "PLS" }]}
        className="prediction-card"
        valueClassName="prediction-value"
        metaLabelClassName="meta-label"
      >
        <span className="host-badge">refit</span>
      </PredictionCard>,
    );

    expect(markup).toContain("class=\"prediction-card\"");
    expect(markup).toContain("data-sample-id=\"S-042\"");
    expect(markup).toContain("class=\"prediction-value\"");
    expect(markup).toContain("12.34");
    expect(markup).toContain("Protein");
    expect(markup).toContain("[11.9, 12.8]");
    expect(markup).toContain("Model");
    expect(markup).toContain("host-badge");
  });

  it("uses a caller-provided value formatter", () => {
    const markup = renderToStaticMarkup(
      <PredictionCard sampleId="S-1" predicted={0.5} formatValue={(v) => <em>{`${v}!`}</em>} />,
    );

    expect(markup).toContain("<em>0.5!</em>");
  });
});

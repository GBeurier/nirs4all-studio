import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DatasetResultCard } from "./DatasetResultCard.js";

describe("DatasetResultCard", () => {
  it("renders a host-styled dataset result summary", () => {
    const markup = renderToStaticMarkup(
      <DatasetResultCard
        title="Soy protein NIR"
        description="Reference spectra for protein regression."
        taskLabel="Regression"
        bestScore={{ metric: "RMSE", value: "0.812" }}
        model="PLS"
        sampleCount={96}
        featureCount={128}
        tags={["NIR", "protein"]}
        status="ready"
        className="dataset-result"
        titleClassName="result-title"
        statValueClassName="stat-value"
        tagClassName="tag"
      />,
    );

    expect(markup).toContain("class=\"dataset-result\"");
    expect(markup).toContain("data-status=\"ready\"");
    expect(markup).toContain("Soy protein NIR");
    expect(markup).toContain("Regression");
    expect(markup).toContain("RMSE 0.812");
    expect(markup).toContain("96");
    expect(markup).toContain("128");
    expect(markup).toContain("class=\"tag\"");
    expect(markup).toContain("protein");
  });

  it("uses a caller-provided tag renderer and empty fallback", () => {
    const custom = renderToStaticMarkup(
      <DatasetResultCard title="Custom" tags={["a"]} renderTag={(tag) => <em>{tag}</em>} />,
    );
    expect(custom).toContain("<em>a</em>");

    expect(renderToStaticMarkup(<DatasetResultCard title="" empty={<span>No result</span>} />))
      .toContain("No result");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PipelineFlow } from "./PipelineFlow.js";

describe("PipelineFlow", () => {
  it("renders a top-down spine of node cards with edges", () => {
    const markup = renderToStaticMarkup(
      <PipelineFlow
        nodes={[
          { id: "d", label: "Load", type: "data" },
          { id: "p", label: "SNV", type: "preprocess", variants: 3 },
          { id: "m", label: "PLS", type: "model", metric: 0.92, status: "done" },
        ]}
        className="flow"
      />,
    );

    expect(markup).toContain("<svg");
    expect(markup).toContain("n4viz-pipeline");
    expect(markup).toContain("data-node-type=\"preprocess\"");
    expect(markup).toContain("n4viz-edge");
    expect(markup).toContain("n4viz-badge");
    expect(markup).toContain("×3");
  });
});

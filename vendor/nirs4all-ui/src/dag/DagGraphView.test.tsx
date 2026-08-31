import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DagGraphView } from "./DagGraphView.js";
import type { DagGraph } from "./types.js";

function sampleGraph(): DagGraph {
  return {
    name: "demo",
    nodes: [
      { id: "a", kind: "data", label: "raw spectra" },
      { id: "b", kind: "model", group: ["stack"] },
      { id: "c", kind: "model", group: ["stack"] },
      { id: "d", kind: "merge", group: ["stack", "meta"] },
      { id: "e", kind: "chart" },
    ],
    edges: [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d", kind: "prediction", oof: true },
      { source: "c", target: "d", kind: "prediction", oof: true },
      { source: "d", target: "e" },
    ],
  };
}

describe("DagGraphView", () => {
  it("renders the toolbar, canvas, legend, and nodes for a small graph", () => {
    const markup = renderToStaticMarkup(<DagGraphView graph={sampleGraph()} width={720} height={460} />);
    expect(markup).toContain("n4dag__toolbar");
    expect(markup).toContain("<svg");
    expect(markup).toContain("n4dag__node-label");
    // small graph opens fully → visible count equals total
    expect(markup).toContain("5/5");
    // legend derives from the present categories
    expect(markup).toContain("Model");
  });

  it("renders a titled empty state for an empty graph", () => {
    const markup = renderToStaticMarkup(<DagGraphView graph={{ nodes: [], edges: [] }} />);
    expect(markup).toContain("Empty graph");
  });

  it("respects a forced initial collapse depth", () => {
    const markup = renderToStaticMarkup(
      <DagGraphView graph={sampleGraph()} width={720} height={460} initialCollapseDepth={0} />,
    );
    // the `stack` cluster is collapsed → a super-node stands in for b, c, d
    expect(markup).toContain("n4dag__node--group");
  });

  it("renders dataset-shape annotations and the Shapes toggle when the graph carries shapes", () => {
    const shaped: DagGraph = {
      nodes: [
        { id: "a", kind: "adapter", label: "spectra", io: { out: { samples: 240, features: 2048 } } },
        { id: "b", kind: "transform", label: "SNV", io: { in: [{ samples: 240, features: 2048 }], out: { samples: 240, features: 2048 } } },
      ],
      edges: [{ source: "a", target: "b", kind: "data" }],
    };
    const markup = renderToStaticMarkup(<DagGraphView graph={shaped} width={640} height={360} />);
    expect(markup).toContain("Shapes");
    expect(markup).toContain("n4dag__node-shape");
    expect(markup).toContain("240×2048");
  });

  it("omits the Shapes toggle when no shapes are present", () => {
    const markup = renderToStaticMarkup(<DagGraphView graph={sampleGraph()} width={640} height={360} />);
    expect(markup).not.toContain(">Shapes<");
  });
});

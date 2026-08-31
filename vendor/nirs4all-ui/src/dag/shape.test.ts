import { describe, expect, it } from "vitest";

import { deriveShapes, describeShapeDelta, formatCount, formatShape, shapeChange } from "./shape.js";
import type { DagGraph, DagShape } from "./types.js";

describe("formatCount / formatShape", () => {
  it("compacts counts", () => {
    expect(formatCount(2048)).toBe("2048");
    expect(formatCount(12000)).toBe("12k");
    expect(formatCount(undefined)).toBe("·");
  });

  it("formats tabular, multi-source, and prediction shapes", () => {
    expect(formatShape({ samples: 240, features: 2048 })).toBe("240×2048");
    expect(formatShape({ samples: 240, features: 2060, sources: [{ name: "a" }, { name: "b" }] })).toBe("240×2060 ·2src");
    expect(formatShape({ samples: 240, targets: 1, representation: "prediction" })).toBe("240×1 ŷ");
    expect(formatShape(undefined)).toBe("—");
  });
});

function multimodalGraph(): DagGraph {
  return {
    nodes: [
      { id: "src:nir", kind: "adapter" },
      { id: "src:meta", kind: "adapter" },
      { id: "join", kind: "source_join" },
      { id: "aug", kind: "augmentation", meta: { factor: 3 } },
      { id: "model", kind: "model", meta: { targets: 1 } },
    ],
    edges: [
      { source: "src:nir", target: "join" },
      { source: "src:meta", target: "join" },
      { source: "join", target: "aug" },
      { source: "aug", target: "model" },
    ],
  };
}

const ENTRIES: Record<string, DagShape> = {
  "src:nir": { samples: 240, features: 2048, representation: "spectra", sources: [{ name: "NIR", features: 2048, kind: "spectra" }] },
  "src:meta": { samples: 240, features: 12, sources: [{ name: "meta", features: 12, kind: "metadata" }] },
};

describe("deriveShapes", () => {
  it("propagates a multimodal dataset through join, augmentation, and model", () => {
    const g = deriveShapes(multimodalGraph(), { entries: ENTRIES });
    const out = (id: string) => g.nodes.find((n) => n.id === id)?.io?.out;

    const join = out("join");
    expect(join?.samples).toBe(240);
    expect(join?.features).toBe(2060); // 2048 + 12
    expect(join?.sources).toHaveLength(2);

    const aug = out("aug");
    expect(aug?.samples).toBe(720); // 240 × 3
    expect(aug?.note).toContain("×3");

    const model = out("model");
    expect(model?.representation).toBe("prediction");
    expect(model?.samples).toBe(720);
    expect(model?.targets).toBe(1);
  });

  it("fills node inputs from predecessors", () => {
    const g = deriveShapes(multimodalGraph(), { entries: ENTRIES });
    const join = g.nodes.find((n) => n.id === "join");
    expect(join?.io?.in).toHaveLength(2);
  });

  it("does not overwrite host-authoritative shapes", () => {
    const graph = multimodalGraph();
    const withAuthoritative: DagGraph = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === "aug" ? { ...n, io: { out: { samples: 999, features: 1, label: "fixed" } } } : n)),
    };
    const g = deriveShapes(withAuthoritative, { entries: ENTRIES });
    expect(g.nodes.find((n) => n.id === "aug")?.io?.out?.label).toBe("fixed");
  });
});

describe("shapeChange / describeShapeDelta", () => {
  const g = deriveShapes(multimodalGraph(), { entries: ENTRIES });
  const node = (id: string) => g.nodes.find((n) => n.id === id);

  it("classifies each transform", () => {
    const join = node("join");
    expect(shapeChange(join?.io?.in ?? [], join?.io?.out)).toBe("join");
    const aug = node("aug");
    expect(shapeChange(aug?.io?.in ?? [], aug?.io?.out)).toBe("rows-up");
    const model = node("model");
    expect(shapeChange(model?.io?.in ?? [], model?.io?.out)).toBe("predict");
  });

  it("describes the row explosion with a factor", () => {
    const aug = node("aug");
    expect(describeShapeDelta(aug?.io?.in ?? [], aug?.io?.out)).toBe("rows 240 → 720 (×3)");
  });
});

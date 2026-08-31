import { describe, expect, it } from "vitest";

import { computeEffectiveGraph } from "./collapse.js";
import { buildHierarchy } from "./hierarchy.js";
import { layoutDag } from "./layout.js";
import type { DagGraph } from "./types.js";

function diamondGraph(): DagGraph {
  return {
    nodes: [
      { id: "a", kind: "data" },
      { id: "b", kind: "model", group: ["stack"] },
      { id: "c", kind: "model", group: ["stack"] },
      { id: "d", kind: "merge", group: ["stack", "meta"] },
      { id: "e", kind: "chart" },
    ],
    edges: [
      { source: "a", target: "b" },
      { source: "a", target: "c" },
      { source: "b", target: "d" },
      { source: "c", target: "d" },
      { source: "d", target: "e" },
    ],
  };
}

function layerOf(nodes: ReturnType<typeof layoutDag>["nodes"], id: string): number {
  return nodes.find((n) => n.node.id === id)?.layer ?? -1;
}

describe("layoutDag", () => {
  it("assigns longest-path layers and finite coordinates", () => {
    const g = diamondGraph();
    const h = buildHierarchy(g);
    const layout = layoutDag(computeEffectiveGraph(g, h, new Set()), { direction: "LR", hierarchy: h });

    expect(layout.nodes).toHaveLength(5);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
    for (const ln of layout.nodes) {
      expect(Number.isFinite(ln.x)).toBe(true);
      expect(Number.isFinite(ln.y)).toBe(true);
    }

    expect(layerOf(layout.nodes, "a")).toBe(0);
    expect(layerOf(layout.nodes, "b")).toBe(1);
    expect(layerOf(layout.nodes, "d")).toBe(2);
    expect(layerOf(layout.nodes, "e")).toBe(3);
  });

  it("emits nested cluster frames", () => {
    const g = diamondGraph();
    const h = buildHierarchy(g);
    const layout = layoutDag(computeEffectiveGraph(g, h, new Set()), { direction: "LR", hierarchy: h });
    const ids = layout.frames.map((f) => f.id);
    expect(ids).toContain("stack");
    expect(ids).toContain("stack/meta");
  });

  it("does not throw on a cyclic effective graph", () => {
    const g: DagGraph = {
      nodes: [{ id: "x" }, { id: "y" }],
      edges: [
        { source: "x", target: "y" },
        { source: "y", target: "x" },
      ],
    };
    const h = buildHierarchy(g);
    const layout = layoutDag(computeEffectiveGraph(g, h, new Set()), { direction: "TB", hierarchy: h });
    expect(layout.nodes).toHaveLength(2);
    expect(layout.edges).toHaveLength(2);
    expect(layout.edges.some((e) => e.back)).toBe(true);
  });

  it("returns an empty layout for an empty graph", () => {
    const layout = layoutDag({ nodes: [], edges: [] }, { direction: "LR" });
    expect(layout.nodes).toHaveLength(0);
    expect(layout.width).toBe(0);
  });
});

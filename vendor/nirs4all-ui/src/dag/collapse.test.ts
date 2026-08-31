import { describe, expect, it } from "vitest";

import { buildHierarchy } from "./hierarchy.js";
import {
  GROUP_NODE_PREFIX,
  collapseAtDepth,
  computeEffectiveGraph,
  defaultCollapsed,
} from "./collapse.js";
import type { DagGraph } from "./types.js";

function stackGraph(): DagGraph {
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
      { source: "b", target: "d", kind: "prediction", oof: true },
      { source: "c", target: "d", kind: "prediction", oof: true },
      { source: "d", target: "e" },
    ],
  };
}

describe("computeEffectiveGraph", () => {
  it("returns the full graph when nothing is collapsed", () => {
    const g = stackGraph();
    const h = buildHierarchy(g);
    const eff = computeEffectiveGraph(g, h, new Set());
    expect(eff.nodes).toHaveLength(5);
    expect(eff.edges).toHaveLength(5);
  });

  it("collapses a cluster into one super-node and re-routes crossing edges", () => {
    const g = stackGraph();
    const h = buildHierarchy(g);
    const eff = computeEffectiveGraph(g, h, new Set(["stack"]));

    const superId = `${GROUP_NODE_PREFIX}stack`;
    const ids = eff.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["a", "e", superId].sort());

    const grp = eff.nodes.find((n) => n.id === superId);
    expect(grp?.isGroup).toBe(true);
    expect(grp?.childCount).toBe(3);
    expect(grp?.category).toBe("model"); // dominant among b, c, d

    // a→b and a→c merge into a single a→group edge (weight 2); b→d / c→d vanish
    const toGroup = eff.edges.find((e) => e.source === "a" && e.target === superId);
    expect(toGroup?.weight).toBe(2);
    expect(eff.edges.find((e) => e.source === superId && e.target === "e")).toBeDefined();
    expect(eff.edges).toHaveLength(2);
  });

  it("keeps the inner cluster framed when only the deeper group collapses", () => {
    const g = stackGraph();
    const h = buildHierarchy(g);
    const eff = computeEffectiveGraph(g, h, new Set(["stack/meta"]));
    const superMeta = eff.nodes.find((n) => n.id === `${GROUP_NODE_PREFIX}stack/meta`);
    expect(superMeta?.containerId).toBe("stack");
    expect(eff.nodes.find((n) => n.id === "b")?.containerId).toBe("stack");
  });
});

describe("collapseAtDepth / defaultCollapsed", () => {
  it("collapses exactly the clusters at a given depth", () => {
    const h = buildHierarchy(stackGraph());
    expect([...collapseAtDepth(h, 0)]).toEqual(["stack"]);
    expect([...collapseAtDepth(h, 1)]).toEqual(["stack/meta"]);
    expect(collapseAtDepth(h, 5).size).toBe(0);
  });

  it("auto-fits: small graphs open fully, tight targets collapse the roots", () => {
    const h = buildHierarchy(stackGraph());
    const open = defaultCollapsed(h, 5, { targetVisible: 100 });
    expect(open.collapsed.size).toBe(0);

    const tight = defaultCollapsed(h, 5, { targetVisible: 3 });
    expect([...tight.collapsed]).toEqual(["stack"]);
  });
});

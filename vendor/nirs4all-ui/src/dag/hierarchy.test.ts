import { describe, expect, it } from "vitest";

import { ancestorGroupIds, buildHierarchy } from "./hierarchy.js";
import type { DagGraph } from "./types.js";

function nestedGraph(): DagGraph {
  return {
    nodes: [
      { id: "a", kind: "data" },
      { id: "b", kind: "model", group: ["stack"] },
      { id: "c", kind: "model", group: ["stack"] },
      { id: "d", kind: "merge", group: ["stack", "meta"] },
      { id: "e", kind: "chart" },
    ],
    edges: [],
  };
}

describe("buildHierarchy", () => {
  it("materializes the nested cluster tree and assigns innermost groups", () => {
    const h = buildHierarchy(nestedGraph());

    expect(h.roots).toEqual(["stack"]);
    expect(h.maxDepth).toBe(1);
    expect(h.nodeGroupId.get("a")).toBeNull();
    expect(h.nodeGroupId.get("b")).toBe("stack");
    expect(h.nodeGroupId.get("d")).toBe("stack/meta");

    const stack = h.groups.get("stack");
    expect(stack?.depth).toBe(0);
    expect(stack?.children).toEqual(["stack/meta"]);
    expect(stack?.descendantLeafCount).toBe(3);
    expect(stack?.memberIds).toEqual(["b", "c"]);

    const meta = h.groups.get("stack/meta");
    expect(meta?.parent).toBe("stack");
    expect(meta?.descendantLeafCount).toBe(1);
  });

  it("returns ancestor chains innermost → outermost", () => {
    const h = buildHierarchy(nestedGraph());
    expect(ancestorGroupIds(h, "d")).toEqual(["stack/meta", "stack"]);
    expect(ancestorGroupIds(h, "a")).toEqual([]);
  });

  it("treats a flat graph as having no clusters", () => {
    const h = buildHierarchy({ nodes: [{ id: "x" }, { id: "y" }], edges: [] });
    expect(h.groups.size).toBe(0);
    expect(h.maxDepth).toBe(-1);
  });
});

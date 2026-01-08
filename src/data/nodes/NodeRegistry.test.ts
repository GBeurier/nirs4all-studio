import { describe, expect, it } from "vitest";

import { createNodeRegistry, NodeRegistry } from "@/data/nodes";

describe.skip("NodeRegistry", () => {
  it("loads curated registry and finds common nodes", () => {
    const registry = createNodeRegistry({ validateOnLoad: true, warnOnDuplicates: true });
    expect(registry).toBeInstanceOf(NodeRegistry);
    expect(registry.size).toBeGreaterThan(50);

    const search = registry.search("pls");
    expect(search.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";

import { fromCompiledGraph } from "./fromCompiledGraph.js";

/** Shaped after dag-ml's `execution_plan_branch_merge_executable.json`. */
function executionPlan(): unknown {
  return {
    id: "plan:demo",
    graph_plan: {
      graph: {
        id: "demo-graph",
        nodes: [
          { id: "src:x", kind: "adapter", operator: { type: "NirToTabular" } },
          {
            id: "branch:b0.model:ridge",
            kind: "model",
            operator: { type: "Ridge" },
            params: { alpha: 0.3 },
            metadata: { dsl_branch: "b0" },
            seed_label: "branch:b0",
          },
          { id: "branch:b1.augment:noise", kind: "augmentation", operator: { type: "GaussianNoise" } },
          { id: "branch:b1.model:rf", kind: "model", operator: { type: "RandomForestRegressor" } },
          { id: "merge:stack.meta:ridge", kind: "model", operator: { type: "RidgeMetaStacker" } },
        ],
        edges: [
          { source: { node_id: "src:x", port_name: "x_out" }, target: { node_id: "branch:b0.model:ridge", port_name: "x" }, contract: { kind: "data" } },
          { source: { node_id: "branch:b1.augment:noise", port_name: "x_out" }, target: { node_id: "branch:b1.model:rf", port_name: "x" }, contract: { kind: "data", requires_oof: false } },
          { source: { node_id: "branch:b0.model:ridge", port_name: "oof" }, target: { node_id: "merge:stack.meta:ridge", port_name: "b0" }, contract: { kind: "prediction", requires_oof: true } },
          { source: { node_id: "branch:b1.model:rf", port_name: "oof" }, target: { node_id: "merge:stack.meta:ridge", port_name: "b1" }, contract: { kind: "prediction", requires_oof: true } },
        ],
      },
    },
    variants: [{ variant_id: "v1" }, { variant_id: "v2" }],
  };
}

describe("fromCompiledGraph", () => {
  it("projects an ExecutionPlan into nodes, edges, labels, and clusters", () => {
    const graph = fromCompiledGraph(executionPlan());
    expect(graph.name).toBe("demo-graph");
    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(4);

    const ridge = graph.nodes.find((n) => n.id === "branch:b0.model:ridge");
    expect(ridge?.label).toBe("Ridge");
    expect(ridge?.kind).toBe("model");
    expect(ridge?.group).toEqual(["branch:b0"]);
    expect(ridge?.meta).toMatchObject({ dsl_branch: "b0" });
  });

  it("flags out-of-fold prediction edges", () => {
    const graph = fromCompiledGraph(executionPlan());
    const oof = graph.edges.filter((e) => e.oof);
    expect(oof).toHaveLength(2);
    expect(oof.every((e) => e.kind === "prediction")).toBe(true);
  });

  it("honors groupBy: none and drops edges with unknown endpoints", () => {
    const flat = fromCompiledGraph(executionPlan(), { groupBy: "none" });
    expect(flat.nodes.every((n) => n.group === undefined)).toBe(true);

    const broken = fromCompiledGraph({
      nodes: [{ id: "only", kind: "model" }],
      edges: [{ source: { node_id: "only" }, target: { node_id: "ghost" } }],
    });
    expect(broken.nodes).toHaveLength(1);
    expect(broken.edges).toHaveLength(0);
  });

  it("returns an empty graph for unrecognized input", () => {
    expect(fromCompiledGraph(null).nodes).toHaveLength(0);
    expect(fromCompiledGraph({ foo: 1 }).edges).toHaveLength(0);
  });
});

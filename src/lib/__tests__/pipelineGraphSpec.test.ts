import { describe, expect, it } from "vitest";

import {
  buildPipelineGraphSpecFromLegacySteps,
  PIPELINE_GRAPH_SPEC_VERSION,
  summarizePipelineGraphSpec,
} from "../pipelineGraphSpec";

describe("pipelineGraphSpec", () => {
  it("builds a sequential graph from legacy editor steps", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps(
      [
        {
          id: "pre",
          name: "SNV",
          type: "preprocessing",
          params: { with_mean: true },
        },
        {
          id: "model",
          name: "PLS",
          type: "model",
          classPath: "sklearn.cross_decomposition.PLSRegression",
          params: { n_components: 12 },
        },
      ],
      { id: "pipe-1", name: "PLS Pipeline" },
    );

    expect(graph).toMatchObject({
      id: "pipe-1",
      name: "PLS Pipeline",
      version: PIPELINE_GRAPH_SPEC_VERSION,
      source: "legacy-editor",
      entryNodeIds: ["pre", "model"],
      stats: {
        nodeCount: 2,
        activeNodeCount: 2,
        disabledNodeCount: 0,
        topLevelNodeCount: 2,
        branchCount: 0,
        generatorCount: 0,
        maxDepth: 0,
      },
    });
    expect(graph.nodes[1]).toMatchObject({
      id: "model",
      label: "PLS",
      kind: "operator",
      operator: {
        name: "PLS",
        classPath: "sklearn.cross_decomposition.PLSRegression",
      },
      params: { n_components: 12 },
    });
    expect(graph.edges).toEqual([
      {
        id: "sequence:pre->model:1",
        kind: "sequence",
        sourceNodeId: "pre",
        targetNodeId: "model",
        order: 1,
      },
    ]);
    expect(summarizePipelineGraphSpec(graph)).toMatchObject({
      stepSummary: "SNV \u2192 PLS",
      nodeCount: 2,
      topLevelNodeCount: 2,
    });
  });

  it("captures children, branches, named branches, generators, and disabled nodes", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps([
      {
        id: "augment",
        name: "Augment",
        type: "flow",
        subType: "container",
        children: [
          { id: "jitter", name: "Jitter", type: "augmentation", params: {} },
        ],
      },
      {
        id: "choice",
        name: "Choice",
        type: "flow",
        subType: "generator",
        generatorKind: "or",
        branches: [
          [{ id: "snv", name: "SNV", type: "preprocessing", params: {} }],
          [{ id: "msc", name: "MSC", type: "preprocessing", params: {}, enabled: false }],
        ],
        namedBranches: {
          refit: [
            {
              id: "pls",
              name: "PLS",
              type: "model",
              params: {},
              refitConfig: { enabled: true },
            },
          ],
        },
      },
    ]);

    expect(graph.stats).toMatchObject({
      nodeCount: 6,
      activeNodeCount: 5,
      disabledNodeCount: 1,
      topLevelNodeCount: 2,
      branchCount: 3,
      generatorCount: 1,
      maxDepth: 1,
    });
    expect(graph.nodes.find((node) => node.id === "choice")).toMatchObject({
      kind: "flow",
      generatorKind: "or",
    });
    expect(graph.nodes.find((node) => node.id === "msc")).toMatchObject({
      enabled: false,
      parentNodeId: "choice",
      branchIndex: 1,
    });
    expect(graph.nodes.find((node) => node.id === "pls")).toMatchObject({
      parentNodeId: "choice",
      branchIndex: 0,
      branchLabel: "refit",
      hasRefit: true,
    });
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "contains",
        sourceNodeId: "augment",
        targetNodeId: "jitter",
      }),
      expect.objectContaining({
        kind: "branch",
        sourceNodeId: "choice",
        targetNodeId: "snv",
        label: "branch 1",
      }),
      expect.objectContaining({
        kind: "named_branch",
        sourceNodeId: "choice",
        targetNodeId: "pls",
        label: "refit",
      }),
    ]));
  });

  it("generates path-based IDs and disambiguates duplicate legacy IDs", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps([
      { id: "dup", name: "First", type: "preprocessing", params: {} },
      { id: "dup", name: "Second", type: "preprocessing", params: {} },
      { name: "No ID", type: "model", params: {} },
    ]);

    expect(graph.nodes.map((node) => node.id)).toEqual([
      "dup",
      "dup#2",
      "legacy:steps.2",
    ]);
    expect(graph.nodes[1].legacyStepId).toBe("dup");
    expect(graph.nodes[2].legacyStepId).toBeUndefined();
    expect(graph.edges.map((edge) => `${edge.sourceNodeId}->${edge.targetNodeId}`)).toEqual([
      "dup->dup#2",
      "dup#2->legacy:steps.2",
    ]);
  });
});

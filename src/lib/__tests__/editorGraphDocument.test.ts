import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  EDITOR_GRAPH_DOCUMENT_VERSION,
  compareLegacyStepsToEditorGraphDocument,
  editorGraphDocumentToLegacySteps,
  legacyStepsToEditorGraphDocument,
  summarizeEditorGraphDocument,
  summarizeLegacySteps,
} from "../editorGraphDocument";

function step(overrides: Partial<PipelineStep> & Pick<PipelineStep, "id" | "name" | "type">): PipelineStep {
  return {
    params: {},
    ...overrides,
  };
}

describe("editorGraphDocument", () => {
  it("builds a port-addressed document from sequential legacy editor steps", () => {
    const legacySteps: PipelineStep[] = [
      step({
        id: "pre",
        name: "SNV",
        type: "preprocessing",
        params: { with_mean: true },
        enabled: false,
        paramSweeps: {
          window: { type: "or", choices: [5, 7] },
        },
      }),
      step({
        id: "model",
        name: "PLS",
        type: "model",
        classPath: "sklearn.cross_decomposition.PLSRegression",
        params: { n_components: 12 },
        refitConfig: { enabled: true },
      }),
    ];

    const document = legacyStepsToEditorGraphDocument(legacySteps, {
      id: "pipe-1",
      name: "PLS Pipeline",
    });

    expect(document).toMatchObject({
      id: "pipe-1",
      name: "PLS Pipeline",
      version: EDITOR_GRAPH_DOCUMENT_VERSION,
      source: "legacy-editor",
      rootNodeIds: ["pre", "model"],
    });
    expect(document.nodes[0]).toMatchObject({
      id: "pre",
      legacyStepId: "pre",
      kind: "operator",
      enabled: false,
      legacyStep: {
        id: "pre",
        type: "preprocessing",
        name: "SNV",
        paramSweeps: {
          window: { type: "or", choices: [5, 7] },
        },
      },
    });
    expect(document.nodes[0]?.legacyStep).not.toHaveProperty("children");
    expect(document.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "pre:in", nodeId: "pre", direction: "input", role: "sequence" }),
      expect.objectContaining({ id: "pre:out", nodeId: "pre", direction: "output", role: "sequence" }),
      expect.objectContaining({ id: "model:in", nodeId: "model", direction: "input", role: "sequence" }),
    ]));
    expect(document.edges).toEqual([
      {
        id: "sequence:pre:out->model:in:1",
        kind: "sequence",
        sourceNodeId: "pre",
        sourcePortId: "pre:out",
        targetNodeId: "model",
        targetPortId: "model:in",
        order: 1,
      },
    ]);

    const roundTripped = editorGraphDocumentToLegacySteps(document);

    expect(roundTripped).toEqual(legacySteps);
    expect(roundTripped).not.toBe(legacySteps);
    expect(roundTripped[0]?.params).not.toBe(legacySteps[0]?.params);
  });

  it("round-trips children, branch slots, named branch slots, and duplicate legacy ids", () => {
    const legacySteps: PipelineStep[] = [
      step({
        id: "choice",
        name: "Choice",
        type: "flow",
        subType: "branch",
        branchMetadata: [
          { name: "empty path", isCollapsed: true },
          { name: "model path" },
        ],
        branches: [
          [],
          [
            step({ id: "dup", name: "SNV", type: "preprocessing", params: { copy: 1 } }),
            step({ id: "dup", name: "PLS", type: "model", params: { n_components: 8 } }),
          ],
        ],
        namedBranches: {
          refit: [],
          calibrate: [
            step({ id: "cal", name: "Calibrate", type: "preprocessing", params: { alpha: 0.1 } }),
          ],
        },
      }),
      step({
        id: "augment",
        name: "Augment",
        type: "flow",
        subType: "sample_augmentation",
        children: [
          step({ id: "jitter", name: "Jitter", type: "augmentation", params: { scale: 0.05 } }),
        ],
      }),
    ];

    const document = legacyStepsToEditorGraphDocument(legacySteps);

    expect(document.nodes.map((node) => node.id)).toEqual([
      "choice",
      "dup",
      "dup#2",
      "cal",
      "augment",
      "jitter",
    ]);
    expect(document.rootNodeIds).toEqual(["choice", "augment"]);
    expect(document.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "choice:branch:0",
        role: "branch",
        branchIndex: 0,
        branchLabel: "empty path",
      }),
      expect.objectContaining({
        id: "choice:branch:1",
        role: "branch",
        branchIndex: 1,
        branchLabel: "model path",
      }),
      expect.objectContaining({
        nodeId: "choice",
        role: "named_branch",
        branchLabel: "refit",
      }),
      expect.objectContaining({
        id: "augment:children",
        nodeId: "augment",
        role: "children",
      }),
    ]));
    expect(document.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "branch",
        sourceNodeId: "choice",
        sourcePortId: "choice:branch:1",
        targetNodeId: "dup",
        label: "model path",
      }),
      expect.objectContaining({
        kind: "sequence",
        sourceNodeId: "dup",
        targetNodeId: "dup#2",
      }),
      expect.objectContaining({
        kind: "named_branch",
        sourceNodeId: "choice",
        targetNodeId: "cal",
        label: "calibrate",
      }),
      expect.objectContaining({
        kind: "contains",
        sourceNodeId: "augment",
        sourcePortId: "augment:children",
        targetNodeId: "jitter",
      }),
    ]));
    expect(document.edges.some((edge) => edge.sourcePortId === "choice:branch:0")).toBe(false);

    expect(editorGraphDocumentToLegacySteps(document)).toEqual(legacySteps);
  });

  it("summarizes legacy steps and editor graph documents with stable migration-facing counts", () => {
    const legacySteps: PipelineStep[] = [
      step({
        id: "pre",
        name: "SNV",
        type: "preprocessing",
        params: {
          z: 1,
          a: { b: 2 },
        },
      }),
      step({
        id: "model",
        name: "PLS",
        type: "model",
        params: { n_components: 12 },
      }),
    ];
    const document = legacyStepsToEditorGraphDocument(legacySteps, {
      id: "doc-with-product-name",
      name: "Visible pipeline name",
    });

    const legacySummary = summarizeLegacySteps(legacySteps);
    const documentSummary = summarizeEditorGraphDocument(document);

    expect(documentSummary).toEqual(legacySummary);
    expect(documentSummary).toMatchObject({
      rootNodeIds: ["pre", "model"],
      nodeCount: 2,
      portCount: 4,
      edgeCount: 1,
      maxDepth: 0,
      portsByRole: {
        sequence: 4,
        children: 0,
        branch: 0,
        named_branch: 0,
      },
      edgesByKind: {
        sequence: 1,
        contains: 0,
        branch: 0,
        named_branch: 0,
      },
    });
    expect(documentSummary.nodes[0]).toMatchObject({
      id: "pre",
      label: "SNV",
      paramsFingerprint: "{\"a\":{\"b\":2},\"z\":1}",
    });
  });

  it("compares legacy steps against an equivalent editor graph document", () => {
    const legacySteps: PipelineStep[] = [
      step({ id: "pre", name: "SNV", type: "preprocessing", params: { with_mean: true } }),
      step({ id: "model", name: "PLS", type: "model", params: { n_components: 8 } }),
    ];
    const document = legacyStepsToEditorGraphDocument(legacySteps, {
      id: "document-id-does-not-affect-equivalence",
      name: "Pipeline Display Name",
    });

    const comparison = compareLegacyStepsToEditorGraphDocument(legacySteps, document);

    expect(comparison.equivalent).toBe(true);
    expect(comparison.differences).toEqual([]);
    expect(comparison.documentSummary).toEqual(comparison.legacySummary);
  });

  it("reports focused differences between legacy steps and a diverged editor graph document", () => {
    const legacySteps: PipelineStep[] = [
      step({ id: "pre", name: "SNV", type: "preprocessing", params: { with_mean: true } }),
      step({ id: "model", name: "PLS", type: "model", params: { n_components: 8 } }),
    ];
    const document = legacyStepsToEditorGraphDocument(legacySteps);
    const firstNode = document.nodes[0];
    if (!firstNode) throw new Error("Expected a first node");
    document.nodes[0] = {
      ...firstNode,
      label: "Savitzky-Golay",
    };

    const comparison = compareLegacyStepsToEditorGraphDocument(legacySteps, document);

    expect(comparison.equivalent).toBe(false);
    expect(comparison.differences).toContainEqual({
      path: "summary.nodes[0].label",
      expected: "SNV",
      actual: "Savitzky-Golay",
    });
  });
});

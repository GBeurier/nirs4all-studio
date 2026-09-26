import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { allNodes, n4mNodes } from "@/data/nodes";
import { exportToNirs4all, importFromNirs4all } from "../pipelineConverter";

function n4mNode(type: string, methodId: string) {
  const node = n4mNodes.find((candidate) => candidate.type === type && candidate.classPath === `n4m:${methodId}`);
  if (!node) throw new Error(`missing n4m ${type} node for ${methodId}`);
  return node;
}

function stepFrom(node: ReturnType<typeof n4mNode>, params: Record<string, string | number | boolean> = {}): EditorPipelineStep {
  return { id: node.id, type: node.type, name: node.name, params, classPath: node.classPath };
}

describe("n4m node registry", () => {
  it("gives every n4m node a portable token and an editor-unique type + name", () => {
    expect(n4mNodes.length).toBeGreaterThan(0);
    expect(n4mNodes.every((node) => node.source === "n4m" && node.classPath?.startsWith("n4m:"))).toBe(true);
    const keys = [...allNodes, ...n4mNodes].map((node) => `${node.type}::${node.name.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("serializes n4m nodes as n4m:<method_id> tokens and imports them back", () => {
    const snv = n4mNode("preprocessing", "preprocessing.scatter.snv");
    const sg = n4mNode("preprocessing", "preprocessing.derivatives.savitzky_golay");
    const ridge = n4mNode("model", "models.regularized.ridge");
    const pls = n4mNode("model", "models.pls.pls_regression");

    const exported = exportToNirs4all([
      stepFrom(snv),
      stepFrom(sg, { window_length: 11, deriv: 1 }),
      stepFrom(ridge, { alpha: 0.5 }),
      stepFrom(pls, { n_components: 8 }),
    ]);

    expect(exported).toEqual([
      "n4m:preprocessing.scatter.snv",
      { class: "n4m:preprocessing.derivatives.savitzky_golay", params: { window_length: 11, deriv: 1 } },
      { model: { class: "n4m:models.regularized.ridge", params: { alpha: 0.5 } } },
      { model: { class: "n4m:models.pls.pls_regression", params: { n_components: 8 } } },
    ]);

    const imported = importFromNirs4all(exported);
    expect(imported.map(({ type, name, classPath }) => ({ type, name, classPath }))).toEqual([
      { type: "preprocessing", name: snv.name, classPath: snv.classPath },
      { type: "preprocessing", name: sg.name, classPath: sg.classPath },
      { type: "model", name: ridge.name, classPath: ridge.classPath },
      { type: "model", name: pls.name, classPath: pls.classPath },
    ]);
    expect(exportToNirs4all(imported)).toEqual(exported);
  });

  it("keeps n4m tokens the registry does not know through a round trip", () => {
    const pipeline = [{ model: { class: "n4m:models.future.ridge", params: { alpha: 2 } } }];
    expect(exportToNirs4all(importFromNirs4all(pipeline))).toEqual(pipeline);
  });
});

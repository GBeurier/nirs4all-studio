import { describe, expect, it } from "vitest";
import { allNodes } from "@/data/nodes/definitions";
import { paramPresets } from "../presets";

describe("finetune parameter presets", () => {
  it("only name parameters declared by the model node they target", () => {
    // Node parameters are checked against the Python constructors in
    // tests/test_operator_definitions.py; a preset outside them is a stale keyword.
    const stale: string[] = [];
    for (const preset of paramPresets) {
      for (const model of preset.forModels ?? []) {
        const node = allNodes.find((candidate) => candidate.type === "model" && candidate.name === model);
        if (node && !node.parameters.some((param) => param.name === preset.name)) {
          stale.push(`${model}.${preset.name}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });
});

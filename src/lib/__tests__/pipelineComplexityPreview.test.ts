import { describe, expect, it } from "vitest";

import { buildPipelineComplexityPreview } from "../pipelineComplexityPreview";
import { buildPipelineGraphSpecFromLegacySteps } from "../pipelineGraphSpec";

describe("pipelineComplexityPreview", () => {
  it("summarizes generators, sweeps, finetune, and refit nodes from graph specs", () => {
    const graph = buildPipelineGraphSpecFromLegacySteps([
      {
        id: "augment",
        name: "Augment",
        type: "augmentation",
        params: {},
        generatorKind: "grid",
        stepGenerator: { strategy: "cartesian" },
        paramSweeps: { alpha: [0.1, 1] },
      },
      {
        id: "model",
        name: "PLS",
        type: "model",
        params: {},
        finetuneConfig: { enabled: true },
        refitConfig: { enabled: true },
      },
    ]);

    expect(buildPipelineComplexityPreview(graph)).toEqual({
      generatorCount: 1,
      stepGeneratorCount: 1,
      parameterSweepCount: 1,
      finetuneNodeCount: 1,
      refitNodeCount: 1,
      labels: [
        "1 generator",
        "1 step generator",
        "1 parameter sweep",
        "1 finetune node",
        "1 refit node",
      ],
    });
  });

  it("keeps simple and missing graph fallbacks explicit", () => {
    expect(buildPipelineComplexityPreview(buildPipelineGraphSpecFromLegacySteps([
      { id: "model", name: "PLS", type: "model", params: {} },
    ])).labels).toEqual(["No refit, finetune, sweeps, or generators"]);
    expect(buildPipelineComplexityPreview(null).labels).toEqual(["Unknown pipeline complexity"]);
  });
});

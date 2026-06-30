import { describe, expect, it } from "vitest";

import type { PipelineInfo } from "@/api/pipelines";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { EDITOR_GRAPH_DOCUMENT_VERSION, legacyStepsToEditorGraphDocument } from "@/lib/editorGraphDocument";
import {
  buildAllPipelineOptions,
  CURRENT_EDITED_PIPELINE_ID,
  getSelectedPipelineConfigs,
  summarizePipelineSteps,
  toExperimentPipelineOption,
} from "@/lib/experimentPipelineSelection";

function pipeline(overrides: Partial<PipelineInfo> = {}): PipelineInfo {
  return {
    id: "pipe-1",
    name: "PLS Pipeline",
    category: "custom",
    steps: [
      { id: "pre", name: "SNV", type: "preprocessing", params: {} },
      { id: "model", name: "PLS", type: "model", params: {} },
    ],
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    ...overrides,
  };
}

function editorStep(overrides: Partial<EditorPipelineStep> & Pick<EditorPipelineStep, "id" | "name" | "type">): EditorPipelineStep {
  return {
    params: {},
    ...overrides,
  };
}

describe("experimentPipelineSelection", () => {
  it("summarizes pipeline steps with the existing display separator", () => {
    expect(summarizePipelineSteps(pipeline().steps)).toBe("SNV \u2192 PLS");
    expect(summarizePipelineSteps([])).toBe("Empty pipeline");
  });

  it("maps pipeline API payloads into experiment options", () => {
    expect(toExperimentPipelineOption(pipeline({ category: "preset", is_favorite: true }))).toMatchObject({
      id: "pipe-1",
      name: "PLS Pipeline",
      preset: true,
      favorite: true,
      steps: "SNV \u2192 PLS",
      nodeCount: 2,
      activeNodeCount: 2,
      disabledNodeCount: 0,
      branchCount: 0,
      generatorCount: 0,
      stepGeneratorCount: 0,
      parameterSweepCount: 0,
      finetuneNodeCount: 0,
      refitNodeCount: 0,
      maxDepth: 0,
    });
  });

  it("maps pipeline graph shape into experiment option previews", () => {
    expect(
      toExperimentPipelineOption(pipeline({
        steps: [
          {
            id: "branch",
            name: "Branch",
            type: "flow",
            params: {},
            branches: [[
              { id: "model-a", name: "PLS", type: "model", params: {}, generatorKind: "grid" },
              {
                id: "generated",
                name: "Generated",
                type: "augmentation",
                params: {},
                stepGenerator: { strategy: "cartesian" },
                paramSweeps: { alpha: [0.1, 1] },
              },
              {
                id: "refit",
                name: "Refit",
                type: "model",
                params: {},
                finetuneConfig: { enabled: true },
                refitConfig: { enabled: true },
              },
              { id: "disabled", name: "Disabled", type: "preprocessing", params: {}, enabled: false },
            ]],
          },
        ],
      })),
    ).toMatchObject({
      steps: "Branch",
      nodeCount: 5,
      activeNodeCount: 4,
      disabledNodeCount: 1,
      branchCount: 1,
      generatorCount: 2,
      stepGeneratorCount: 1,
      parameterSweepCount: 1,
      finetuneNodeCount: 1,
      refitNodeCount: 1,
      maxDepth: 1,
    });
  });

  it("prepends the current edited pipeline without changing saved pipeline options", () => {
    expect(
      buildAllPipelineOptions(
        { name: "Draft", steps: [], isDirty: true },
        [toExperimentPipelineOption(pipeline())],
      )[0],
    ).toMatchObject({
      id: CURRENT_EDITED_PIPELINE_ID,
      name: "[Current] Draft (unsaved)",
      steps: "Empty pipeline",
      nodeCount: 0,
      isCurrentEdited: true,
    });
  });

  it("previews the current edited pipeline from a valid editor graph document before legacy fallback steps", () => {
    const legacyFallbackSteps = [
      editorStep({ id: "legacy", name: "Legacy fallback", type: "preprocessing" }),
    ];
    const graphSteps = [
      editorStep({ id: "graph", name: "Graph preferred", type: "model" }),
    ];

    expect(
      buildAllPipelineOptions(
        {
          name: "Draft",
          steps: legacyFallbackSteps,
          editorGraphDocument: legacyStepsToEditorGraphDocument(graphSteps),
          isDirty: true,
        },
        [],
      )[0],
    ).toMatchObject({
      id: CURRENT_EDITED_PIPELINE_ID,
      steps: "Graph preferred",
      nodeCount: 1,
    });
  });

  it("builds selected pipeline configs including the current edited pipeline", () => {
    expect(
      getSelectedPipelineConfigs(
        [pipeline(), pipeline({ id: "pipe-2", name: "Ignored" })],
        [CURRENT_EDITED_PIPELINE_ID, "pipe-1"],
        { name: "Draft", steps: [{ id: "draft" }], isDirty: false },
      ),
    ).toEqual([
      { id: CURRENT_EDITED_PIPELINE_ID, name: "Draft", steps: [{ id: "draft" }] },
      { id: "pipe-1", name: "PLS Pipeline", steps: pipeline().steps },
    ]);
  });

  it("builds selected current edited pipeline configs from a valid editor graph document", () => {
    const legacyFallbackSteps = [
      editorStep({ id: "legacy", name: "Legacy fallback", type: "preprocessing" }),
    ];
    const graphSteps = [
      editorStep({ id: "graph", name: "Graph preferred", type: "model" }),
    ];

    expect(
      getSelectedPipelineConfigs(
        [],
        [CURRENT_EDITED_PIPELINE_ID],
        {
          name: "Draft",
          steps: legacyFallbackSteps,
          editorGraphDocument: legacyStepsToEditorGraphDocument(graphSteps),
          isDirty: false,
        },
      ),
    ).toEqual([
      { id: CURRENT_EDITED_PIPELINE_ID, name: "Draft", steps: graphSteps },
    ]);
  });

  it("falls back to legacy current edited steps when the editor graph document is malformed", () => {
    const legacyFallbackSteps = [
      editorStep({ id: "legacy", name: "Legacy fallback", type: "preprocessing" }),
    ];

    expect(
      getSelectedPipelineConfigs(
        [],
        [CURRENT_EDITED_PIPELINE_ID],
        {
          name: "Draft",
          steps: legacyFallbackSteps,
          editorGraphDocument: {
            id: "malformed",
            version: EDITOR_GRAPH_DOCUMENT_VERSION,
            source: "legacy-editor",
            rootNodeIds: ["legacy"],
            nodes: "not-an-array",
            ports: [],
            edges: [],
          } as never,
          isDirty: false,
        },
      ),
    ).toEqual([
      { id: CURRENT_EDITED_PIPELINE_ID, name: "Draft", steps: legacyFallbackSteps },
    ]);
  });
});

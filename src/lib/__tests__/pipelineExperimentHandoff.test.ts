import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import {
  EDITOR_GRAPH_DOCUMENT_VERSION,
  legacyStepsToEditorGraphDocument,
} from "../editorGraphDocument";
import {
  buildCurrentEditedPipelineHandoff,
  consumeCurrentEditedPipelineHandoff,
  CURRENT_EDITED_PIPELINE_STORAGE_KEY,
  getExperimentRouteForPipeline,
  parseCurrentEditedPipelineHandoff,
  storeCurrentEditedPipelineHandoff,
} from "../pipelineExperimentHandoff";

function memoryStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
    removeItem: (key) => {
      entries.delete(key);
    },
  };
}

const pipelineSteps: PipelineStep[] = [
  {
    id: "scale",
    name: "SNV",
    type: "preprocessing",
    params: {},
  },
  {
    id: "model",
    name: "PLS",
    type: "model",
    params: {},
  },
];

describe("pipelineExperimentHandoff", () => {
  it("builds a current edited pipeline handoff with legacy steps and an editor graph document", () => {
    expect(
      buildCurrentEditedPipelineHandoff({
        pipelineId: "pipe-1",
        isNew: false,
        name: "PLS Draft",
        steps: pipelineSteps,
        isDirty: true,
        now: () => 1234,
      }),
    ).toMatchObject({
      id: "pipe-1",
      name: "PLS Draft",
      steps: pipelineSteps,
      editorGraphDocument: {
        id: "pipe-1",
        name: "PLS Draft",
        version: EDITOR_GRAPH_DOCUMENT_VERSION,
        source: "legacy-editor",
        rootNodeIds: ["scale", "model"],
      },
      isDirty: true,
      timestamp: 1234,
    });

    expect(
      buildCurrentEditedPipelineHandoff({
        pipelineId: "new",
        isNew: true,
        name: "Unsaved Draft",
        steps: [],
        isDirty: true,
        now: () => 42,
      }).id,
    ).toBeUndefined();
  });

  it("routes clean saved pipelines by id and dirty or new pipelines through the editor handoff", () => {
    expect(
      getExperimentRouteForPipeline({
        pipelineId: "pipe 1",
        isNew: false,
        isDirty: false,
      }),
    ).toBe("/editor?pipeline=pipe%201");

    expect(
      getExperimentRouteForPipeline({
        pipelineId: "pipe-1",
        isNew: false,
        isDirty: true,
      }),
    ).toBe("/editor?source=editor");

    expect(
      getExperimentRouteForPipeline({
        pipelineId: "new",
        isNew: true,
        isDirty: false,
      }),
    ).toBe("/editor?source=editor");
  });

  it("parses only valid handoff payloads for NewExperiment", () => {
    const editorGraphDocument = legacyStepsToEditorGraphDocument(pipelineSteps, {
      id: "pipe-1",
      name: "PLS Draft",
    });

    expect(
      parseCurrentEditedPipelineHandoff(JSON.stringify({
        id: "pipe-1",
        name: "PLS Draft",
        steps: pipelineSteps,
        editorGraphDocument,
        isDirty: false,
        timestamp: 99,
      })),
    ).toEqual({
      id: "pipe-1",
      name: "PLS Draft",
      steps: pipelineSteps,
      editorGraphDocument,
      isDirty: false,
    });

    expect(parseCurrentEditedPipelineHandoff(null)).toBeNull();
    expect(parseCurrentEditedPipelineHandoff("{bad-json")).toBeNull();
    expect(parseCurrentEditedPipelineHandoff(JSON.stringify({ name: "Missing steps", isDirty: true }))).toBeNull();
    expect(parseCurrentEditedPipelineHandoff(JSON.stringify({ name: "Bad steps", steps: {}, isDirty: true }))).toBeNull();
    expect(parseCurrentEditedPipelineHandoff(JSON.stringify({ name: "Bad dirty", steps: [], isDirty: "yes" }))).toBeNull();
  });

  it("ignores malformed editor graph documents without rejecting the legacy handoff", () => {
    expect(
      parseCurrentEditedPipelineHandoff(JSON.stringify({
        id: "pipe-1",
        name: "PLS Draft",
        steps: pipelineSteps,
        editorGraphDocument: {
          version: EDITOR_GRAPH_DOCUMENT_VERSION,
          source: "legacy-editor",
          rootNodeIds: ["scale"],
          nodes: "not-an-array",
          ports: [],
          edges: [],
        },
        isDirty: true,
      })),
    ).toEqual({
      id: "pipe-1",
      name: "PLS Draft",
      steps: pipelineSteps,
      isDirty: true,
    });
  });

  it("stores and consumes handoffs through the shared storage key", () => {
    const storage = memoryStorage();
    const handoff = buildCurrentEditedPipelineHandoff({
      pipelineId: "pipe-1",
      isNew: false,
      name: "PLS Draft",
      steps: pipelineSteps,
      isDirty: true,
      now: () => 1234,
    });

    storeCurrentEditedPipelineHandoff(storage, handoff);
    expect(storage.getItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY)).toBe(JSON.stringify(handoff));
    expect(consumeCurrentEditedPipelineHandoff(storage)).toEqual({
      id: "pipe-1",
      name: "PLS Draft",
      steps: pipelineSteps,
      editorGraphDocument: handoff.editorGraphDocument,
      isDirty: true,
    });
    expect(storage.getItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY)).toBeNull();
  });

  it("drops malformed stored handoffs when consumed", () => {
    const storage = memoryStorage();
    storage.setItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY, "{bad-json");

    expect(consumeCurrentEditedPipelineHandoff(storage)).toBeNull();
    expect(storage.getItem(CURRENT_EDITED_PIPELINE_STORAGE_KEY)).toBeNull();
  });
});

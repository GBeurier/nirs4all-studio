import { describe, expect, it } from "vitest";

import type { PipelineStep } from "@/components/pipeline-editor/types";
import type { PersistedPipelineState } from "@/lib/pipelineEditorPersistence";
import { resolvePipelineEditorInitialState } from "./usePipelineEditorPersistence";

const initialStep: PipelineStep = {
  id: "initial-model",
  type: "model",
  name: "PLSRegression",
  params: {},
};

const persistedStep: PipelineStep = {
  id: "draft-model",
  type: "model",
  name: "Ridge",
  params: {},
};

describe("resolvePipelineEditorInitialState", () => {
  it("prefers persisted editor state over provided initial values", () => {
    const persistedState: PersistedPipelineState = {
      steps: [persistedStep],
      pipelineName: "Draft pipeline",
      isFavorite: true,
      lastModified: 123,
      config: { seed: 42 },
      isDirty: true,
    };

    expect(
      resolvePipelineEditorInitialState({
        persistedState,
        initialSteps: [initialStep],
        initialName: "Initial pipeline",
        initialConfig: { seed: 7 },
      })
    ).toEqual({
      steps: [persistedStep],
      pipelineName: "Draft pipeline",
      pipelineConfig: { seed: 42 },
      isFavorite: true,
    });
  });

  it("falls back to provided initial values when no persisted state is available", () => {
    const resolved = resolvePipelineEditorInitialState({
      persistedState: null,
      initialSteps: [initialStep],
      initialName: "Initial pipeline",
      initialConfig: { verbose: 1 },
    });

    expect(resolved.pipelineName).toBe("Initial pipeline");
    expect(resolved.pipelineConfig).toEqual({ verbose: 1 });
    expect(resolved.isFavorite).toBe(false);
    expect(resolved.steps).toHaveLength(1);
    expect(resolved.steps[0]).toMatchObject({
      id: "initial-model",
      type: "model",
      name: "PLSRegression",
    });
  });
});

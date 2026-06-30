/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  clearPipelineEditorPersistedState,
  getPipelineEditorPersistenceKey,
  hasPersistedPipelineEditorState,
  listDirtyPipelineEditorDrafts,
  loadPipelineEditorPersistedState,
  migratePipelineEditorDraftKey,
  savePipelineEditorPersistedState,
  STORAGE_KEY_PREFIX,
  type PersistedPipelineState,
} from "../pipelineEditorPersistence";

const PIPELINE_ID = "pipeline_123";

function persistedState(overrides: Partial<PersistedPipelineState> = {}): PersistedPipelineState {
  return {
    steps: [],
    pipelineName: "Pipeline",
    isFavorite: false,
    lastModified: 100,
    isDirty: true,
    ...overrides,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("pipelineEditorPersistence", () => {
  it("builds stable keys and saves, loads, and clears persisted state", () => {
    const state = persistedState({
      steps: [{ id: "model", type: "model", name: "PLSRegression", params: { n_components: 12 } }],
      config: { seed: 42 },
    });

    expect(getPipelineEditorPersistenceKey(PIPELINE_ID)).toBe(`${STORAGE_KEY_PREFIX}${PIPELINE_ID}`);

    savePipelineEditorPersistedState(PIPELINE_ID, state);

    expect(loadPipelineEditorPersistedState(PIPELINE_ID)).toMatchObject({
      pipelineName: "Pipeline",
      isDirty: true,
      config: { seed: 42 },
      steps: [
        expect.objectContaining({
          id: "model",
          type: "model",
          name: "PLSRegression",
          params: expect.objectContaining({ n_components: 12 }),
        }),
      ],
    });
    expect(hasPersistedPipelineEditorState(PIPELINE_ID)).toBe(true);

    clearPipelineEditorPersistedState(PIPELINE_ID);

    expect(loadPipelineEditorPersistedState(PIPELINE_ID)).toBeNull();
  });

  it("normalizes invalid steps and removes stale loading placeholders", () => {
    const key = getPipelineEditorPersistenceKey(PIPELINE_ID);
    localStorage.setItem(
      key,
      JSON.stringify({
        steps: "not-an-array",
        pipelineName: "Loading Pipeline...",
        isFavorite: false,
        lastModified: 0,
        isDirty: false,
      }),
    );

    expect(loadPipelineEditorPersistedState(PIPELINE_ID)).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("migrates dirty drafts between persistence keys", () => {
    const state = persistedState({ pipelineName: "Migrated draft", lastModified: 200 });
    savePipelineEditorPersistedState("old", state);

    migratePipelineEditorDraftKey("old", "new");

    expect(loadPipelineEditorPersistedState("old")).toBeNull();
    expect(loadPipelineEditorPersistedState("new")).toMatchObject({
      pipelineName: "Migrated draft",
      isDirty: true,
    });
  });

  it("lists dirty drafts sorted by last modification and normalizes partial entries", () => {
    localStorage.setItem("unrelated", JSON.stringify({ isDirty: true }));
    localStorage.setItem(`${STORAGE_KEY_PREFIX}malformed`, "{");
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}clean`,
      JSON.stringify(persistedState({ pipelineName: "Clean", isDirty: false, lastModified: 400 })),
    );
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}older`,
      JSON.stringify({
        steps: "invalid",
        pipelineName: "",
        lastModified: "not-a-number",
        isDirty: true,
      }),
    );
    localStorage.setItem(
      `${STORAGE_KEY_PREFIX}newer`,
      JSON.stringify(persistedState({ pipelineName: "Newer", isFavorite: true, lastModified: 300 })),
    );

    expect(listDirtyPipelineEditorDrafts()).toEqual([
      {
        id: "newer",
        state: expect.objectContaining({
          pipelineName: "Newer",
          isFavorite: true,
          lastModified: 300,
          isDirty: true,
        }),
      },
      {
        id: "older",
        state: expect.objectContaining({
          steps: [],
          pipelineName: "Untitled pipeline",
          isFavorite: false,
          lastModified: 0,
          isDirty: true,
        }),
      },
    ]);
  });
});

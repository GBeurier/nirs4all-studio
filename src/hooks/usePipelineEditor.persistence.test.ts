/**
 * @vitest-environment jsdom
 */

import { afterEach, describe, expect, it } from "vitest";
import { hasPersistedPipelineState } from "./usePipelineEditor";

const PIPELINE_ID = "pipeline_123";
const STORAGE_KEY = `nirs4all_pipeline_editor_${PIPELINE_ID}`;

afterEach(() => {
  localStorage.clear();
});

describe("hasPersistedPipelineState", () => {
  it("ignores stale loading placeholders for existing pipelines", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        steps: [],
        pipelineName: "Loading Pipeline...",
        isFavorite: false,
        lastModified: Date.now(),
        isDirty: false,
      }),
    );

    expect(hasPersistedPipelineState(PIPELINE_ID)).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("ignores clean persisted snapshots", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        steps: [{ id: "model", type: "model", name: "PLSRegression", params: {} }],
        pipelineName: "Advanced PLS Pipeline",
        isFavorite: true,
        lastModified: Date.now(),
        isDirty: false,
      }),
    );

    expect(hasPersistedPipelineState(PIPELINE_ID)).toBe(false);
  });

  it("keeps dirty local drafts authoritative", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        steps: [{ id: "model", type: "model", name: "PLSRegression", params: { n_components: 12 } }],
        pipelineName: "Advanced PLS Pipeline",
        isFavorite: true,
        lastModified: Date.now(),
        isDirty: true,
      }),
    );

    expect(hasPersistedPipelineState(PIPELINE_ID)).toBe(true);
  });
});

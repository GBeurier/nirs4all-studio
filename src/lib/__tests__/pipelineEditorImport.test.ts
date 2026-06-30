import { describe, expect, it } from "vitest";

import {
  buildPipelineFileImportDraft,
  buildPipelinePayloadImportDraft,
  buildPlaygroundPipelineImportDraft,
  getPipelineImportFallbackName,
  getPipelineImportFormat,
} from "../pipelineEditorImport";

describe("pipelineEditorImport", () => {
  it("builds import-preview requests from playground exports", () => {
    expect(
      buildPlaygroundPipelineImportDraft(JSON.stringify({
        name: "Playground Draft",
        steps: [
          { type: "splitting", name: "KFold", params: { n_splits: 4 } },
          { type: "preprocessing", name: "SNV", params: {} },
          { type: "model", name: "PLSRegression", params: { n_components: 8 } },
        ],
      })),
    ).toEqual({
      request: {
        payload: {
          name: "Playground Draft",
          pipeline: [
            { split: "KFold", n_splits: 4 },
            { preprocessing: "SNV" },
            { model: "PLSRegression", n_components: 8 },
          ],
        },
      },
      fallbackName: "Playground Draft",
    });
  });

  it("rejects malformed playground exports", () => {
    expect(buildPlaygroundPipelineImportDraft(null)).toBeNull();
    expect(buildPlaygroundPipelineImportDraft("{bad-json")).toBeNull();
    expect(buildPlaygroundPipelineImportDraft(JSON.stringify({ steps: {} }))).toBeNull();
    expect(buildPlaygroundPipelineImportDraft(JSON.stringify({ steps: [{ type: "splitting" }] }))).toBeNull();
  });

  it("builds import drafts from canonical pipeline payloads", () => {
    const pipeline = [{ preprocessing: "SNV" }];

    expect(
      buildPipelinePayloadImportDraft({
        name: "Chain Snapshot",
        pipeline,
        fallbackName: "Fallback",
      }),
    ).toEqual({
      request: {
        payload: {
          name: "Chain Snapshot",
          pipeline,
        },
      },
      fallbackName: "Chain Snapshot",
    });

    expect(
      buildPipelinePayloadImportDraft({
        name: null,
        pipeline,
        fallbackName: "Fallback",
      })?.fallbackName,
    ).toBe("Fallback");

    expect(
      buildPipelinePayloadImportDraft({
        name: "Invalid",
        pipeline: {},
        fallbackName: "Fallback",
      }),
    ).toBeNull();
  });

  it("builds file import drafts from filenames and content", () => {
    expect(buildPipelineFileImportDraft("pipeline.yaml", "steps: []")).toEqual({
      request: {
        content: "steps: []",
        format: "yaml",
      },
      fallbackName: "pipeline",
    });

    expect(buildPipelineFileImportDraft("pipeline.json", "{}")).toEqual({
      request: {
        content: "{}",
        format: "json",
      },
      fallbackName: "pipeline",
    });
  });

  it("detects file import format and fallback names", () => {
    expect(getPipelineImportFormat("pipeline.yml")).toBe("yaml");
    expect(getPipelineImportFormat("pipeline.yaml")).toBe("yaml");
    expect(getPipelineImportFormat("pipeline.JSON")).toBe("json");
    expect(getPipelineImportFallbackName("advanced.pipeline.json")).toBe("advanced.pipeline");
    expect(getPipelineImportFallbackName(".json")).toBe("Imported Pipeline");
  });
});

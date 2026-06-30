import { describe, expect, it } from "vitest";

import {
  buildCanonicalPipelineExport,
  buildEditorPipelineExport,
  getPipelineExportFileStem,
} from "../pipelineEditorExport";

describe("pipelineEditorExport", () => {
  it("builds editor JSON exports with the current filename convention", () => {
    expect(
      buildEditorPipelineExport("PLS Draft", {
        name: "PLS Draft",
        steps: [{ id: "model" }],
      }),
    ).toEqual({
      filename: "PLS_Draft.json",
      content: JSON.stringify({
        name: "PLS Draft",
        steps: [{ id: "model" }],
      }, null, 2),
      mimeType: "application/json",
    });
  });

  it("builds canonical JSON and YAML exports from render-preview output", () => {
    const rendered = {
      success: true,
      payload: {},
      json: "{\"pipeline\":[]}",
      yaml: "pipeline: []",
      filename: "ignored-by-studio",
    };

    expect(
      buildCanonicalPipelineExport({
        pipelineName: "PLS Draft",
        rendered,
        format: "json",
      }),
    ).toEqual({
      filename: "PLS_Draft_nirs4all.json",
      content: "{\"pipeline\":[]}",
      mimeType: "application/json",
    });

    expect(
      buildCanonicalPipelineExport({
        pipelineName: "PLS Draft",
        rendered,
        format: "yaml",
      }),
    ).toEqual({
      filename: "PLS_Draft_nirs4all.yaml",
      content: "pipeline: []",
      mimeType: "text/yaml",
    });
  });

  it("sanitizes pipeline export file stems without hiding the fallback", () => {
    expect(getPipelineExportFileStem("  PLS   Draft  ")).toBe("PLS_Draft");
    expect(getPipelineExportFileStem("")).toBe("pipeline");
    expect(getPipelineExportFileStem("   ")).toBe("pipeline");
  });
});

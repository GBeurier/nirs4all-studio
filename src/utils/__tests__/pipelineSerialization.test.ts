import { describe, expect, it } from "vitest";
import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  parsePipelineString,
  serializePipeline,
  validatePipelineRoundTrip,
} from "../pipelineSerialization";
import type { Nirs4allPipeline, Nirs4allStep } from "../nirs4allPipelineTypes";

describe("pipelineSerialization", () => {
  it("parses and serializes JSON canonical pipelines", () => {
    const pipeline: Nirs4allPipeline = {
      name: "demo",
      description: "Demo pipeline",
      pipeline: [
        "nirs4all.operators.transforms.scalers.StandardNormalVariate",
      ],
    };

    expect(parsePipelineString(JSON.stringify(pipeline))).toEqual(pipeline);
    expect(serializePipeline(pipeline, 2)).toBe(JSON.stringify(pipeline, null, 2));
  });

  it("keeps YAML parse failure messaging explicit for browser usage", () => {
    expect(() => parsePipelineString("name: demo")).toThrow(
      "Only JSON format is supported in the browser. Use the backend for YAML."
    );
  });

  it("validates round-trip step count through injected import/export adapters", () => {
    const original: Nirs4allStep[] = ["A", "B"];
    const imported: EditorPipelineStep[] = [
      { id: "a", type: "preprocessing", name: "A", params: {} },
      { id: "b", type: "preprocessing", name: "B", params: {} },
    ];

    const valid = validatePipelineRoundTrip(
      original,
      () => imported,
      () => ["A", "B"]
    );
    const invalid = validatePipelineRoundTrip(
      original,
      () => imported,
      () => ["A"]
    );

    expect(valid).toMatchObject({
      valid: true,
      stepCountMatch: true,
      editorSteps: imported,
      exportedSteps: ["A", "B"],
      differences: [],
    });
    expect(invalid).toMatchObject({
      valid: false,
      stepCountMatch: false,
      exportedSteps: ["A"],
      differences: ["Step count mismatch: 2 vs 1"],
    });
  });
});

/**
 * Pipeline Converter — Round-Trip and Serialization Utilities
 * ===========================================================
 */

import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import { type Nirs4allStep, type Nirs4allPipeline } from "./shared";
import { importFromNirs4all } from "./fromNirs4all";
import { exportToNirs4all } from "./toNirs4all";

/**
 * Validate that a pipeline can be round-tripped without loss.
 */
export function validateRoundTrip(original: Nirs4allStep[] | Nirs4allPipeline): {
  valid: boolean;
  stepCountMatch: boolean;
  editorSteps: EditorPipelineStep[];
  exportedSteps: Nirs4allStep[];
  differences: string[];
} {
  const originalSteps = Array.isArray(original) ? original : original.pipeline;
  const editorSteps = importFromNirs4all(originalSteps);
  const exportedSteps = exportToNirs4all(editorSteps) as Nirs4allStep[];

  const differences: string[] = [];
  const stepCountMatch = originalSteps.length === exportedSteps.length;

  if (!stepCountMatch) {
    differences.push(`Step count mismatch: ${originalSteps.length} vs ${exportedSteps.length}`);
  }

  return {
    valid: differences.length === 0,
    stepCountMatch,
    editorSteps,
    exportedSteps,
    differences,
  };
}

/**
 * Load a pipeline from JSON or YAML string.
 */
export function parsePipelineString(content: string): Nirs4allPipeline {
  // Try JSON first
  try {
    return JSON.parse(content);
  } catch {
    // Not JSON - would need YAML parser
    throw new Error("Only JSON format is supported in the browser. Use the backend for YAML.");
  }
}

/**
 * Serialize a pipeline to JSON string.
 */
export function serializePipeline(
  pipeline: Nirs4allPipeline | Nirs4allStep[],
  indent = 2
): string {
  return JSON.stringify(pipeline, null, indent);
}

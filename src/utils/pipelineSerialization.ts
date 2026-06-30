import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import type { Nirs4allPipeline, Nirs4allStep } from "./nirs4allPipelineTypes";

type PipelineImporter = (pipeline: Nirs4allPipeline | Nirs4allStep[]) => EditorPipelineStep[];
type PipelineExporter = (steps: EditorPipelineStep[]) => Nirs4allPipeline | Nirs4allStep[];

export interface PipelineRoundTripValidationResult {
  valid: boolean;
  stepCountMatch: boolean;
  editorSteps: EditorPipelineStep[];
  exportedSteps: Nirs4allStep[];
  differences: string[];
}

export function validatePipelineRoundTrip(
  original: Nirs4allStep[] | Nirs4allPipeline,
  importPipeline: PipelineImporter,
  exportPipeline: PipelineExporter
): PipelineRoundTripValidationResult {
  const originalSteps = Array.isArray(original) ? original : original.pipeline;
  const editorSteps = importPipeline(originalSteps);
  const exportedSteps = exportPipeline(editorSteps) as Nirs4allStep[];

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

export function parsePipelineString(content: string): Nirs4allPipeline {
  try {
    return JSON.parse(content);
  } catch {
    throw new Error("Only JSON format is supported in the browser. Use the backend for YAML.");
  }
}

export function serializePipeline(
  pipeline: Nirs4allPipeline | Nirs4allStep[],
  indent = 2
): string {
  return JSON.stringify(pipeline, null, indent);
}

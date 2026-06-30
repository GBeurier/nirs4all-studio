/**
 * Pipeline Converter
 * ==================
 *
 * Compatibility facade for bidirectional conversion between nirs4all canonical
 * pipeline format and the webapp's editor format.
 */

import type { PipelineStep as EditorPipelineStep } from "@/components/pipeline-editor/types";
import {
  exportToNirs4all,
  importFromNirs4all,
} from "./pipelineCanonicalConversion";
import type {
  Nirs4allPipeline,
  Nirs4allStep,
} from "./nirs4allPipelineTypes";
import { validatePipelineRoundTrip } from "./pipelineSerialization";

export type {
  Nirs4allBranchStep,
  Nirs4allChartStep,
  Nirs4allClassStep,
  Nirs4allConcatTransformStep,
  Nirs4allFeatureAugmentationStep,
  Nirs4allFilterWrapperStep,
  Nirs4allGeneratorStep,
  Nirs4allMergeStep,
  Nirs4allModelStep,
  Nirs4allPipeline,
  Nirs4allSampleAugmentationStep,
  Nirs4allSampleFilterStep,
  Nirs4allSplitStep,
  Nirs4allStep,
  Nirs4allYProcessingStep,
} from "./nirs4allPipelineTypes";

export { hydrateEditorPipelineSteps } from "./pipelineEditorHydration";
export {
  exportToNirs4all,
  importFromNirs4all,
} from "./pipelineCanonicalConversion";
export { parsePipelineString, serializePipeline } from "./pipelineSerialization";

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
  return validatePipelineRoundTrip(original, importFromNirs4all, exportToNirs4all);
}

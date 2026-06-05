/**
 * Pipeline Converter
 * ==================
 *
 * Bidirectional conversion between nirs4all canonical pipeline format and
 * the webapp's editor format.
 *
 * nirs4all canonical format:
 * - Uses `{"class": "module.path.ClassName", "params": {...}}`
 * - Keywords: model, y_processing, branch, merge, sample_augmentation, etc.
 * - Generators: _or_, _range_, _log_range_, _grid_ at step level
 *
 * Editor format:
 * - Uses `{ id, type, name, params, branches, ... }`
 * - Type is separate field
 * - Name is display name (e.g., "SNV", "PLSRegression")
 *
 * This module is a barrel that re-exports the public API. The implementation
 * lives under `pipelineConverter/`:
 * - `shared.ts`      — types, class-path mappings, and small helpers
 * - `fromNirs4all.ts` — import direction (nirs4all → editor)
 * - `toNirs4all.ts`   — export direction (editor → nirs4all)
 * - `utils.ts`        — round-trip validation and (de)serialization
 */

export type {
  Nirs4allStep,
  Nirs4allClassStep,
  Nirs4allModelStep,
  Nirs4allYProcessingStep,
  Nirs4allBranchStep,
  Nirs4allMergeStep,
  Nirs4allSampleAugmentationStep,
  Nirs4allFeatureAugmentationStep,
  Nirs4allSampleFilterStep,
  Nirs4allConcatTransformStep,
  Nirs4allGeneratorStep,
  Nirs4allChartStep,
  Nirs4allPipeline,
} from "./pipelineConverter/shared";

export { importFromNirs4all } from "./pipelineConverter/fromNirs4all";
export { exportToNirs4all } from "./pipelineConverter/toNirs4all";
export { validateRoundTrip, parsePipelineString, serializePipeline } from "./pipelineConverter/utils";

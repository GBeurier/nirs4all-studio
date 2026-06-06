/**
 * Pipelines API client — pipeline CRUD, import/export-preview, canonical
 * render, bundled samples, and shape propagation.
 */

import { api } from "./transport";

export interface PipelineInfo {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps: PipelineStep[];
  created_at: string;
  updated_at: string;
  is_favorite?: boolean;
}

// Note: This is a minimal type for API transport. The full pipeline step type
// with branches, generators, etc. is in @/components/pipeline-editor/types.ts
// We use Record<string, unknown> to preserve all fields during save/load.
export interface PipelineStep {
  id: string;
  type: string;  // Allow any step type
  name: string;
  params: Record<string, unknown>;
  // Additional fields are preserved via spread during serialization
  [key: string]: unknown;
}

export async function listPipelines(): Promise<{ pipelines: PipelineInfo[] }> {
  return api.get("/pipelines");
}

export async function getPipeline(id: string): Promise<PipelineInfo> {
  const response = await api.get<{ pipeline: PipelineInfo }>(`/pipelines/${id}`);
  return response.pipeline;
}

export async function savePipeline(
  pipeline: Partial<PipelineInfo>
): Promise<{ success: boolean; pipeline: PipelineInfo }> {
  if (pipeline.id) {
    return api.put(`/pipelines/${pipeline.id}`, pipeline);
  }
  return api.post("/pipelines", pipeline);
}

export interface PipelineImportRequest {
  content?: string;
  payload?: unknown;
  format?: "yaml" | "yml" | "json";
  name?: string;
}

export interface PipelineImportPreviewResponse {
  success: boolean;
  name: string;
  description: string;
  steps: PipelineStep[];
}

export interface CanonicalPipelineRenderRequest {
  steps: PipelineStep[];
  name?: string;
  description?: string;
}

export interface CanonicalPipelineRenderResponse {
  success: boolean;
  payload: unknown;
  json: string;
  yaml: string;
  filename: string;
}

export async function previewPipelineImport(
  request: PipelineImportRequest
): Promise<PipelineImportPreviewResponse> {
  return api.post("/pipelines/import-preview", request);
}

export async function importPipeline(
  request: PipelineImportRequest
): Promise<{ success: boolean; pipeline: PipelineInfo }> {
  return api.post("/pipelines/import", request);
}

export async function renderCanonicalPipeline(
  request: CanonicalPipelineRenderRequest
): Promise<CanonicalPipelineRenderResponse> {
  return api.post("/pipelines/render-canonical", request);
}

export async function deletePipeline(
  id: string
): Promise<{ success: boolean }> {
  return api.delete(`/pipelines/${id}`);
}

export interface PipelineSampleInfo {
  id: string;
  filename: string;
  format: string;
  name: string;
  description: string;
}

export interface PipelineSamplesResponse {
  samples: PipelineSampleInfo[];
  total: number;
  samples_dir: string;
}

export interface PipelineSampleDetail {
  name: string;
  description: string;
  pipeline: unknown[];
  has_generators: boolean;
  num_configurations: number;
  source_file: string;
  error?: string;
}

export interface RoundtripValidationResult {
  valid: boolean;
  sample_id: string;
  differences: string[];
  original_step_count: number;
  editor_step_count: number;
}

export async function listPipelineSamples(): Promise<PipelineSamplesResponse> {
  return api.get("/pipelines/samples");
}

export async function getPipelineSample(
  sampleId: string,
  canonical: boolean = true
): Promise<PipelineSampleDetail> {
  return api.get(`/pipelines/samples/${sampleId}?canonical=${canonical}`);
}

export async function validateSampleRoundtrip(
  sampleId: string,
  editorSteps: unknown[]
): Promise<RoundtripValidationResult> {
  return api.post(`/pipelines/samples/${sampleId}/validate-roundtrip`, editorSteps);
}

/**
 * Shape at a pipeline step
 */
export interface ShapeAtStep {
  step_id: string;
  step_name: string;
  input_shape: { samples: number; features: number };
  output_shape: { samples: number; features: number };
  warnings: ShapeWarning[];
}

/**
 * Shape warning
 */
export interface ShapeWarning {
  type: "param_exceeds_dimension" | "shape_mismatch" | "unknown_transform";
  step_id: string;
  step_name: string;
  message: string;
  param_name?: string;
  param_value?: number;
  max_value?: number;
  severity: "warning" | "error";
}

/**
 * Shape propagation response
 */
export interface ShapePropagationResponse {
  shapes: ShapeAtStep[];
  warnings: ShapeWarning[];
  output_shape: { samples: number; features: number };
  is_valid: boolean;
}

/**
 * Calculate shape propagation through a pipeline
 */
export async function propagateShape(
  steps: unknown[],
  inputShape: { samples: number; features: number }
): Promise<ShapePropagationResponse> {
  return api.post("/pipelines/propagate-shape", {
    steps,
    input_shape: inputShape,
  });
}

/**
 * Pipeline types for nirs4all webapp
 * Phase 6: Pipelines Library
 */

export type PipelineCategory = "user" | "preset" | "shared";
export type PipelineRunStatus = "success" | "failed" | "running" | "pending";
export type PipelineStepType = "preprocessing" | "splitting" | "model" | "metrics" | "augmentation" | "feature_selection";

export interface PipelineStep {
  id: string;
  type: PipelineStepType;
  name: string;
  displayName?: string;
  params: Record<string, unknown>;
  enabled?: boolean;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string;
  category: PipelineCategory;
  steps: PipelineStep[];
  isFavorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  runCount?: number;
  lastRunStatus?: PipelineRunStatus;
  lastRunDate?: string;
  taskType?: "regression" | "classification";
}

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  category: string;
  taskType: "regression" | "classification";
  steps: Omit<PipelineStep, "id">[];
  icon?: string;
  recommended?: boolean;
}

export interface PipelineOperator {
  name: string;
  displayName: string;
  description: string;
  params: Record<string, OperatorParam>;
  category?: string;
  source?: "nirs4all" | "sklearn";
}

export interface OperatorParam {
  type: "int" | "float" | "str" | "bool" | "array" | "object";
  default?: unknown;
  min?: number;
  max?: number;
  options?: string[];
  required?: boolean;
}

export interface PipelineOperators {
  preprocessing: PipelineOperator[];
  splitting: PipelineOperator[];
  models: PipelineOperator[];
  metrics: PipelineOperator[];
  augmentation: PipelineOperator[];
  feature_selection: PipelineOperator[];
  charts?: PipelineOperator[];
}

/** Raw API response format from the backend */
export interface PipelineApiResponse {
  id: string;
  name: string;
  description?: string;
  category?: string;
  steps?: PipelineStep[];
  is_favorite?: boolean;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
  run_count?: number;
  last_run_status?: string;
  last_run_date?: string;
  task_type?: string;
}

export interface PipelineListResponse {
  pipelines: PipelineApiResponse[];
}

export interface PipelinePresetsResponse {
  presets: PipelinePreset[];
  total: number;
}

export interface PipelineValidationResult {
  valid: boolean;
  steps: Array<{
    index: number;
    name: string;
    type: string;
    valid: boolean;
    errors: string[];
    warnings: string[];
  }>;
  errors: string[];
  warnings: string[];
}

export type ViewMode = "grid" | "list";
export type SortBy = "name" | "lastModified" | "runCount" | "steps";
export type FilterTab = "all" | "favorites" | "user" | "preset" | "shared" | "history";

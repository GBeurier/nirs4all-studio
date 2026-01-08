/**
 * Types for nirs4all linked workspace management
 * Phase 7 Implementation
 */

export interface WorkspaceDiscoveredCounts {
  runs_count: number;
  datasets_count: number;
  exports_count: number;
  templates_count: number;
}

export interface LinkedWorkspace {
  id: string;
  path: string;
  name: string;
  is_active: boolean;
  linked_at: string;
  last_scanned: string | null;
  discovered: WorkspaceDiscoveredCounts;
}

export interface LinkedWorkspaceCreateRequest {
  path: string;
  name?: string;
}

export interface LinkedWorkspaceListResponse {
  workspaces: LinkedWorkspace[];
  active_workspace_id: string | null;
  total: number;
}

export interface LinkedWorkspaceScanResult {
  workspace_id: string;
  workspace_name: string;
  discovered: WorkspaceDiscoveredCounts;
  datasets: DiscoveredDataset[];
  scanned_at: string;
  message: string;
}

export interface DiscoveredDataset {
  path: string;
  name: string;
  hash: string | null;
  runs_count: number;
}

export interface DiscoveredRun {
  id: string;
  pipeline_id: string;
  name: string;
  dataset: string;
  created_at: string | null;
  schema_version: string;
  artifact_count: number;
  predictions_count: number;
  dataset_info: Record<string, unknown>;
  manifest_path: string;
  // Extended fields from parquet-derived data
  pipeline_count?: number;
  models?: string[];
  best_val_score?: number | null;
  best_test_score?: number | null;
}

export interface LinkedWorkspaceDiscoveredRuns {
  workspace_id: string;
  runs: DiscoveredRun[];
  total: number;
}

export interface DiscoveredPrediction {
  dataset: string;
  path: string;
  format: string;
  size_bytes: number;
}

export interface LinkedWorkspaceDiscoveredPredictions {
  workspace_id: string;
  predictions: DiscoveredPrediction[];
  total: number;
}

/**
 * A single prediction record from a .meta.parquet file.
 * Contains metadata about a model's predictions on a dataset.
 */
export interface PredictionRecord {
  id: string;
  source_dataset: string;
  source_file: string;
  dataset_name: string;
  config_name?: string;
  pipeline_uid?: string;
  step_idx?: number;
  op_counter?: number;
  model_name: string;
  model_classname?: string;
  fold_id?: string;
  partition: string;
  val_score?: number | null;
  test_score?: number | null;
  train_score?: number | null;
  metric?: string;
  task_type?: string;
  n_samples?: number;
  n_features?: number;
  preprocessings?: string;
  best_params?: Record<string, unknown>;
  scores?: Record<string, Record<string, number>>;
  branch_id?: number | null;
  branch_name?: string | null;
  exclusion_count?: number | null;
  exclusion_rate?: number | null;
  model_artifact_id?: string | null;
  trace_id?: string | null;
}

export interface PredictionDataResponse {
  records: PredictionRecord[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}

export interface DiscoveredExport {
  type: "n4a_bundle" | "pipeline_json" | "summary_json" | "predictions_csv";
  name?: string;
  model_name?: string;
  dataset: string;
  path: string;
  size_bytes?: number;
  test_score?: number | null;
  val_score?: number | null;
  steps_count?: number;
}

export interface LinkedWorkspaceDiscoveredExports {
  workspace_id: string;
  exports: DiscoveredExport[];
  total: number;
}

export interface DiscoveredTemplate {
  type: "template" | "trained_pipeline" | "filtered";
  name: string;
  path: string;
  description?: string;
  created_at?: string;
  steps_count?: number;
}

export interface LinkedWorkspaceDiscoveredTemplates {
  workspace_id: string;
  templates: DiscoveredTemplate[];
  total: number;
}

export interface UIPreferences {
  theme: "light" | "dark" | "system";
  density: "compact" | "comfortable" | "spacious";
  language: string;
}

export interface AppSettingsResponse {
  version: string;
  linked_workspaces_count: number;
  active_workspace_id: string | null;
  favorite_pipelines: string[];
  ui_preferences: UIPreferences;
}

export interface AppSettingsUpdateRequest {
  ui_preferences?: Partial<UIPreferences>;
}

export interface FavoriteAddRequest {
  pipeline_id: string;
}

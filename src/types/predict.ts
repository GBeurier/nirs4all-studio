/**
 * Types for the Predict feature — running predictions on new data using trained models.
 */

export interface AvailableModel {
  id: string;
  name: string;
  source: "bundle" | "chain";
  model_class: string;
  dataset_name: string | null;
  metric: string | null;
  best_score: number | null;
  created_at: string | null;
  file_size: number | null;
  preprocessing: string | null;
  bundle_path: string | null;
  has_refit?: boolean;
  fold_artifacts?: Record<string, string> | null;
  prediction_metric?: string | null;
  prediction_score?: number | null;
  execution_profile?: "captured_general";
  archive_fingerprint?: string;
  artifact_fingerprint?: string;
  target_names?: string[];
}

export interface AvailableModelsResponse {
  models: AvailableModel[];
  total: number;
}

export interface PredictRequest {
  model_id: string;
  model_source: "chain" | "bundle";
  data_source: "dataset" | "array";
  dataset_id?: string;
  partition?: string;
  spectra?: number[][];
  engine?: string | null;
  allow_fallback?: boolean;
  archive_fingerprint?: string;
  output_index?: number;
}

export interface PredictionRuntimeRecord {
  verb?: string;
  backend?: string;
  oracle?: string;
  engine?: string | null;
  engine_requested?: string | null;
  engine_diagnostics?: Array<Record<string, unknown>> | null;
  runtime_source?: string | null;
  runtime_manifest?: Record<string, unknown> | null;
  fallback_policy?: Record<string, unknown> | null;
  native_result_refs?: Record<string, unknown> | null;
}

export interface PredictResponse {
  predictions: number[];
  prediction_matrix?: number[][];
  target_names?: string[];
  output_index?: number;
  num_samples: number;
  model_name: string;
  preprocessing_steps: string[];
  actual_values: number[] | null;
  metrics: Record<string, number> | null;
  sample_ids: (string | number)[] | null;
  /** Human-readable uploaded labels, separate from stable execution sample IDs. */
  sample_labels?: string[] | null;
  /** When the request was `partition: "all"`, backend returns per-sample
   *  partition labels ("train"/"val"/"test") so charts can split by partition. */
  partitions?: (string | null)[] | null;
  runtime?: PredictionRuntimeRecord | null;
}

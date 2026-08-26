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
}

export interface AvailableModelsResponse {
  models: AvailableModel[];
  total: number;
}

export interface PredictRequest {
  model_id: string;
  model_source: "chain" | "bundle" | "native_archive";
  data_source: "dataset" | "array";
  dataset_id?: string;
  partition?: string;
  spectra?: number[][];
  /** Required by the fail-closed native Archive V2 route. */
  sample_ids?: string[];
}

export interface NativeConformalPresentation {
  schema_version: 1;
  package_fingerprint: string;
  replay_outcome_fingerprint: string;
  binding_id: string;
  target_name: string;
  sample_ids: string[];
  point_predictions: number[];
  intervals: Array<{
    coverage: number;
    lower: Array<number | null>;
    upper: Array<number | null>;
    qhat: number | null;
  }>;
  calibration_fingerprint: string;
  presentation_fingerprint: string;
}

export interface PredictResponse {
  predictions: number[];
  num_samples: number;
  model_name: string;
  preprocessing_steps: string[];
  actual_values: number[] | null;
  metrics: Record<string, number> | null;
  sample_ids: (string | number)[] | null;
  conformal_presentation?: NativeConformalPresentation | null;
  /** When the request was `partition: "all"`, backend returns per-sample
   *  partition labels ("train"/"val"/"test") so charts can split by partition. */
  partitions?: (string | null)[] | null;
}

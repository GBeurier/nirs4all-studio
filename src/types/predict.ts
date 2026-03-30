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
}

export interface PredictResponse {
  predictions: number[];
  num_samples: number;
  model_name: string;
  preprocessing_steps: string[];
  actual_values: number[] | null;
  metrics: Record<string, number> | null;
  sample_ids: (string | number)[] | null;
}

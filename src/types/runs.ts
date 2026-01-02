/**
 * Run types for nirs4all webapp
 * Phase 8: Runs Management
 */

export type RunStatus = "queued" | "running" | "completed" | "failed" | "paused";

export interface RunMetrics {
  r2: number;
  rmse: number;
  mae?: number;
  rpd?: number;
  nrmse?: number;
}

export interface PipelineRun {
  id: string;
  pipeline_id: string;
  pipeline_name: string;
  model: string;
  preprocessing: string;
  split_strategy: string;
  status: RunStatus;
  progress: number;
  metrics?: RunMetrics;
  config?: Record<string, unknown>;
  logs?: string[];
  started_at?: string;
  completed_at?: string;
  error_message?: string;
}

export interface DatasetRun {
  dataset_id: string;
  dataset_name: string;
  pipelines: PipelineRun[];
}

export interface Run {
  id: string;
  name: string;
  description?: string;
  datasets: DatasetRun[];
  status: RunStatus;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  duration?: string;
  created_by?: string;
  cv_folds?: number;
  total_pipelines?: number;
  completed_pipelines?: number;
}

export interface RunProgress {
  run_id: string;
  overall_progress: number;
  current_dataset?: string;
  current_pipeline?: string;
  pipeline_progress?: number;
  estimated_remaining?: string;
}

export const runStatusConfig = {
  queued: {
    label: "Queued",
    color: "text-muted-foreground",
    bg: "bg-muted/50",
    iconClass: "",
  },
  running: {
    label: "Running",
    color: "text-chart-2",
    bg: "bg-chart-2/10",
    iconClass: "animate-spin",
  },
  completed: {
    label: "Completed",
    color: "text-chart-1",
    bg: "bg-chart-1/10",
    iconClass: "",
  },
  failed: {
    label: "Failed",
    color: "text-destructive",
    bg: "bg-destructive/10",
    iconClass: "",
  },
  paused: {
    label: "Paused",
    color: "text-warning",
    bg: "bg-warning/10",
    iconClass: "",
  },
};

// Experiment configuration for creating new runs
export interface ExperimentConfig {
  name: string;
  description?: string;
  dataset_ids: string[];
  pipeline_ids: string[];
  cv_folds: number;
  cv_strategy: "kfold" | "stratified" | "loo" | "holdout";
  test_size?: number;
  shuffle?: boolean;
  random_state?: number;
}

// API responses
export interface RunListResponse {
  runs: Run[];
  total: number;
}

export interface CreateRunRequest {
  config: ExperimentConfig;
}

export interface RunActionResponse {
  success: boolean;
  message: string;
  run_id?: string;
}

export interface RunStatsResponse {
  running: number;
  queued: number;
  completed: number;
  failed: number;
  total_pipelines: number;
}

// WebSocket message + progress-state types for the RunProgress page.

// WebSocket message types
export interface WsMessage {
  type: string;
  channel: string;
  data: {
    job_id?: string;
    progress?: number;
    message?: string;
    log?: string;
    level?: string;
    metrics?: Record<string, number>;
    result?: Record<string, unknown>;
    error?: string;
    // Granular progress fields
    log_context?: {
      fold_id?: number;
      total_folds?: number;
      branch_name?: string;
      variant_index?: number;
      total_variants?: number;
    };
    // Fold progress
    current_fold?: number;
    total_folds?: number;
    // Branch progress
    branch_path?: number[];
    branch_name?: string;
    // Variant progress
    current_variant?: number;
    total_variants?: number;
    variant_description?: string;
    // Refit phase fields
    total_steps?: number;
    description?: string;
    current_step?: number;
    step_name?: string;
    step_type?: string;
    score?: number | null;
    traceback?: string;
  };
  timestamp: string;
}

// Progress state interface for tracking current step
export interface ProgressState {
  progress: number;
  message: string;
  timestamp: number;
}

// Granular progress state for fold/branch/variant tracking
export interface GranularProgress {
  currentFold: number | null;
  totalFolds: number | null;
  currentBranch: string | null;
  currentVariant: number | null;
  totalVariants: number | null;
  variantDescription: string | null;
}

// Refit phase state
export type RefitStatus = "idle" | "running" | "completed" | "failed";

export interface RefitState {
  status: RefitStatus;
  progress: number;
  message: string;
  currentStep: number;
  totalSteps: number;
  stepName: string;
  stepType: string;
  score: number | null;
  metrics: Record<string, number>;
  error: string | null;
}

export const initialGranularProgress: GranularProgress = {
  currentFold: null,
  totalFolds: null,
  currentBranch: null,
  currentVariant: null,
  totalVariants: null,
  variantDescription: null,
};

export const initialRefitState: RefitState = {
  status: "idle",
  progress: 0,
  message: "",
  currentStep: 0,
  totalSteps: 0,
  stepName: "",
  stepType: "",
  score: null,
  metrics: {},
  error: null,
};

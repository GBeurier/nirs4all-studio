/**
 * nirs4all canonical step format (serialized).
 * This matches what PipelineConfigs outputs.
 */
export type Nirs4allStep =
  | string // Class path only, e.g., "sklearn.preprocessing._data.StandardScaler"
  | null
  | Nirs4allStep[]
  | Nirs4allClassStep
  | Nirs4allModelStep
  | Nirs4allYProcessingStep
  | Nirs4allSplitStep
  | Nirs4allBranchStep
  | Nirs4allMergeStep
  | Nirs4allSampleAugmentationStep
  | Nirs4allFeatureAugmentationStep
  | Nirs4allSampleFilterStep
  | Nirs4allFilterWrapperStep
  | Nirs4allConcatTransformStep
  | Nirs4allGeneratorStep
  | Nirs4allChartStep
  | Nirs4allCommentStep
  | Nirs4allPreprocessingStep;

export interface Nirs4allClassStep {
  class: string;
  params?: Record<string, unknown>;
}

export interface Nirs4allModelStep {
  model:
    | string
    | Nirs4allClassStep
    | { function: string; params?: Record<string, unknown>; framework?: string };
  name?: string;
  finetune_params?: Record<string, unknown>;
  train_params?: Record<string, unknown>;
  // Generator keywords can appear at model level
  _range_?: [number, number, number];
  _log_range_?: [number, number, number];
  _grid_?: Record<string, unknown[]>;
  param?: string;
}

export interface Nirs4allYProcessingStep {
  y_processing: string | Nirs4allClassStep;
  [key: string]: unknown;
}

export interface Nirs4allSplitStep {
  split: string | Nirs4allClassStep;
  [key: string]: unknown;
}

export interface Nirs4allBranchStep {
  branch: Record<string, Nirs4allStep[]> | Nirs4allStep[][] | Nirs4allSeparationBranch;
}

export interface Nirs4allSeparationBranch {
  by_tag?: string;
  by_metadata?: string;
  by_filter?: unknown;
  by_source?: boolean;
  steps: Record<string, Nirs4allStep[]>;
}

export interface Nirs4allMergeStep {
  merge: string | {
    predictions?: Array<{
      branch: number;
      select: string | { top_k: number };
      metric?: string;
    }>;
    features?: number[];
    output_as?: string;
    on_missing?: string;
  };
}

export interface Nirs4allSampleAugmentationStep {
  sample_augmentation: {
    transformers: Array<string | Nirs4allClassStep>;
    count?: number;
    selection?: string;
    random_state?: number;
    variation_scope?: string;
  };
}

export interface Nirs4allFeatureAugmentationStep {
  feature_augmentation: Nirs4allStep[] | {
    _or_?: Array<string | Nirs4allClassStep | null>;
    pick?: number | [number, number];
    count?: number;
  };
  action?: string;
}

export interface Nirs4allSampleFilterStep {
  sample_filter: {
    filters: Array<string | Nirs4allClassStep>;
    mode?: string;
    report?: boolean;
  };
}

export interface Nirs4allFilterWrapperStep {
  exclude?: string | Nirs4allClassStep | Array<string | Nirs4allClassStep>;
  tag?: string | Nirs4allClassStep | Array<string | Nirs4allClassStep>;
  mode?: string;
}

export interface Nirs4allConcatTransformStep {
  concat_transform: Array<Nirs4allStep | Nirs4allStep[]>;
}

export interface Nirs4allGeneratorStep {
  _or_?: Array<Nirs4allStep | Nirs4allStep[] | null>;
  _cartesian_?: Array<Nirs4allStep | Nirs4allStep[] | null>;
  _range_?: [number, number, number];
  _log_range_?: [number, number, number];
  _grid_?: Record<string, unknown[]>;
  _zip_?: Record<string, unknown[]>;
  _chain_?: Array<Nirs4allStep | Nirs4allStep[] | null>;
  _sample_?: Record<string, unknown>;
  pick?: number | [number, number];
  arrange?: number | [number, number];
  then_pick?: number | [number, number];
  then_arrange?: number | [number, number];
  count?: number;
  param?: string;
  _seed_?: number;
}

export interface Nirs4allChartStep {
  chart_2d?: Record<string, unknown> | true;
  chart_y?: Record<string, unknown> | true;
}

export interface Nirs4allCommentStep {
  _comment: string;
}

export interface Nirs4allPreprocessingStep {
  preprocessing: string | Nirs4allClassStep;
  [key: string]: unknown;
}

export interface Nirs4allPipeline {
  name?: string;
  description?: string;
  pipeline: Nirs4allStep[];
}

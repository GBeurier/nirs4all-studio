/**
 * Playground API Response Validation
 *
 * Phase 1 Refactoring: Type Safety Improvements
 *
 * Provides runtime validation for API responses using Zod schemas.
 * This ensures type safety at runtime and catches malformed responses
 * from the backend before they cause runtime errors in components.
 */

import { z } from 'zod';

// ============= Base Schemas =============

/**
 * Statistics for spectral data per wavelength
 */
export const SpectrumStatsSchema = z.object({
  mean: z.array(z.number()),
  std: z.array(z.number()),
  min: z.array(z.number()),
  max: z.array(z.number()),
  p5: z.array(z.number()),
  p95: z.array(z.number()),
  median: z.array(z.number()).optional(),
  q1: z.array(z.number()).optional(),
  q3: z.array(z.number()).optional(),
  global: z.object({
    mean: z.number(),
    std: z.number(),
    min: z.number(),
    max: z.number(),
    n_samples: z.number(),
    n_features: z.number(),
  }),
});

/**
 * Y-value statistics for a fold
 */
export const YStatsSchema = z.object({
  mean: z.number(),
  std: z.number(),
  min: z.number(),
  max: z.number(),
});

// ============= Fold Schemas =============

/**
 * Single fold data
 */
export const FoldDataSchema = z.object({
  fold_index: z.number(),
  train_count: z.number(),
  test_count: z.number(),
  train_indices: z.array(z.number()),
  test_indices: z.array(z.number()),
  y_train_stats: YStatsSchema.optional(),
  y_test_stats: YStatsSchema.optional(),
});

/**
 * Fold information when a splitter is present
 */
export const FoldsInfoSchema = z.object({
  splitter_name: z.string(),
  n_folds: z.number(),
  folds: z.array(FoldDataSchema),
  fold_labels: z.array(z.number()),
  split_index: z.number().optional(),
  // Sometimes the API returns these directly (not just in folds array)
  train_indices: z.array(z.number()).optional(),
  test_indices: z.array(z.number()).optional(),
});

// ============= PCA/UMAP Schemas =============

/**
 * PCA projection results
 */
export const PCAResultSchema = z.object({
  coordinates: z.array(z.array(z.number())),
  explained_variance_ratio: z.array(z.number()),
  explained_variance: z.array(z.number()),
  n_components: z.number(),
  y: z.array(z.number()).optional(),
  fold_labels: z.array(z.number()).optional(),
  error: z.string().optional(),
});

/**
 * UMAP projection results
 */
export const UMAPResultSchema = z.object({
  coordinates: z.array(z.array(z.number())),
  n_components: z.number(),
  params: z.object({
    n_neighbors: z.number(),
    min_dist: z.number(),
  }).optional(),
  y: z.array(z.number()).optional(),
  fold_labels: z.array(z.number()).optional(),
  error: z.string().optional(),
  available: z.boolean().optional(),
});

// ============= Data Section Schemas =============

/**
 * Original or processed data section
 */
export const DataSectionSchema = z.object({
  spectra: z.array(z.array(z.number())),
  wavelengths: z.array(z.number()),
  sample_indices: z.array(z.number()).optional(),
  shape: z.array(z.number()),
  statistics: SpectrumStatsSchema.optional(),
});

// ============= Execution Trace Schemas =============

/**
 * Execution trace for a single step
 */
export const StepTraceSchema = z.object({
  step_id: z.string(),
  name: z.string(),
  duration_ms: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
  output_shape: z.array(z.number()).optional(),
});

/**
 * Step error information
 */
export const StepErrorSchema = z.object({
  step: z.string(),
  name: z.string(),
  error: z.string(),
});

// ============= Filter Schemas =============

/**
 * Filter result for a single filter operator
 */
export const FilterResultSchema = z.object({
  name: z.string(),
  removed_count: z.number(),
  reason: z.string().optional(),
});

/**
 * Filter information when filter operators are applied
 */
export const FilterInfoSchema = z.object({
  filters_applied: z.array(FilterResultSchema),
  total_removed: z.number(),
  final_mask: z.array(z.boolean()),
});

// ============= Repetitions Schemas =============

/**
 * Single repetition data point
 */
export const RepetitionDataPointSchema = z.object({
  bio_sample: z.string(),
  rep_index: z.number(),
  sample_index: z.number(),
  sample_id: z.string(),
  distance: z.number(),
  y: z.number().optional(),
  y_mean: z.number().optional(),
});

/**
 * Repetition analysis statistics
 */
export const RepetitionStatisticsSchema = z.object({
  mean_distance: z.number(),
  max_distance: z.number(),
  std_distance: z.number(),
  p95_distance: z.number(),
});

/**
 * Repetition analysis results
 */
export const RepetitionResultSchema = z.object({
  has_repetitions: z.boolean(),
  n_bio_samples: z.number(),
  n_with_reps: z.number(),
  n_singletons: z.number().optional(),
  total_repetitions: z.number().optional(),
  distance_metric: z.enum(['pca', 'umap', 'euclidean', 'mahalanobis']).optional(),
  detected_pattern: z.string().nullable().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  data: z.array(RepetitionDataPointSchema).optional(),
  statistics: RepetitionStatisticsSchema.optional(),
  high_variability_samples: z.array(RepetitionDataPointSchema).optional(),
  bio_sample_groups: z.record(z.string(), z.array(z.number())).optional(),
});

// ============= Metrics Schemas =============

/**
 * Statistics for a single metric
 */
export const MetricStatsSchema = z.object({
  min: z.number(),
  max: z.number(),
  mean: z.number(),
  std: z.number(),
  p5: z.number(),
  p25: z.number(),
  p50: z.number(),
  p75: z.number(),
  p95: z.number(),
});

/**
 * Metrics computation result
 */
export const MetricsResultSchema = z.object({
  values: z.record(z.string(), z.array(z.number())),
  statistics: z.record(z.string(), MetricStatsSchema),
  computed_metrics: z.array(z.string()),
  available_metrics: z.array(z.string()),
  n_samples: z.number(),
  error: z.string().optional(),
});

/**
 * Outlier detection result
 */
export const OutlierResultSchema = z.object({
  success: z.boolean(),
  inlier_mask: z.array(z.boolean()),
  outlier_indices: z.array(z.number()),
  n_outliers: z.number(),
  n_inliers: z.number(),
  method: z.string(),
  threshold: z.number(),
  values: z.array(z.number()).optional(),
  error: z.string().optional(),
});

/**
 * Similarity search result
 */
export const SimilarityResultSchema = z.object({
  success: z.boolean(),
  reference_idx: z.number(),
  metric: z.string(),
  similar_indices: z.array(z.number()),
  distances: z.array(z.number()),
  n_similar: z.number(),
  error: z.string().optional(),
});

// ============= Main Execute Response Schema =============

/**
 * Response from playground execution
 */
export const ExecuteResponseSchema = z.object({
  success: z.boolean(),
  execution_time_ms: z.number(),
  original: DataSectionSchema,
  processed: DataSectionSchema,
  pca: PCAResultSchema.optional(),
  umap: UMAPResultSchema.optional(),
  folds: FoldsInfoSchema.optional(),
  filter_info: FilterInfoSchema.optional(),
  repetitions: RepetitionResultSchema.optional(),
  metrics: MetricsResultSchema.optional(),
  execution_trace: z.array(StepTraceSchema),
  step_errors: z.array(StepErrorSchema),
  is_raw_data: z.boolean().optional(),
});

// ============= Operator Registry Schemas =============

/**
 * Parameter info from the backend
 */
export const OperatorParamInfoSchema = z.object({
  required: z.boolean(),
  default: z.unknown().optional(),
  type: z.string().optional(),
  default_is_callable: z.boolean().optional(),
});

/**
 * Operator definition from the backend registry
 */
export const OperatorDefinitionSchema = z.object({
  name: z.string(),
  display_name: z.string(),
  description: z.string(),
  category: z.string(),
  params: z.record(z.string(), OperatorParamInfoSchema),
  type: z.enum(['preprocessing', 'augmentation', 'splitting', 'filter']),
  source: z.string().optional(),
});

/**
 * Response from GET /api/playground/operators
 */
export const OperatorsResponseSchema = z.object({
  preprocessing: z.array(OperatorDefinitionSchema),
  preprocessing_by_category: z.record(z.string(), z.array(OperatorDefinitionSchema)),
  augmentation: z.array(OperatorDefinitionSchema),
  augmentation_by_category: z.record(z.string(), z.array(OperatorDefinitionSchema)),
  splitting: z.array(OperatorDefinitionSchema),
  splitting_by_category: z.record(z.string(), z.array(OperatorDefinitionSchema)),
  filter: z.array(OperatorDefinitionSchema),
  filter_by_category: z.record(z.string(), z.array(OperatorDefinitionSchema)),
  total: z.number(),
});

// ============= Validation Helpers =============

/**
 * Validates execute response and returns parsed data or throws
 * @throws {z.ZodError} If validation fails
 */
export function validateExecuteResponse(data: unknown) {
  return ExecuteResponseSchema.parse(data);
}

/**
 * Safely validates execute response, returning null on failure
 */
export function safeValidateExecuteResponse(data: unknown) {
  const result = ExecuteResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.error('Execute response validation failed:', result.error.format());
  return null;
}

/**
 * Validates operators response and returns parsed data or throws
 */
export function validateOperatorsResponse(data: unknown) {
  return OperatorsResponseSchema.parse(data);
}

/**
 * Safely validates operators response, returning null on failure
 */
export function safeValidateOperatorsResponse(data: unknown) {
  const result = OperatorsResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  console.error('Operators response validation failed:', result.error.format());
  return null;
}

/**
 * Validates outlier result
 */
export function validateOutlierResult(data: unknown) {
  return OutlierResultSchema.parse(data);
}

/**
 * Validates similarity result
 */
export function validateSimilarityResult(data: unknown) {
  return SimilarityResultSchema.parse(data);
}

// ============= Type Exports =============

/** Inferred types from schemas */
export type ExecuteResponseValidated = z.infer<typeof ExecuteResponseSchema>;
export type OperatorsResponseValidated = z.infer<typeof OperatorsResponseSchema>;
export type DataSectionValidated = z.infer<typeof DataSectionSchema>;
export type FoldsInfoValidated = z.infer<typeof FoldsInfoSchema>;
export type PCAResultValidated = z.infer<typeof PCAResultSchema>;
export type UMAPResultValidated = z.infer<typeof UMAPResultSchema>;
export type MetricsResultValidated = z.infer<typeof MetricsResultSchema>;

/**
 * useOperatorRegistry - Hook for fetching operators from backend
 *
 * Provides access to all available preprocessing and splitting operators
 * with their metadata, parameters, and categories.
 */

import { useQuery } from '@tanstack/react-query';
import { getPlaygroundOperators, getPlaygroundPresets } from '@/api/playground';
import type {
  OperatorsResponse,
  OperatorDefinition,
  PresetsResponse,
  Preset,
} from '@/types/playground';

/**
 * Options for useOperatorRegistry
 */
export interface UseOperatorRegistryOptions {
  /** Whether to fetch operators (default: true) */
  enabled?: boolean;
}

/**
 * Return type for useOperatorRegistry
 */
export interface UseOperatorRegistryResult {
  /** All preprocessing operators */
  preprocessing: OperatorDefinition[];
  /** Preprocessing operators grouped by category */
  preprocessingByCategory: Record<string, OperatorDefinition[]>;
  /** All augmentation operators */
  augmentation: OperatorDefinition[];
  /** Augmentation operators grouped by category */
  augmentationByCategory: Record<string, OperatorDefinition[]>;
  /** All splitting operators */
  splitting: OperatorDefinition[];
  /** Splitting operators grouped by category */
  splittingByCategory: Record<string, OperatorDefinition[]>;
  /** All filter operators */
  filter: OperatorDefinition[];
  /** Filter operators grouped by category */
  filterByCategory: Record<string, OperatorDefinition[]>;
  /** All operators combined */
  allOperators: OperatorDefinition[];
  /** Total count */
  total: number;
  /** Whether data is loading */
  isLoading: boolean;
  /** Whether there was an error */
  isError: boolean;
  /** Error if any */
  error: Error | null;
  /** Get operator by name */
  getOperator: (name: string) => OperatorDefinition | undefined;
}

/**
 * Hook to fetch and access operator definitions from the backend
 *
 * @param options - Query options
 * @returns Operator registry with all available operators
 */
export function useOperatorRegistry(
  options: UseOperatorRegistryOptions = {}
): UseOperatorRegistryResult {
  const { enabled = true } = options;

  const query = useQuery<OperatorsResponse>({
    queryKey: ['playground', 'operators'],
    queryFn: getPlaygroundOperators,
    enabled,
    staleTime: 10 * 60 * 1000, // 10 minutes
    gcTime: 30 * 60 * 1000, // 30 minutes
    refetchOnWindowFocus: false,
  });

  const data = query.data;

  // Combine all operators for lookup
  const allOperators = [
    ...(data?.preprocessing ?? []),
    ...(data?.augmentation ?? []),
    ...(data?.splitting ?? []),
    ...(data?.filter ?? []),
  ];

  // Create lookup function
  const getOperator = (name: string): OperatorDefinition | undefined => {
    return allOperators.find(
      op => op.name.toLowerCase() === name.toLowerCase()
    );
  };

  return {
    preprocessing: data?.preprocessing ?? [],
    preprocessingByCategory: data?.preprocessing_by_category ?? {},
    augmentation: data?.augmentation ?? [],
    augmentationByCategory: data?.augmentation_by_category ?? {},
    splitting: data?.splitting ?? [],
    splittingByCategory: data?.splitting_by_category ?? {},
    filter: data?.filter ?? [],
    filterByCategory: data?.filter_by_category ?? {},
    allOperators,
    total: data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    getOperator,
  };
}

/**
 * Return type for usePresets
 */
export interface UsePresetsResult {
  /** All presets */
  presets: Preset[];
  /** Presets grouped by category */
  presetsByCategory: Record<string, Preset[]>;
  /** Whether data is loading */
  isLoading: boolean;
  /** Whether there was an error */
  isError: boolean;
  /** Error if any */
  error: Error | null;
  /** Get preset by ID */
  getPreset: (id: string) => Preset | undefined;
}

/**
 * Hook to fetch preset pipeline configurations
 *
 * @returns Presets with common pipeline configurations
 */
export function usePresets(): UsePresetsResult {
  const query = useQuery<PresetsResponse>({
    queryKey: ['playground', 'presets'],
    queryFn: getPlaygroundPresets,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const presets = query.data?.presets ?? [];

  // Group by category
  const presetsByCategory = presets.reduce((acc, preset) => {
    const category = preset.category || 'other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(preset);
    return acc;
  }, {} as Record<string, Preset[]>);

  const getPreset = (id: string): Preset | undefined => {
    return presets.find(p => p.id === id);
  };

  return {
    presets,
    presetsByCategory,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error as Error | null,
    getPreset,
  };
}

/**
 * Display category labels for the UI
 */
export const PREPROCESSING_CATEGORY_LABELS: Record<string, string> = {
  scatter_correction: 'Scatter Correction',
  derivative: 'Derivatives',
  smoothing: 'Smoothing',
  baseline: 'Baseline',
  scaling: 'Scaling',
  wavelet: 'Wavelets',
  conversion: 'Conversion',
  features: 'Features',
  other: 'Other',
};

export const AUGMENTATION_CATEGORY_LABELS: Record<string, string> = {
  noise: 'Noise',
  baseline_drift: 'Baseline Drift',
  wavelength_distortion: 'Wavelength Distortion',
  resolution: 'Resolution & Smoothing',
  masking: 'Masking & Dropout',
  artefacts: 'Artefacts',
  mixing: 'Sample Mixing',
  scatter_simulation: 'Scatter Simulation',
  geometric: 'Geometric',
  other: 'Other',
};

export const SPLITTING_CATEGORY_LABELS: Record<string, string> = {
  kfold: 'K-Fold',
  stratified: 'Stratified',
  shuffle: 'Shuffle Split',
  grouped: 'Grouped',
  distance: 'Distance-Based',
  other: 'Other',
};

export const FILTER_CATEGORY_LABELS: Record<string, string> = {
  outlier: 'Outlier Detection',
  range: 'Range Filtering',
  metadata: 'Metadata Filtering',
  quality: 'Quality Control',
  distance: 'Distance-Based',
  other: 'Other',
};

/**
 * Get a human-readable label for a category
 */
export function getCategoryLabel(category: string, type: 'preprocessing' | 'augmentation' | 'splitting' | 'filter'): string {
  if (type === 'splitting') {
    return SPLITTING_CATEGORY_LABELS[category] || category;
  }
  if (type === 'augmentation') {
    return AUGMENTATION_CATEGORY_LABELS[category] || category;
  }
  if (type === 'filter') {
    return FILTER_CATEGORY_LABELS[category] || category;
  }
  return PREPROCESSING_CATEGORY_LABELS[category] || category;
}

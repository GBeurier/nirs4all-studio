/**
 * Reference Dataset Types and Utilities
 *
 * Phase 6: Dataset Reference Mode
 *
 * Enables comparison between two different datasets:
 * - Primary dataset (the currently loaded dataset)
 * - Reference dataset (another dataset for comparison)
 *
 * Use cases:
 * - Calibration transfer: Compare spectra from two instruments
 * - Batch effects: Compare acquisitions from different dates
 * - Quality control: Compare new batch against reference batch
 * - Before/After: Compare samples before and after treatment
 */

import type { SpectralData } from '@/types/spectral';
import type { PlaygroundResult } from '@/types/playground';

// ============= Types =============

/**
 * Reference mode type - either comparing pipeline steps or datasets
 */
export type ReferenceMode = 'step' | 'dataset';

/**
 * Sample alignment strategy when comparing datasets with different sample counts
 */
export type AlignmentMode = 'index' | 'id_column' | 'none';

/**
 * Reference dataset info (similar to WorkspaceDatasetInfo)
 */
export interface ReferenceDatasetInfo {
  datasetId: string;
  datasetName: string;
}

/**
 * Dataset compatibility check result
 */
export interface DatasetCompatibility {
  compatible: boolean;
  warnings: string[];
  featureCountMatch: boolean;
  wavelengthMatch: boolean;
  sampleCountDiff: number;
}

/**
 * Alignment result for matching samples between datasets
 */
export interface AlignmentResult {
  primaryIndices: number[];
  referenceIndices: number[];
  unmatchedPrimary: number[];
  unmatchedReference: number[];
  warnings: string[];
}

/**
 * Reference dataset state
 */
export interface ReferenceDatasetState {
  /** Current reference mode */
  mode: ReferenceMode;
  /** Reference dataset info (when mode is 'dataset') */
  referenceInfo: ReferenceDatasetInfo | null;
  /** Raw reference data */
  referenceData: SpectralData | null;
  /** Processed reference result */
  referenceResult: PlaygroundResult | null;
  /** Whether reference dataset is loading */
  isLoading: boolean;
  /** Error message if loading failed */
  error: string | null;
  /** Compatibility check result */
  compatibility: DatasetCompatibility | null;
  /** Alignment mode for sample matching */
  alignmentMode: AlignmentMode;
  /** Alignment result */
  alignment: AlignmentResult | null;
}

// ============= Utilities =============

/**
 * Check if two datasets are compatible for comparison
 *
 * Datasets must have the same number of features (wavelengths) to be comparable.
 * Warnings are generated for wavelength value mismatches or sample count differences.
 */
export function checkDatasetCompatibility(
  primary: SpectralData,
  reference: SpectralData
): DatasetCompatibility {
  const warnings: string[] = [];

  // Required: same number of features
  const featureCountMatch = primary.wavelengths.length === reference.wavelengths.length;
  if (!featureCountMatch) {
    return {
      compatible: false,
      warnings: [
        `Feature count mismatch: primary has ${primary.wavelengths.length} features, reference has ${reference.wavelengths.length}`,
      ],
      featureCountMatch: false,
      wavelengthMatch: false,
      sampleCountDiff: Math.abs(primary.spectra.length - reference.spectra.length),
    };
  }

  // Warning: wavelength values mismatch
  let wavelengthMatch = true;
  const wavelengthTolerance = 0.1; // nm
  for (let i = 0; i < primary.wavelengths.length; i++) {
    if (Math.abs(primary.wavelengths[i] - reference.wavelengths[i]) > wavelengthTolerance) {
      wavelengthMatch = false;
      break;
    }
  }
  if (!wavelengthMatch) {
    warnings.push('Wavelength values differ between datasets - spectra may not align correctly');
  }

  // Warning: sample count difference
  const sampleCountDiff = Math.abs(primary.spectra.length - reference.spectra.length);
  if (sampleCountDiff > 0) {
    warnings.push(
      `Sample count differs: primary has ${primary.spectra.length}, reference has ${reference.spectra.length}`
    );
  }

  return {
    compatible: true,
    warnings,
    featureCountMatch,
    wavelengthMatch,
    sampleCountDiff,
  };
}

/**
 * Align samples between two datasets
 *
 * @param primary - Primary dataset
 * @param reference - Reference dataset
 * @param mode - Alignment mode ('index', 'id_column', 'none')
 * @param idColumn - Column name for ID-based alignment
 * @returns Alignment result with matched and unmatched indices
 */
export function alignDatasets(
  primary: SpectralData,
  reference: SpectralData,
  mode: AlignmentMode,
  _idColumn?: string
): AlignmentResult {
  const warnings: string[] = [];

  switch (mode) {
    case 'index': {
      // Simple 1:1 by position (truncate longer dataset)
      const minLength = Math.min(primary.spectra.length, reference.spectra.length);
      const primaryIndices = Array.from({ length: minLength }, (_, i) => i);
      const referenceIndices = Array.from({ length: minLength }, (_, i) => i);

      const unmatchedPrimary = primary.spectra.length > minLength
        ? Array.from({ length: primary.spectra.length - minLength }, (_, i) => minLength + i)
        : [];
      const unmatchedReference = reference.spectra.length > minLength
        ? Array.from({ length: reference.spectra.length - minLength }, (_, i) => minLength + i)
        : [];

      if (unmatchedPrimary.length > 0 || unmatchedReference.length > 0) {
        warnings.push(
          `${unmatchedPrimary.length + unmatchedReference.length} samples unmatched due to count difference`
        );
      }

      return { primaryIndices, referenceIndices, unmatchedPrimary, unmatchedReference, warnings };
    }

    case 'id_column': {
      // Match by sample ID
      // For now, use sampleIds if available, otherwise fall back to index
      if (!primary.sampleIds || !reference.sampleIds) {
        warnings.push('Sample IDs not available, falling back to index alignment');
        return alignDatasets(primary, reference, 'index');
      }

      const refIdMap = new Map<string, number>();
      reference.sampleIds.forEach((id, idx) => refIdMap.set(id, idx));

      const primaryIndices: number[] = [];
      const referenceIndices: number[] = [];
      const unmatchedPrimary: number[] = [];

      primary.sampleIds.forEach((id, idx) => {
        const refIdx = refIdMap.get(id);
        if (refIdx !== undefined) {
          primaryIndices.push(idx);
          referenceIndices.push(refIdx);
          refIdMap.delete(id); // Mark as matched
        } else {
          unmatchedPrimary.push(idx);
        }
      });

      const unmatchedReference = Array.from(refIdMap.values());

      if (unmatchedPrimary.length > 0 || unmatchedReference.length > 0) {
        warnings.push(
          `${unmatchedPrimary.length} primary and ${unmatchedReference.length} reference samples unmatched`
        );
      }

      return { primaryIndices, referenceIndices, unmatchedPrimary, unmatchedReference, warnings };
    }

    case 'none':
    default:
      // No alignment - show all samples from both datasets
      return {
        primaryIndices: Array.from({ length: primary.spectra.length }, (_, i) => i),
        referenceIndices: Array.from({ length: reference.spectra.length }, (_, i) => i),
        unmatchedPrimary: [],
        unmatchedReference: [],
        warnings: [],
      };
  }
}

/**
 * Default reference dataset state
 */
export const DEFAULT_REFERENCE_STATE: ReferenceDatasetState = {
  mode: 'step',
  referenceInfo: null,
  referenceData: null,
  referenceResult: null,
  isLoading: false,
  error: null,
  compatibility: null,
  alignmentMode: 'index',
  alignment: null,
};

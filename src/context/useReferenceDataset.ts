import { createContext, useContext } from 'react';

import type { SpectralData } from '@/types/spectral';
import type {
  ReferenceMode,
  ReferenceDatasetInfo,
  ReferenceDatasetState,
  AlignmentMode,
  DatasetCompatibility,
  AlignmentResult,
} from '@/lib/playground/referenceDataset';

export interface ReferenceDatasetContextValue extends ReferenceDatasetState {
  /** Set reference mode (step or dataset) */
  setReferenceMode: (mode: ReferenceMode) => void;
  /** Load a reference dataset from workspace */
  loadReferenceDataset: (datasetId: string, datasetName: string) => Promise<void>;
  /** Clear the reference dataset */
  clearReferenceDataset: () => void;
  /** Set alignment mode */
  setAlignmentMode: (mode: AlignmentMode) => void;
  /** Check compatibility with primary dataset */
  checkCompatibility: (primary: SpectralData) => DatasetCompatibility | null;
  /** Compute alignment with primary dataset */
  computeAlignment: (primary: SpectralData) => AlignmentResult | null;
  /** Whether reference mode is active (mode='dataset' and data loaded) */
  isReferenceActive: boolean;
  /** Whether reference dataset is being processed */
  isProcessing: boolean;
}

export const ReferenceDatasetContext = createContext<ReferenceDatasetContextValue | null>(null);

/**
 * Hook to access reference dataset context
 * @throws Error if used outside of ReferenceDatasetProvider
 */
export function useReferenceDataset(): ReferenceDatasetContextValue {
  const context = useContext(ReferenceDatasetContext);
  if (!context) {
    throw new Error('useReferenceDataset must be used within a ReferenceDatasetProvider');
  }
  return context;
}

/**
 * Hook to optionally access reference dataset context
 * Returns null if not within ReferenceDatasetProvider
 */
export function useReferenceDatasetOptional(): ReferenceDatasetContextValue | null {
  return useContext(ReferenceDatasetContext);
}

export type {
  ReferenceMode,
  ReferenceDatasetInfo,
  ReferenceDatasetState,
  AlignmentMode,
  DatasetCompatibility,
  AlignmentResult,
};

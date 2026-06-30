import { createContext, useContext } from 'react';

export interface OutliersState {
  /** User-marked outlier indices */
  manualOutliers: Set<number>;
  /** Algorithm-detected outlier indices (from outlier detection) */
  detectedOutliers: Set<number>;
}

export type OutliersAction =
  | { type: 'MARK_OUTLIERS'; indices: number[] }
  | { type: 'UNMARK_OUTLIERS'; indices: number[] }
  | { type: 'TOGGLE_OUTLIERS'; indices: number[] }
  | { type: 'CLEAR_MANUAL' }
  | { type: 'SET_DETECTED'; indices: number[] }
  | { type: 'CLEAR_DETECTED' }
  | { type: 'RESTORE'; state: Partial<OutliersState> };

export interface OutliersContextValue extends OutliersState {
  // Manual outlier operations
  markAsOutliers: (indices: number[]) => void;
  unmarkAsOutliers: (indices: number[]) => void;
  toggleOutliers: (indices: number[]) => void;
  clearManualOutliers: () => void;
  isManualOutlier: (index: number) => boolean;

  // Detected outlier operations
  setDetectedOutliers: (indices: number[]) => void;
  clearDetectedOutliers: () => void;
  isDetectedOutlier: (index: number) => boolean;

  // Combined
  /** All outliers (manual + detected) */
  allOutliers: Set<number>;
  isOutlier: (index: number) => boolean;

  // Counts
  manualCount: number;
  detectedCount: number;
  totalOutlierCount: number;
  hasManualOutliers: boolean;
  hasDetectedOutliers: boolean;
  hasOutliers: boolean;
}

export const OutliersContext = createContext<OutliersContextValue | null>(null);

export function useOutliers(): OutliersContextValue {
  const context = useContext(OutliersContext);
  if (!context) {
    throw new Error('useOutliers must be used within an OutliersProvider');
  }
  return context;
}

export function useOutliersOptional(): OutliersContextValue | null {
  return useContext(OutliersContext);
}

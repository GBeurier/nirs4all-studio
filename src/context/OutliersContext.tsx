/**
 * OutliersContext - User-marked outliers management
 *
 * Phase 8: Global Actions & Export Enhancements
 *
 * Features:
 * - Store user-marked outliers (via Ctrl+O shortcut)
 * - Combine with algorithm-detected outliers
 * - Provide unified outlier indices for export
 * - Session persistence
 */

import {
  createContext,
  useContext,
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';

// ============= Types =============

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

// ============= Constants =============

const STORAGE_KEY = 'playground-outliers-state';

// ============= Initial State =============

const createInitialState = (): OutliersState => ({
  manualOutliers: new Set<number>(),
  detectedOutliers: new Set<number>(),
});

// ============= Reducer =============

function outliersReducer(state: OutliersState, action: OutliersAction): OutliersState {
  switch (action.type) {
    case 'MARK_OUTLIERS': {
      const newManual = new Set([...state.manualOutliers, ...action.indices]);
      return { ...state, manualOutliers: newManual };
    }

    case 'UNMARK_OUTLIERS': {
      const newManual = new Set(state.manualOutliers);
      action.indices.forEach(i => newManual.delete(i));
      return { ...state, manualOutliers: newManual };
    }

    case 'TOGGLE_OUTLIERS': {
      const newManual = new Set(state.manualOutliers);
      action.indices.forEach(i => {
        if (newManual.has(i)) {
          newManual.delete(i);
        } else {
          newManual.add(i);
        }
      });
      return { ...state, manualOutliers: newManual };
    }

    case 'CLEAR_MANUAL':
      return { ...state, manualOutliers: new Set() };

    case 'SET_DETECTED':
      return { ...state, detectedOutliers: new Set(action.indices) };

    case 'CLEAR_DETECTED':
      return { ...state, detectedOutliers: new Set() };

    case 'RESTORE': {
      return {
        ...state,
        manualOutliers: action.state.manualOutliers
          ? new Set(action.state.manualOutliers)
          : state.manualOutliers,
        detectedOutliers: action.state.detectedOutliers
          ? new Set(action.state.detectedOutliers)
          : state.detectedOutliers,
      };
    }

    default:
      return state;
  }
}

// ============= Context =============

const OutliersContext = createContext<OutliersContextValue | null>(null);

// ============= Storage Helpers =============

interface SerializedOutliersState {
  manualOutliers: number[];
}

function persistState(state: OutliersState): void {
  try {
    const serialized: SerializedOutliersState = {
      manualOutliers: Array.from(state.manualOutliers),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch (e) {
    console.warn('Failed to persist outliers state:', e);
  }
}

function loadPersistedState(): Partial<OutliersState> | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed: SerializedOutliersState = JSON.parse(stored);
      return {
        manualOutliers: new Set(parsed.manualOutliers || []),
      };
    }
  } catch (e) {
    console.warn('Failed to load persisted outliers state:', e);
  }
  return null;
}

// ============= Provider =============

export interface OutliersProviderProps {
  children: ReactNode;
  /** Initial detected outliers (from algorithm) */
  initialDetectedOutliers?: number[];
}

export function OutliersProvider({
  children,
  initialDetectedOutliers,
}: OutliersProviderProps) {
  const [state, dispatch] = useReducer(outliersReducer, null, () => {
    const initial = createInitialState();
    const persisted = loadPersistedState();
    const merged = persisted ? { ...initial, ...persisted } : initial;

    // Set initial detected outliers if provided
    if (initialDetectedOutliers) {
      merged.detectedOutliers = new Set(initialDetectedOutliers);
    }

    return merged;
  });

  // Persist manual outliers on change
  useEffect(() => {
    const timeout = setTimeout(() => {
      persistState(state);
    }, 100);
    return () => clearTimeout(timeout);
  }, [state.manualOutliers]);

  // ============= Actions =============

  const markAsOutliers = useCallback((indices: number[]) => {
    dispatch({ type: 'MARK_OUTLIERS', indices });
  }, []);

  const unmarkAsOutliers = useCallback((indices: number[]) => {
    dispatch({ type: 'UNMARK_OUTLIERS', indices });
  }, []);

  const toggleOutliers = useCallback((indices: number[]) => {
    dispatch({ type: 'TOGGLE_OUTLIERS', indices });
  }, []);

  const clearManualOutliers = useCallback(() => {
    dispatch({ type: 'CLEAR_MANUAL' });
  }, []);

  const setDetectedOutliers = useCallback((indices: number[]) => {
    dispatch({ type: 'SET_DETECTED', indices });
  }, []);

  const clearDetectedOutliers = useCallback(() => {
    dispatch({ type: 'CLEAR_DETECTED' });
  }, []);

  // ============= Derived Values =============

  const isManualOutlier = useCallback(
    (index: number) => state.manualOutliers.has(index),
    [state.manualOutliers]
  );

  const isDetectedOutlier = useCallback(
    (index: number) => state.detectedOutliers.has(index),
    [state.detectedOutliers]
  );

  const allOutliers = useMemo(
    () => new Set([...state.manualOutliers, ...state.detectedOutliers]),
    [state.manualOutliers, state.detectedOutliers]
  );

  const isOutlier = useCallback(
    (index: number) => allOutliers.has(index),
    [allOutliers]
  );

  const manualCount = state.manualOutliers.size;
  const detectedCount = state.detectedOutliers.size;
  const totalOutlierCount = allOutliers.size;
  const hasManualOutliers = manualCount > 0;
  const hasDetectedOutliers = detectedCount > 0;
  const hasOutliers = totalOutlierCount > 0;

  // ============= Context Value =============

  const value = useMemo<OutliersContextValue>(() => ({
    // State
    manualOutliers: state.manualOutliers,
    detectedOutliers: state.detectedOutliers,

    // Manual operations
    markAsOutliers,
    unmarkAsOutliers,
    toggleOutliers,
    clearManualOutliers,
    isManualOutlier,

    // Detected operations
    setDetectedOutliers,
    clearDetectedOutliers,
    isDetectedOutlier,

    // Combined
    allOutliers,
    isOutlier,

    // Counts
    manualCount,
    detectedCount,
    totalOutlierCount,
    hasManualOutliers,
    hasDetectedOutliers,
    hasOutliers,
  }), [
    state.manualOutliers,
    state.detectedOutliers,
    markAsOutliers,
    unmarkAsOutliers,
    toggleOutliers,
    clearManualOutliers,
    isManualOutlier,
    setDetectedOutliers,
    clearDetectedOutliers,
    isDetectedOutlier,
    allOutliers,
    isOutlier,
    manualCount,
    detectedCount,
    totalOutlierCount,
    hasManualOutliers,
    hasDetectedOutliers,
    hasOutliers,
  ]);

  return (
    <OutliersContext.Provider value={value}>
      {children}
    </OutliersContext.Provider>
  );
}

// ============= Hooks =============

/**
 * Hook to access outliers context (throws if not within provider)
 */
export function useOutliers(): OutliersContextValue {
  const context = useContext(OutliersContext);
  if (!context) {
    throw new Error('useOutliers must be used within an OutliersProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider
 */
export function useOutliersOptional(): OutliersContextValue | null {
  return useContext(OutliersContext);
}

export default OutliersProvider;

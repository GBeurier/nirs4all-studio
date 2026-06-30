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
  useReducer,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from 'react';
import {
  OutliersContext,
  type OutliersAction,
  type OutliersContextValue,
  type OutliersState,
} from '@/context/useOutliers';
import {
  clientStorageKeys,
  readClientStorageJson,
  writeClientStorageJson,
} from '@/lib/clientStorage';

// ============= Constants =============

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

// ============= Storage Helpers =============

interface SerializedOutliersState {
  manualOutliers: number[];
}

function persistManualOutliers(manualOutliers: Set<number>): void {
  const serialized: SerializedOutliersState = {
    manualOutliers: Array.from(manualOutliers),
  };
  writeClientStorageJson(clientStorageKeys.playgroundOutliersState, serialized, {
    onError: (e) => {
      console.warn('Failed to persist outliers state:', e);
    },
  });
}

function loadPersistedState(): Partial<OutliersState> | null {
  const parsed = readClientStorageJson<SerializedOutliersState>(clientStorageKeys.playgroundOutliersState, {
    onError: (e) => {
      console.warn('Failed to load persisted outliers state:', e);
    },
  });
  if (parsed) {
    return {
      manualOutliers: new Set(parsed.manualOutliers || []),
    };
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

  // Persist manual outliers on change - 500ms to reduce GC pressure in Firefox
  useEffect(() => {
    const timeout = setTimeout(() => {
      persistManualOutliers(state.manualOutliers);
    }, 500);
    return () => clearTimeout(timeout);
  }, [state.manualOutliers]);

  // The prop is not initialize-once: keep detectedOutliers in sync when the
  // parent passes a new detection result after mount (FE-09-state).
  useEffect(() => {
    if (initialDetectedOutliers) {
      dispatch({ type: 'SET_DETECTED', indices: initialDetectedOutliers });
    }
  }, [initialDetectedOutliers]);

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

export default OutliersProvider;

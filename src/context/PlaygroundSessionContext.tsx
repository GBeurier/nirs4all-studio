/**
 * PlaygroundSessionContext - Session persistence for Playground state
 *
 * Persists playground state to sessionStorage so users can navigate away
 * and return to their previous view with:
 * - Loaded dataset (datasetId, datasetName)
 * - Pipeline operators
 * - View preferences (chart visibility, render mode)
 */

import {
  createContext,
  useContext,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import type { UnifiedOperator } from '@/types/playground';
import type { RenderMode } from '@/lib/playground/renderOptimizer';

// ============= Types =============

export interface ChartVisibility {
  spectra: boolean;
  histogram: boolean;
  pca: boolean;
  folds: boolean;
  repetitions: boolean;
}

export interface SerializedOperator {
  id: string;
  name: string;
  type: 'preprocessing' | 'splitting' | 'filter';
  params: Record<string, unknown>;
  enabled: boolean;
}

export interface PlaygroundSessionState {
  // Dataset
  datasetId: string | null;
  datasetName: string | null;
  dataSource: 'workspace' | 'demo' | null;

  // Pipeline (serialized operators)
  operators: SerializedOperator[];

  // View preferences
  chartVisibility: ChartVisibility;
  renderMode: RenderMode;

  // Step comparison
  stepComparisonEnabled: boolean;
  activeStep: number;

  // Timestamp
  savedAt: number;
}

export interface PlaygroundSessionContextValue {
  /** Get the current session state from storage */
  getSession: () => PlaygroundSessionState | null;

  /** Save current session state */
  saveSession: (state: Partial<PlaygroundSessionState>) => void;

  /** Clear the session */
  clearSession: () => void;

  /** Check if there's a saved session */
  hasSession: boolean;
}

// ============= Constants =============

const STORAGE_KEY = 'playground-session-state';
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ============= Default State =============

const DEFAULT_CHART_VISIBILITY: ChartVisibility = {
  spectra: true,
  histogram: true,
  pca: true,
  folds: true,
  repetitions: false,
};

// ============= Context =============

const PlaygroundSessionContext = createContext<PlaygroundSessionContextValue | null>(null);

// ============= Storage Helpers =============

function loadSession(): PlaygroundSessionState | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const parsed: PlaygroundSessionState = JSON.parse(stored);

    // Check if session is too old
    if (Date.now() - parsed.savedAt > SESSION_MAX_AGE_MS) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch (e) {
    console.warn('Failed to load playground session:', e);
    return null;
  }
}

function persistSession(state: PlaygroundSessionState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist playground session:', e);
  }
}

// ============= Serialization Helpers =============

export function serializeOperators(operators: UnifiedOperator[]): SerializedOperator[] {
  return operators.map(op => ({
    id: op.id,
    name: op.name,
    type: op.type,
    params: op.params,
    enabled: op.enabled,
  }));
}

// ============= Provider =============

export interface PlaygroundSessionProviderProps {
  children: ReactNode;
}

export function PlaygroundSessionProvider({ children }: PlaygroundSessionProviderProps) {
  const sessionRef = useRef<PlaygroundSessionState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize from storage
  useEffect(() => {
    sessionRef.current = loadSession();
  }, []);

  const getSession = useCallback((): PlaygroundSessionState | null => {
    // Return cached value or reload from storage
    if (!sessionRef.current) {
      sessionRef.current = loadSession();
    }
    return sessionRef.current;
  }, []);

  const saveSession = useCallback((state: Partial<PlaygroundSessionState>) => {
    // Merge with existing state
    const current = sessionRef.current || {
      datasetId: null,
      datasetName: null,
      dataSource: null,
      operators: [],
      chartVisibility: DEFAULT_CHART_VISIBILITY,
      renderMode: 'auto' as RenderMode,
      stepComparisonEnabled: false,
      activeStep: 0,
      savedAt: Date.now(),
    };

    const newState: PlaygroundSessionState = {
      ...current,
      ...state,
      savedAt: Date.now(),
    };

    sessionRef.current = newState;

    // Debounced persist to storage
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      persistSession(newState);
    }, 500);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    sessionStorage.removeItem(STORAGE_KEY);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  const hasSession = useMemo(() => {
    return loadSession() !== null;
  }, []);

  const value = useMemo<PlaygroundSessionContextValue>(() => ({
    getSession,
    saveSession,
    clearSession,
    hasSession,
  }), [getSession, saveSession, clearSession, hasSession]);

  return (
    <PlaygroundSessionContext.Provider value={value}>
      {children}
    </PlaygroundSessionContext.Provider>
  );
}

// ============= Hooks =============

/**
 * Hook to access playground session context
 */
export function usePlaygroundSession(): PlaygroundSessionContextValue {
  const context = useContext(PlaygroundSessionContext);
  if (!context) {
    throw new Error('usePlaygroundSession must be used within a PlaygroundSessionProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider
 */
export function usePlaygroundSessionOptional(): PlaygroundSessionContextValue | null {
  return useContext(PlaygroundSessionContext);
}

export default PlaygroundSessionProvider;

/**
 * PlaygroundSessionContext - Session persistence for Playground state
 *
 * Persists playground state to session-scoped client storage so users can navigate away
 * and return to their previous view with:
 * - Loaded dataset (datasetId, datasetName)
 * - View preferences (chart visibility, render mode)
 */

import {
  useCallback,
  useMemo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearPlaygroundSessionState,
  mergePlaygroundSessionState,
  readPlaygroundSessionState,
  type PlaygroundSessionStorage,
  writePlaygroundSessionState,
} from '@/lib/playground/sessionState';
import {
  clientStorageKeys,
  createClientStoragePersistenceStorage,
} from '@/lib/clientStorage';
import {
  PlaygroundSessionContext,
  type PlaygroundSessionContextValue,
  type PlaygroundSessionState,
} from './PlaygroundSessionContextCore';

export type {
  ChartVisibility,
  PlaygroundSessionContextValue,
  PlaygroundSessionState,
} from './PlaygroundSessionContextCore';

// ============= Provider =============

export interface PlaygroundSessionProviderProps {
  children: ReactNode;
}

const playgroundSessionStorage: PlaygroundSessionStorage = {
  ...createClientStoragePersistenceStorage(clientStorageKeys.playgroundSessionState),
};

export function PlaygroundSessionProvider({ children }: PlaygroundSessionProviderProps) {
  const sessionRef = useRef<PlaygroundSessionState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize from storage
  useEffect(() => {
    sessionRef.current = readPlaygroundSessionState(playgroundSessionStorage, {
      onError: error => console.warn('Failed to load playground session:', error),
    });
  }, []);

  const getSession = useCallback((): PlaygroundSessionState | null => {
    // Return cached value or reload from storage
    if (!sessionRef.current) {
      sessionRef.current = readPlaygroundSessionState(playgroundSessionStorage, {
        onError: error => console.warn('Failed to load playground session:', error),
      });
    }
    return sessionRef.current;
  }, []);

  const saveSession = useCallback((state: Partial<PlaygroundSessionState>) => {
    const newState = mergePlaygroundSessionState(sessionRef.current, state);
    sessionRef.current = newState;
    setHasSession(true);

    // Debounced persist to storage
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      writePlaygroundSessionState(playgroundSessionStorage, newState, {
        onError: error => console.warn('Failed to persist playground session:', error),
      });
    }, 500);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setHasSession(false);
    clearPlaygroundSessionState(playgroundSessionStorage);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  // State (not a render-time storage read): updated by save/clear so
  // consumers see session lifecycle changes (FE-10-state).
  const [hasSession, setHasSession] = useState<boolean>(() => readPlaygroundSessionState(playgroundSessionStorage) !== null);

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

export default PlaygroundSessionProvider;

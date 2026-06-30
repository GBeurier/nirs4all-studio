/**
 * InspectorSessionContext — Session persistence for Inspector state.
 *
 * Persists inspector state to sessionStorage so users can navigate away
 * and return to their previous view with:
 * - Source filters (run_id, dataset_name, model_class)
 * - Group configuration (mode, groupBy, rangeConfig, topKConfig, expressionConfig)
 * - Score column and partition
 * - Panel visibility and layout mode
 *
 * Note: Color config and selection state are already persisted by their own contexts.
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
  clientStorageKeys,
  createClientStoragePersistenceStorage,
} from '@/lib/clientStorage';
import {
  clearInspectorSessionState,
  mergeInspectorSessionState,
  readInspectorSessionState,
  writeInspectorSessionState,
  type InspectorSessionStorage,
} from '@/lib/inspector/sessionState';
import {
  InspectorSessionContext,
  type InspectorSessionContextValue,
  type InspectorSessionState,
} from '@/context/useInspectorSession';

const inspectorSessionStorage: InspectorSessionStorage = createClientStoragePersistenceStorage(
  clientStorageKeys.inspectorSessionState,
);

// ============= Provider =============

export function InspectorSessionProvider({ children }: { children: ReactNode }) {
  const sessionRef = useRef<InspectorSessionState | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    sessionRef.current = readInspectorSessionState(inspectorSessionStorage);
  }, []);

  const getSession = useCallback((): InspectorSessionState | null => {
    if (!sessionRef.current) {
      sessionRef.current = readInspectorSessionState(inspectorSessionStorage);
    }
    return sessionRef.current;
  }, []);

  const saveSession = useCallback((state: Partial<InspectorSessionState>) => {
    const newState = mergeInspectorSessionState(sessionRef.current, state);
    sessionRef.current = newState;
    setHasSession(true);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      writeInspectorSessionState(inspectorSessionStorage, newState);
    }, 500);
  }, []);

  const clearSession = useCallback(() => {
    sessionRef.current = null;
    setHasSession(false);
    clearInspectorSessionState(inspectorSessionStorage);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
  }, []);

  // State (not a render-time storage read): updated by save/clear so
  // consumers see session lifecycle changes (FE-10-state).
  const [hasSession, setHasSession] = useState<boolean>(() => readInspectorSessionState(inspectorSessionStorage) !== null);

  const value = useMemo<InspectorSessionContextValue>(() => ({
    getSession,
    saveSession,
    clearSession,
    hasSession,
  }), [getSession, saveSession, clearSession, hasSession]);

  return (
    <InspectorSessionContext.Provider value={value}>
      {children}
    </InspectorSessionContext.Provider>
  );
}

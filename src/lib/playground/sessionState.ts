import type { RenderMode } from '@/lib/playground/renderOptimizer';
import {
  clearSessionState,
  DEFAULT_SESSION_MAX_AGE_MS,
  readSessionState,
  writeSessionState,
  type SessionPersistenceStorage,
} from '@/lib/sessionPersistence';

export interface ChartVisibility {
  spectra: boolean;
  histogram: boolean;
  pca: boolean;
  folds: boolean;
  repetitions: boolean;
}

export interface PlaygroundSessionState {
  datasetId: string | null;
  datasetName: string | null;
  dataSource: 'workspace' | 'demo' | null;
  chartVisibility: ChartVisibility;
  renderMode: RenderMode;
  savedAt: number;
}

export interface PlaygroundSessionContextValue {
  getSession: () => PlaygroundSessionState | null;
  saveSession: (state: Partial<PlaygroundSessionState>) => void;
  clearSession: () => void;
  hasSession: boolean;
}

export type PlaygroundSessionStorage = SessionPersistenceStorage;

export const PLAYGROUND_SESSION_STORAGE_KEY = 'playground-session-state';
export const PLAYGROUND_SESSION_MAX_AGE_MS = DEFAULT_SESSION_MAX_AGE_MS;

export const DEFAULT_CHART_VISIBILITY: ChartVisibility = {
  spectra: true,
  histogram: true,
  pca: true,
  folds: true,
  repetitions: false,
};

export function createDefaultPlaygroundSessionState(now = Date.now()): PlaygroundSessionState {
  return {
    datasetId: null,
    datasetName: null,
    dataSource: null,
    chartVisibility: DEFAULT_CHART_VISIBILITY,
    renderMode: 'auto',
    savedAt: now,
  };
}

export function mergePlaygroundSessionState(
  current: PlaygroundSessionState | null | undefined,
  update: Partial<PlaygroundSessionState>,
  now = Date.now(),
): PlaygroundSessionState {
  return {
    ...(current ?? createDefaultPlaygroundSessionState(now)),
    ...update,
    savedAt: now,
  };
}

export function readPlaygroundSessionState(
  storage: PlaygroundSessionStorage,
  {
    maxAgeMs = PLAYGROUND_SESSION_MAX_AGE_MS,
    now = Date.now(),
    onError,
    storageKey = PLAYGROUND_SESSION_STORAGE_KEY,
  }: {
    maxAgeMs?: number;
    now?: number;
    onError?: (error: unknown) => void;
    storageKey?: string;
  } = {},
): PlaygroundSessionState | null {
  return readSessionState<PlaygroundSessionState>(storage, {
    maxAgeMs,
    now,
    onError,
    storageKey,
  });
}

export function writePlaygroundSessionState(
  storage: PlaygroundSessionStorage,
  state: PlaygroundSessionState,
  {
    onError,
    storageKey = PLAYGROUND_SESSION_STORAGE_KEY,
  }: {
    onError?: (error: unknown) => void;
    storageKey?: string;
  } = {},
): void {
  writeSessionState(storage, storageKey, state, onError);
}

export function clearPlaygroundSessionState(
  storage: Pick<PlaygroundSessionStorage, 'removeItem'>,
  storageKey = PLAYGROUND_SESSION_STORAGE_KEY,
): void {
  clearSessionState(storage, storageKey);
}

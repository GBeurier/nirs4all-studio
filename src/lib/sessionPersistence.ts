export interface SessionPersistenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

export interface TimestampedSessionState {
  savedAt: number;
}

export const DEFAULT_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readSessionState<TState extends TimestampedSessionState>(
  storage: SessionPersistenceStorage,
  {
    maxAgeMs = DEFAULT_SESSION_MAX_AGE_MS,
    migrate,
    now = Date.now(),
    onError,
    storageKey,
  }: {
    maxAgeMs?: number;
    migrate?: (state: TState) => TState;
    now?: number;
    onError?: (error: unknown) => void;
    storageKey: string;
  },
): TState | null {
  try {
    const stored = storage.getItem(storageKey);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as TState;
    if (now - parsed.savedAt > maxAgeMs) {
      storage.removeItem(storageKey);
      return null;
    }

    return migrate ? migrate(parsed) : parsed;
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function writeSessionState<TState>(
  storage: SessionPersistenceStorage,
  storageKey: string,
  state: TState,
  onError?: (error: unknown) => void,
): void {
  try {
    storage.setItem(storageKey, JSON.stringify(state));
  } catch (error) {
    onError?.(error);
  }
}

export function clearSessionState(
  storage: Pick<SessionPersistenceStorage, 'removeItem'>,
  storageKey: string,
): void {
  storage.removeItem(storageKey);
}

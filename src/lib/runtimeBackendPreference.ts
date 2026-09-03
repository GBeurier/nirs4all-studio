import { useCallback, useEffect, useState } from "react";

export type RuntimeBackendPreferenceEngine = "legacy" | "dag-ml" | null;

export interface RuntimeBackendPreference {
  engine: RuntimeBackendPreferenceEngine;
  allowFallback: boolean;
}

export const RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY =
  "nirs4all.runtimeBackendPreference";
export const RUNTIME_BACKEND_PREFERENCE_CHANGED_EVENT =
  "nirs4all:runtime-backend-preference-changed";

export const DEFAULT_RUNTIME_BACKEND_PREFERENCE: RuntimeBackendPreference = {
  engine: "dag-ml",
  allowFallback: false,
};

function isRuntimeBackendPreferenceEngine(
  value: unknown,
): value is Exclude<RuntimeBackendPreferenceEngine, null> {
  return value === "legacy" || value === "dag-ml";
}

export function normalizeRuntimeBackendPreference(
  value: Partial<RuntimeBackendPreference> | null | undefined,
): RuntimeBackendPreference {
  const engine = isRuntimeBackendPreferenceEngine(value?.engine)
    ? value.engine
    : null;

  return {
    engine,
    allowFallback: engine === "dag-ml" && value?.allowFallback === true,
  };
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage ?? null;
}

export function getRuntimeBackendPreference(): RuntimeBackendPreference {
  const storage = getLocalStorage();
  if (!storage) {
    return DEFAULT_RUNTIME_BACKEND_PREFERENCE;
  }

  try {
    const raw = storage.getItem(RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_RUNTIME_BACKEND_PREFERENCE;
    }
    return normalizeRuntimeBackendPreference(JSON.parse(raw));
  } catch {
    return DEFAULT_RUNTIME_BACKEND_PREFERENCE;
  }
}

export function setRuntimeBackendPreference(
  preference: Partial<RuntimeBackendPreference> | null | undefined,
): RuntimeBackendPreference {
  const normalized = normalizeRuntimeBackendPreference(preference);
  const storage = getLocalStorage();
  if (storage) {
    storage.setItem(
      RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  }
  return normalized;
}

export function clearRuntimeBackendPreference(): void {
  getLocalStorage()?.removeItem(RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY);
}

type RuntimeBackendPreferenceUpdater =
  | Partial<RuntimeBackendPreference>
  | ((current: RuntimeBackendPreference) => Partial<RuntimeBackendPreference>);

function readPreferenceFromEvent(event: Event): RuntimeBackendPreference | null {
  const detail = (event as CustomEvent<RuntimeBackendPreference>).detail;
  return detail ? normalizeRuntimeBackendPreference(detail) : null;
}

export function useRuntimeBackendPreference() {
  const [preference, setPreferenceState] = useState<RuntimeBackendPreference>(
    getRuntimeBackendPreference,
  );

  const updatePreference = useCallback(
    (next: RuntimeBackendPreferenceUpdater) => {
      setPreferenceState((current) => {
        const raw = typeof next === "function" ? next(current) : next;
        const normalized = setRuntimeBackendPreference(raw);
        window.dispatchEvent(
          new CustomEvent(RUNTIME_BACKEND_PREFERENCE_CHANGED_EVENT, {
            detail: normalized,
          }),
        );
        return normalized;
      });
    },
    [],
  );

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === RUNTIME_BACKEND_PREFERENCE_STORAGE_KEY) {
        setPreferenceState(getRuntimeBackendPreference());
      }
    };

    const handlePreferenceChanged = (event: Event) => {
      const next = readPreferenceFromEvent(event);
      if (next) {
        setPreferenceState(next);
      }
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(
      RUNTIME_BACKEND_PREFERENCE_CHANGED_EVENT,
      handlePreferenceChanged,
    );

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(
        RUNTIME_BACKEND_PREFERENCE_CHANGED_EVENT,
        handlePreferenceChanged,
      );
    };
  }, []);

  const setRuntimeEngine = useCallback(
    (engine: string | null) => {
      updatePreference((current) => ({
        engine: isRuntimeBackendPreferenceEngine(engine) ? engine : null,
        allowFallback:
          engine === "dag-ml" ? current.allowFallback : false,
      }));
    },
    [updatePreference],
  );

  const setAllowFallback = useCallback(
    (allowFallback: boolean) => {
      updatePreference((current) => ({
        engine: current.engine,
        allowFallback,
      }));
    },
    [updatePreference],
  );

  return {
    runtimeEngine: preference.engine,
    allowFallback: preference.allowFallback,
    setRuntimeEngine,
    setAllowFallback,
    setPreference: updatePreference,
  };
}

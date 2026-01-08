import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface PipelineEditorPreferences {
  extendedMode: boolean;
  setExtendedMode: (value: boolean) => void;
}

const STORAGE_KEY_EXTENDED_MODE = "pipelineEditor.extendedMode";

function readStoredBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    if (raw === "true") return true;
    if (raw === "false") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeStoredBoolean(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // ignore
  }
}

const PipelineEditorPreferencesContext = createContext<PipelineEditorPreferences | undefined>(
  undefined
);

export function PipelineEditorPreferencesProvider({
  children,
  defaultExtendedMode = false,
}: {
  children: React.ReactNode;
  defaultExtendedMode?: boolean;
}) {
  const [extendedMode, setExtendedModeState] = useState<boolean>(() =>
    readStoredBoolean(STORAGE_KEY_EXTENDED_MODE, defaultExtendedMode)
  );

  const setExtendedMode = useCallback((value: boolean) => {
    setExtendedModeState(value);
    writeStoredBoolean(STORAGE_KEY_EXTENDED_MODE, value);

    // Broadcast to same-tab listeners.
    window.dispatchEvent(
      new CustomEvent("pipeline-editor-preferences", {
        detail: { extendedMode: value },
      })
    );
  }, []);

  // Listen for cross-tab updates.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY_EXTENDED_MODE) return;
      setExtendedModeState(readStoredBoolean(STORAGE_KEY_EXTENDED_MODE, defaultExtendedMode));
    };

    const onCustom = () => {
      setExtendedModeState(readStoredBoolean(STORAGE_KEY_EXTENDED_MODE, defaultExtendedMode));
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pipeline-editor-preferences", onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pipeline-editor-preferences", onCustom as EventListener);
    };
  }, [defaultExtendedMode]);

  const value = useMemo(
    () => ({
      extendedMode,
      setExtendedMode,
    }),
    [extendedMode, setExtendedMode]
  );

  return (
    <PipelineEditorPreferencesContext.Provider value={value}>
      {children}
    </PipelineEditorPreferencesContext.Provider>
  );
}

export function usePipelineEditorPreferences(): PipelineEditorPreferences {
  const ctx = useContext(PipelineEditorPreferencesContext);
  if (!ctx) {
    throw new Error(
      "usePipelineEditorPreferences must be used within a PipelineEditorPreferencesProvider"
    );
  }
  return ctx;
}

export function usePipelineEditorPreferencesOptional(): PipelineEditorPreferences | null {
  return useContext(PipelineEditorPreferencesContext) ?? null;
}

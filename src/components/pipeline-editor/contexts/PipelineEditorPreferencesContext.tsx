import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Tier level for operator visibility filtering.
 * - "core": show only essential NIRS operators (~28)
 * - "standard": core + standard operators (~122) — default
 * - "all": everything including advanced/deep learning (~150+)
 */
export type TierLevel = "core" | "standard" | "all";

export interface PipelineEditorPreferences {
  /** @deprecated Use tierLevel instead. Kept for backwards compatibility. */
  extendedMode: boolean;
  /** @deprecated Use setTierLevel instead. */
  setExtendedMode: (value: boolean) => void;
  /** Current tier level for operator visibility */
  tierLevel: TierLevel;
  /** Set the tier level */
  setTierLevel: (value: TierLevel) => void;
}

const STORAGE_KEY_EXTENDED_MODE = "pipelineEditor.extendedMode";
const STORAGE_KEY_TIER_LEVEL = "pipelineEditor.tierLevel";

const VALID_TIERS: TierLevel[] = ["core", "standard", "all"];

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

function readStoredTier(key: string, defaultValue: TierLevel): TierLevel {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    if (VALID_TIERS.includes(raw as TierLevel)) return raw as TierLevel;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeStoredString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

const PipelineEditorPreferencesContext = createContext<PipelineEditorPreferences | undefined>(
  undefined
);

function initTierLevel(defaultExtendedMode: boolean): TierLevel {
  // Prefer the new tierLevel key if it exists
  const stored = readStoredTier(STORAGE_KEY_TIER_LEVEL, "" as TierLevel);
  if (VALID_TIERS.includes(stored)) return stored;

  // Migrate from old extendedMode boolean
  const ext = readStoredBoolean(STORAGE_KEY_EXTENDED_MODE, defaultExtendedMode);
  return ext ? "all" : "standard";
}

export function PipelineEditorPreferencesProvider({
  children,
  defaultExtendedMode = false,
}: {
  children: React.ReactNode;
  defaultExtendedMode?: boolean;
}) {
  const [tierLevel, setTierLevelState] = useState<TierLevel>(() =>
    initTierLevel(defaultExtendedMode)
  );

  // Derive extendedMode from tierLevel for backwards compatibility
  const extendedMode = tierLevel === "all";

  const setTierLevel = useCallback((value: TierLevel) => {
    setTierLevelState(value);
    writeStoredString(STORAGE_KEY_TIER_LEVEL, value);
    // Keep old key in sync for any legacy consumers
    writeStoredString(STORAGE_KEY_EXTENDED_MODE, value === "all" ? "true" : "false");

    window.dispatchEvent(
      new CustomEvent("pipeline-editor-preferences", {
        detail: { tierLevel: value, extendedMode: value === "all" },
      })
    );
  }, []);

  const setExtendedMode = useCallback((value: boolean) => {
    setTierLevel(value ? "all" : "standard");
  }, [setTierLevel]);

  // Listen for cross-tab updates.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY_TIER_LEVEL) {
        setTierLevelState(readStoredTier(STORAGE_KEY_TIER_LEVEL, "standard"));
      } else if (e.key === STORAGE_KEY_EXTENDED_MODE) {
        // Only fallback to extendedMode key if tierLevel key is missing
        const tier = readStoredTier(STORAGE_KEY_TIER_LEVEL, "" as TierLevel);
        if (!VALID_TIERS.includes(tier)) {
          const ext = readStoredBoolean(STORAGE_KEY_EXTENDED_MODE, defaultExtendedMode);
          setTierLevelState(ext ? "all" : "standard");
        }
      }
    };

    const onCustom = () => {
      setTierLevelState(readStoredTier(STORAGE_KEY_TIER_LEVEL, "standard"));
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
      tierLevel,
      setTierLevel,
    }),
    [extendedMode, setExtendedMode, tierLevel, setTierLevel]
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

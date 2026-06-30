import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  clientStorageKeys,
  readClientStorageString,
  writeClientStorageString,
  type ClientStorageKey,
} from "@/lib/clientStorage";
import {
  PipelineEditorPreferencesContext,
  type TierLevel,
} from "./usePipelineEditorPreferences";

const VALID_TIERS: TierLevel[] = ["core", "standard", "all"];

function readStoredBoolean(key: ClientStorageKey<string>, defaultValue: boolean): boolean {
  const raw = readClientStorageString(key);
  if (raw === null) return defaultValue;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return defaultValue;
}

function readStoredTier(key: ClientStorageKey<string>, defaultValue: TierLevel): TierLevel {
  const raw = readClientStorageString(key);
  if (raw === null) return defaultValue;
  if (VALID_TIERS.includes(raw as TierLevel)) return raw as TierLevel;
  return defaultValue;
}

function writeStoredString(key: ClientStorageKey<string>, value: string): void {
  writeClientStorageString(key, value);
}

function initTierLevel(defaultExtendedMode: boolean): TierLevel {
  // Prefer the new tierLevel key if it exists
  const stored = readStoredTier(clientStorageKeys.pipelineEditorTierLevel, "" as TierLevel);
  if (VALID_TIERS.includes(stored)) return stored;

  // Migrate from old extendedMode boolean
  const ext = readStoredBoolean(clientStorageKeys.pipelineEditorExtendedMode, defaultExtendedMode);
  return ext ? "all" : "standard";
}

export function PipelineEditorPreferencesProvider({
  children,
  defaultExtendedMode = false,
}: {
  children: ReactNode;
  defaultExtendedMode?: boolean;
}) {
  const [tierLevel, setTierLevelState] = useState<TierLevel>(() =>
    initTierLevel(defaultExtendedMode)
  );
  const [showUnavailableOperators, setShowUnavailableOperatorsState] = useState<boolean>(() =>
    readStoredBoolean(clientStorageKeys.pipelineEditorShowUnavailableOperators, true)
  );

  // Derive extendedMode from tierLevel for backwards compatibility
  const extendedMode = tierLevel === "all";

  const setTierLevel = useCallback((value: TierLevel) => {
    setTierLevelState(value);
    writeStoredString(clientStorageKeys.pipelineEditorTierLevel, value);
    // Keep old key in sync for any legacy consumers
    writeStoredString(clientStorageKeys.pipelineEditorExtendedMode, value === "all" ? "true" : "false");

    window.dispatchEvent(
      new CustomEvent("pipeline-editor-preferences", {
        detail: {
          tierLevel: value,
          extendedMode: value === "all",
          showUnavailableOperators,
        },
      })
    );
  }, [showUnavailableOperators]);

  const setExtendedMode = useCallback((value: boolean) => {
    setTierLevel(value ? "all" : "standard");
  }, [setTierLevel]);

  const setShowUnavailableOperators = useCallback((value: boolean) => {
    setShowUnavailableOperatorsState(value);
    writeStoredString(clientStorageKeys.pipelineEditorShowUnavailableOperators, value ? "true" : "false");
    window.dispatchEvent(
      new CustomEvent("pipeline-editor-preferences", {
        detail: {
          tierLevel,
          extendedMode: tierLevel === "all",
          showUnavailableOperators: value,
        },
      })
    );
  }, [tierLevel]);

  // Listen for cross-tab updates.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === clientStorageKeys.pipelineEditorTierLevel.key) {
        setTierLevelState(readStoredTier(clientStorageKeys.pipelineEditorTierLevel, "standard"));
      } else if (e.key === clientStorageKeys.pipelineEditorShowUnavailableOperators.key) {
        setShowUnavailableOperatorsState(readStoredBoolean(clientStorageKeys.pipelineEditorShowUnavailableOperators, true));
      } else if (e.key === clientStorageKeys.pipelineEditorExtendedMode.key) {
        // Only fallback to extendedMode key if tierLevel key is missing
        const tier = readStoredTier(clientStorageKeys.pipelineEditorTierLevel, "" as TierLevel);
        if (!VALID_TIERS.includes(tier)) {
          const ext = readStoredBoolean(clientStorageKeys.pipelineEditorExtendedMode, defaultExtendedMode);
          setTierLevelState(ext ? "all" : "standard");
        }
      }
    };

    const onCustom = () => {
      setTierLevelState(readStoredTier(clientStorageKeys.pipelineEditorTierLevel, "standard"));
      setShowUnavailableOperatorsState(readStoredBoolean(clientStorageKeys.pipelineEditorShowUnavailableOperators, true));
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
      showUnavailableOperators,
      setShowUnavailableOperators,
    }),
    [
      extendedMode,
      setExtendedMode,
      setShowUnavailableOperators,
      setTierLevel,
      showUnavailableOperators,
      tierLevel,
    ]
  );

  return (
    <PipelineEditorPreferencesContext.Provider value={value}>
      {children}
    </PipelineEditorPreferencesContext.Provider>
  );
}

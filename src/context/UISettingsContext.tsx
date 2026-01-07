/**
 * UI Settings Context
 *
 * Provides application-wide UI settings management:
 * - UI density (compact/comfortable/spacious)
 * - Reduce animations toggle for accessibility
 * - Syncs with workspace settings when available
 *
 * Phase 2 Implementation
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/client";
import type { UIDensity, GeneralSettings } from "@/types/settings";
import { DEFAULT_GENERAL_SETTINGS } from "@/types/settings";

interface UISettingsContextType {
  /** Current UI density */
  density: UIDensity;
  /** Set UI density */
  setDensity: (density: UIDensity) => Promise<void>;
  /** Whether animations are reduced */
  reduceAnimations: boolean;
  /** Set reduce animations */
  setReduceAnimations: (reduce: boolean) => Promise<void>;
  /** Whether settings are loading */
  isLoading: boolean;
  /** Refresh settings from backend */
  refresh: () => Promise<void>;
}

const UISettingsContext = createContext<UISettingsContextType | undefined>(
  undefined
);

const STORAGE_KEY_DENSITY = "nirs4all-ui-density";
const STORAGE_KEY_ANIMATIONS = "nirs4all-reduce-animations";

interface UISettingsProviderProps {
  children: ReactNode;
}

export function UISettingsProvider({ children }: UISettingsProviderProps) {
  // Initialize from localStorage for fast render
  const [density, setDensityState] = useState<UIDensity>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(STORAGE_KEY_DENSITY);
      if (stored === "compact" || stored === "comfortable" || stored === "spacious") {
        return stored;
      }
    }
    return "comfortable";
  });

  const [reduceAnimations, setReduceAnimationsState] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem(STORAGE_KEY_ANIMATIONS) === "true";
    }
    return false;
  });

  const [isLoading, setIsLoading] = useState(true);
  const [hasWorkspace, setHasWorkspace] = useState(false);

  // Apply density class to document
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("density-compact", "density-comfortable", "density-spacious");
    root.classList.add(`density-${density}`);
  }, [density]);

  // Apply reduce-motion class to document
  useEffect(() => {
    const root = window.document.documentElement;
    if (reduceAnimations) {
      root.classList.add("reduce-motion");
    } else {
      root.classList.remove("reduce-motion");
    }
  }, [reduceAnimations]);

  // Load settings from workspace
  const loadFromWorkspace = useCallback(async () => {
    try {
      setIsLoading(true);
      const settings = await getWorkspaceSettings();
      if (settings.general) {
        if (settings.general.ui_density) {
          setDensityState(settings.general.ui_density);
        }
        if (typeof settings.general.reduce_animations === "boolean") {
          setReduceAnimationsState(settings.general.reduce_animations);
        }
        setHasWorkspace(true);
      }
    } catch {
      // No workspace - use localStorage values
      setHasWorkspace(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadFromWorkspace();
  }, [loadFromWorkspace]);

  // Get current general settings from backend or defaults
  const getCurrentGeneral = useCallback(async (): Promise<GeneralSettings> => {
    try {
      const settings = await getWorkspaceSettings();
      return settings.general || DEFAULT_GENERAL_SETTINGS;
    } catch {
      return DEFAULT_GENERAL_SETTINGS;
    }
  }, []);

  // Set density with backend sync
  const setDensity = useCallback(async (newDensity: UIDensity) => {
    setDensityState(newDensity);
    localStorage.setItem(STORAGE_KEY_DENSITY, newDensity);

    if (hasWorkspace) {
      try {
        const currentGeneral = await getCurrentGeneral();
        await updateWorkspaceSettings({
          general: { ...currentGeneral, ui_density: newDensity },
        });
      } catch (error) {
        console.debug("Failed to sync density to workspace:", error);
      }
    }
  }, [hasWorkspace, getCurrentGeneral]);

  // Set reduce animations with backend sync
  const setReduceAnimations = useCallback(async (reduce: boolean) => {
    setReduceAnimationsState(reduce);
    localStorage.setItem(STORAGE_KEY_ANIMATIONS, String(reduce));

    if (hasWorkspace) {
      try {
        const currentGeneral = await getCurrentGeneral();
        await updateWorkspaceSettings({
          general: { ...currentGeneral, reduce_animations: reduce },
        });
      } catch (error) {
        console.debug("Failed to sync animations setting to workspace:", error);
      }
    }
  }, [hasWorkspace, getCurrentGeneral]);

  const value: UISettingsContextType = {
    density,
    setDensity,
    reduceAnimations,
    setReduceAnimations,
    isLoading,
    refresh: loadFromWorkspace,
  };

  return (
    <UISettingsContext.Provider value={value}>
      {children}
    </UISettingsContext.Provider>
  );
}

/**
 * Hook to access UI settings context
 */
export function useUISettings(): UISettingsContextType {
  const context = useContext(UISettingsContext);
  if (context === undefined) {
    throw new Error("useUISettings must be used within a UISettingsProvider");
  }
  return context;
}

/**
 * Hook to get just the UI density
 */
export function useUIDensity(): UIDensity {
  const context = useContext(UISettingsContext);
  return context?.density ?? "comfortable";
}

/**
 * Hook to check if animations are reduced
 */
export function useReduceAnimations(): boolean {
  const context = useContext(UISettingsContext);
  return context?.reduceAnimations ?? false;
}

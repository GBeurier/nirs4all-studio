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
import { createLogger } from "@/lib/logger";
import type { UIDensity, UIZoomLevel, GeneralSettings } from "@/types/settings";

const logger = createLogger("UISettings");
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
  /** Current zoom level (percentage) */
  zoomLevel: UIZoomLevel;
  /** Set zoom level */
  setZoomLevel: (level: UIZoomLevel) => Promise<void>;
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
const STORAGE_KEY_ZOOM = "nirs4all-ui-zoom";

const VALID_ZOOM_LEVELS: UIZoomLevel[] = [75, 80, 90, 100, 110, 125, 150];

// Safe localStorage access - returns null if localStorage is unavailable
function safeGetItem(key: string): string | null {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? localStorage.getItem(key)
      : null;
  } catch {
    return null;
  }
}

function safeSetItem(key: string, value: string): void {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      localStorage.setItem(key, value);
    }
  } catch {
    // Silently fail if localStorage is unavailable
  }
}

interface UISettingsProviderProps {
  children: ReactNode;
}

export function UISettingsProvider({ children }: UISettingsProviderProps) {
  // Initialize from localStorage for fast render
  const [density, setDensityState] = useState<UIDensity>(() => {
    const stored = safeGetItem(STORAGE_KEY_DENSITY);
    if (stored === "compact" || stored === "comfortable" || stored === "spacious") {
      return stored;
    }
    return "comfortable";
  });

  const [reduceAnimations, setReduceAnimationsState] = useState<boolean>(() => {
    return safeGetItem(STORAGE_KEY_ANIMATIONS) === "true";
  });

  const [zoomLevel, setZoomLevelState] = useState<UIZoomLevel>(() => {
    const stored = safeGetItem(STORAGE_KEY_ZOOM);
    if (stored) {
      const parsed = parseInt(stored, 10) as UIZoomLevel;
      if (VALID_ZOOM_LEVELS.includes(parsed)) {
        return parsed;
      }
    }
    return 100;
  });

  const [isLoading, setIsLoading] = useState(false);
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

  // Apply zoom level via CSS custom property
  useEffect(() => {
    const root = window.document.documentElement;
    root.style.setProperty("--ui-zoom", String(zoomLevel / 100));
    // Add zoom class for CSS styling
    VALID_ZOOM_LEVELS.forEach(level => {
      root.classList.remove(`zoom-${level}`);
    });
    root.classList.add(`zoom-${zoomLevel}`);
  }, [zoomLevel]);

  // Load settings from workspace (non-blocking: localStorage defaults are already active)
  const loadFromWorkspace = useCallback(async () => {
    try {
      const settings = await getWorkspaceSettings();
      if (settings.general) {
        if (settings.general.ui_density) {
          setDensityState(settings.general.ui_density);
        }
        if (typeof settings.general.reduce_animations === "boolean") {
          setReduceAnimationsState(settings.general.reduce_animations);
        }
        if (settings.general.zoom_level && VALID_ZOOM_LEVELS.includes(settings.general.zoom_level)) {
          setZoomLevelState(settings.general.zoom_level);
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
    safeSetItem(STORAGE_KEY_DENSITY, newDensity);

    if (hasWorkspace) {
      try {
        const currentGeneral = await getCurrentGeneral();
        await updateWorkspaceSettings({
          general: { ...currentGeneral, ui_density: newDensity },
        });
      } catch (error) {
        logger.debug("Failed to sync density to workspace:", error);
      }
    }
  }, [hasWorkspace, getCurrentGeneral]);

  // Set reduce animations with backend sync
  const setReduceAnimations = useCallback(async (reduce: boolean) => {
    setReduceAnimationsState(reduce);
    safeSetItem(STORAGE_KEY_ANIMATIONS, String(reduce));

    if (hasWorkspace) {
      try {
        const currentGeneral = await getCurrentGeneral();
        await updateWorkspaceSettings({
          general: { ...currentGeneral, reduce_animations: reduce },
        });
      } catch (error) {
        logger.debug("Failed to sync animations setting to workspace:", error);
      }
    }
  }, [hasWorkspace, getCurrentGeneral]);

  // Set zoom level with backend sync
  const setZoomLevel = useCallback(async (level: UIZoomLevel) => {
    setZoomLevelState(level);
    safeSetItem(STORAGE_KEY_ZOOM, String(level));

    if (hasWorkspace) {
      try {
        const currentGeneral = await getCurrentGeneral();
        await updateWorkspaceSettings({
          general: { ...currentGeneral, zoom_level: level },
        });
      } catch (error) {
        logger.debug("Failed to sync zoom level to workspace:", error);
      }
    }
  }, [hasWorkspace, getCurrentGeneral]);

  const value: UISettingsContextType = {
    density,
    setDensity,
    reduceAnimations,
    setReduceAnimations,
    zoomLevel,
    setZoomLevel,
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

/**
 * Hook to get just the UI zoom level
 */
export function useUIZoomLevel(): UIZoomLevel {
  const context = useContext(UISettingsContext);
  return context?.zoomLevel ?? 100;
}

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
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { getWorkspaceSettings, updateWorkspaceSettings } from "@/api/workspace";
import {
  UISettingsContext,
  type UISettingsContextType,
} from "@/context/useUISettings";
import {
  clientStorageKeys,
  type ClientStorageKey,
  readClientStorageString,
  writeClientStorageString,
} from "@/lib/clientStorage";
import { createLogger } from "@/lib/logger";
import type { UIDensity, UIZoomLevel, GeneralSettings } from "@/types/settings";

const logger = createLogger("UISettings");
import { DEFAULT_GENERAL_SETTINGS } from "@/types/settings";

const VALID_ZOOM_LEVELS: UIZoomLevel[] = [75, 80, 90, 100, 110, 125, 150];

// Safe client storage access - returns null if storage is unavailable
function safeGetItem(key: ClientStorageKey<string>): string | null {
  return readClientStorageString(key);
}

function safeSetItem(key: ClientStorageKey<string>, value: string): void {
  writeClientStorageString(key, value);
}

interface UISettingsProviderProps {
  children: ReactNode;
}

export function UISettingsProvider({ children }: UISettingsProviderProps) {
  // Initialize from client storage for fast render
  const [density, setDensityState] = useState<UIDensity>(() => {
    const stored = safeGetItem(clientStorageKeys.uiDensity);
    if (stored === "compact" || stored === "comfortable" || stored === "spacious") {
      return stored;
    }
    return "comfortable";
  });

  const [reduceAnimations, setReduceAnimationsState] = useState<boolean>(() => {
    return safeGetItem(clientStorageKeys.reduceAnimations) === "true";
  });

  const [zoomLevel, setZoomLevelState] = useState<UIZoomLevel>(() => {
    const stored = safeGetItem(clientStorageKeys.uiZoom);
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
  const [isInitialized, setIsInitialized] = useState(false);

  // Expose UI settings lifecycle markers on the root element for E2E synchronization.
  useEffect(() => {
    window.document.documentElement.dataset.workspaceReady = String(hasWorkspace);
    window.document.documentElement.dataset.uiSettingsReady = String(isInitialized);
  }, [hasWorkspace, isInitialized]);

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

  // Load settings from workspace (non-blocking: client storage defaults are already active)
  const loadFromWorkspace = useCallback(async () => {
    setIsLoading(true);
    setIsInitialized(false);
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
      // No workspace - use client storage values
      setHasWorkspace(false);
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
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
    safeSetItem(clientStorageKeys.uiDensity, newDensity);

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
    safeSetItem(clientStorageKeys.reduceAnimations, String(reduce));

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
    safeSetItem(clientStorageKeys.uiZoom, String(level));

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

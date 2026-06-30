import { createContext, useContext } from "react";

import type { UIDensity, UIZoomLevel } from "@/types/settings";

export interface UISettingsContextType {
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

export const UISettingsContext = createContext<UISettingsContextType | undefined>(
  undefined,
);

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

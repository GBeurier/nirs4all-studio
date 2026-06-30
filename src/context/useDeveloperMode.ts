import { createContext, useContext } from "react";

export interface DeveloperModeContextType {
  /** Whether developer mode is enabled */
  isDeveloperMode: boolean;
  /** Whether the setting is currently loading */
  isLoading: boolean;
  /** Toggle developer mode on/off */
  toggleDeveloperMode: () => Promise<void>;
  /** Set developer mode to a specific value */
  setDeveloperMode: (enabled: boolean) => Promise<void>;
  /** Refresh developer mode from backend */
  refresh: () => Promise<void>;
}

export const DeveloperModeContext = createContext<DeveloperModeContextType | undefined>(
  undefined,
);

/**
 * Hook to access developer mode context
 */
export function useDeveloperMode(): DeveloperModeContextType {
  const context = useContext(DeveloperModeContext);
  if (context === undefined) {
    throw new Error(
      "useDeveloperMode must be used within a DeveloperModeProvider",
    );
  }
  return context;
}

/**
 * Hook to check if developer mode is enabled (simpler interface)
 */
export function useIsDeveloperMode(): boolean {
  const context = useContext(DeveloperModeContext);
  return context?.isDeveloperMode ?? false;
}

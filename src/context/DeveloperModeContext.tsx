/**
 * Developer Mode Context
 *
 * Provides application-wide access to developer mode state.
 * Developer mode enables additional features like synthetic data generation,
 * debug information, and advanced options.
 *
 * Phase 6 Implementation
 */

import {
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { getAppSettings, updateAppSettings } from "@/api/appSettings";
import { getWorkspaceSettings } from "@/api/workspace";
import {
  DeveloperModeContext,
  type DeveloperModeContextType,
} from "@/context/useDeveloperMode";

interface DeveloperModeProviderProps {
  children: ReactNode;
}

export function DeveloperModeProvider({ children }: DeveloperModeProviderProps) {
  const [isDeveloperMode, setIsDeveloperMode] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load developer mode setting from backend
  const loadDeveloperMode = useCallback(async () => {
    try {
      setIsLoading(true);
      const settings = await getAppSettings();
      const enabled = settings.ui_preferences.developer_mode
        ?? (await getWorkspaceSettings().catch(() => null))?.developer_mode
        ?? false;
      setIsDeveloperMode(enabled);
    } catch {
      // Settings may not be available during backend startup.
      setIsDeveloperMode(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadDeveloperMode();
  }, [loadDeveloperMode]);

  // Set developer mode and persist to backend
  const setDeveloperModeValue = useCallback(async (enabled: boolean) => {
    const previous = isDeveloperMode;
    try {
      setIsDeveloperMode(enabled);
      await updateAppSettings({ ui_preferences: { developer_mode: enabled } });
    } catch (error) {
      // Revert on error
      setIsDeveloperMode(previous);
      console.error("Failed to update developer mode:", error);
      throw error;
    }
  }, [isDeveloperMode]);

  // Toggle developer mode
  const toggleDeveloperMode = useCallback(async () => {
    await setDeveloperModeValue(!isDeveloperMode);
  }, [isDeveloperMode, setDeveloperModeValue]);

  // Refresh from backend
  const refresh = useCallback(async () => {
    await loadDeveloperMode();
  }, [loadDeveloperMode]);

  const value: DeveloperModeContextType = {
    isDeveloperMode,
    isLoading,
    toggleDeveloperMode,
    setDeveloperMode: setDeveloperModeValue,
    refresh,
  };

  return (
    <DeveloperModeContext.Provider value={value}>
      {children}
    </DeveloperModeContext.Provider>
  );
}

/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getAppSettings, updateAppSettings } from "@/api/client";
import {
  isDebugDataSharingEnabled,
  setDebugDataSharingConsent,
} from "@/lib/diagnostics";

interface DiagnosticsConsentContextType {
  debugDataSharingEnabled: boolean;
  isLoading: boolean;
  setDebugDataSharingEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const DiagnosticsConsentContext =
  createContext<DiagnosticsConsentContextType | undefined>(undefined);

interface DiagnosticsConsentProviderProps {
  children: ReactNode;
}

export function DiagnosticsConsentProvider({
  children,
}: DiagnosticsConsentProviderProps) {
  const [debugDataSharingEnabled, setDebugDataSharingEnabledState] = useState(
    isDebugDataSharingEnabled()
  );
  const [isLoading, setIsLoading] = useState(true);

  const loadConsent = useCallback(async () => {
    try {
      setIsLoading(true);
      const settings = await getAppSettings();
      const enabled = Boolean(
        settings.ui_preferences?.debug_data_sharing_enabled
      );
      setDebugDataSharingEnabledState(enabled);
      setDebugDataSharingConsent(enabled);
    } catch {
      setDebugDataSharingEnabledState(isDebugDataSharingEnabled());
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConsent();
  }, [loadConsent]);

  const setDebugDataSharingEnabled = useCallback(async (enabled: boolean) => {
    const previous = debugDataSharingEnabled;
    setDebugDataSharingEnabledState(enabled);
    setDebugDataSharingConsent(enabled);

    try {
      await updateAppSettings({
        ui_preferences: { debug_data_sharing_enabled: enabled },
      });
    } catch (error) {
      setDebugDataSharingEnabledState(previous);
      setDebugDataSharingConsent(previous);
      throw error;
    }
  }, [debugDataSharingEnabled]);

  return (
    <DiagnosticsConsentContext.Provider
      value={{
        debugDataSharingEnabled,
        isLoading,
        setDebugDataSharingEnabled,
        refresh: loadConsent,
      }}
    >
      {children}
    </DiagnosticsConsentContext.Provider>
  );
}

export function useDiagnosticsConsent(): DiagnosticsConsentContextType {
  const context = useContext(DiagnosticsConsentContext);
  if (!context) {
    throw new Error(
      "useDiagnosticsConsent must be used within a DiagnosticsConsentProvider"
    );
  }
  return context;
}

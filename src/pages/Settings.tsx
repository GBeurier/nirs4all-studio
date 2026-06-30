/**
 * Settings Page
 *
 * Reorganized with sections:
 * - General: Theme, UI density, animations, language, and keyboard shortcuts
 * - Workspace: Current workspace stats and management
 * - Data Defaults: Default settings for dataset loading
 * - Advanced: Developer options and troubleshooting
 *
 * Phase 2 (Settings Roadmap): General Settings Enhancements
 * Phase 3 (Settings Roadmap): Workspace Management Enhancements
 * Phase 5 Implementation: System Information & Diagnostics
 * Phase 6 Implementation: Localization (i18n)
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { motion } from "@/lib/motion";
import { clearClientStorageArea } from "@/lib/clientStorage";
import { useTheme } from "@/context/useTheme";
import { useDeveloperMode } from "@/context/useDeveloperMode";
import { useUISettings } from "@/context/useUISettings";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getWorkspace } from "@/api/workspace";
import { requestRestart } from "@/api/updates";
import { resetBackendUrl } from "@/api/transport";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import { disableSentry, initSentry } from "@/lib/sentry";
import {
  TELEMETRY_CONSENT_UPDATED_EVENT,
  getTelemetryConsentStatus,
  setTelemetryConsentStatus,
  type TelemetryConsentStatus,
} from "@/lib/telemetryConsent";
import {
  useLinkedWorkspacesQuery,
  useInvalidateDatasets,
} from "@/hooks/useDatasetQueries";
import { SETTINGS_TABS, getSettingsTabFromSearchParams } from "./settingsNavigation";
import {
  GeneralSettingsTab,
  WorkspacesSettingsTab,
  DataSettingsTab,
  AdvancedSettingsTab,
} from "./SettingsSections";

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function Settings() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { theme, setTheme } = useTheme();
  const { isDeveloperMode, setDeveloperMode, isLoading: isLoadingDevMode } = useDeveloperMode();
  const { density, setDensity, reduceAnimations, setReduceAnimations, zoomLevel, setZoomLevel, isLoading: isLoadingUI } = useUISettings();
  const [workspacePath, setWorkspacePath] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(true);
  const [backendUrl, setBackendUrl] = useState<string>("...");
  const [isRestarting, setIsRestarting] = useState(false);
  const [telemetryConsent, setTelemetryConsent] = useState<TelemetryConsentStatus>("unset");
  const [isSavingTelemetryConsent, setIsSavingTelemetryConsent] = useState(false);

  // Linked workspaces come from the shared cache so the active id is the same
  // value the rest of the app sees. `loadN4AWorkspaces` is now a thin
  // invalidate-and-refetch call so child components keep working unchanged.
  const linkedWorkspacesQuery = useLinkedWorkspacesQuery();
  const activeN4AWorkspaceId = linkedWorkspacesQuery.data?.active_workspace_id ?? null;
  const invalidateDatasets = useInvalidateDatasets();
  const loadN4AWorkspaces = useCallback(() => {
    void invalidateDatasets();
  }, [invalidateDatasets]);

  // Load workspace info on mount
  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTelemetryConsentStatus().then((status) => {
      if (!cancelled) setTelemetryConsent(status);
    });

    const handleConsentUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ status?: TelemetryConsentStatus }>).detail;
      if (detail?.status) {
        setTelemetryConsent(detail.status);
      }
    };
    window.addEventListener(TELEMETRY_CONSENT_UPDATED_EVENT, handleConsentUpdated);

    return () => {
      cancelled = true;
      window.removeEventListener(TELEMETRY_CONSENT_UPDATED_EVENT, handleConsentUpdated);
    };
  }, []);

  // Resolve actual backend URL (dynamic port in Electron mode)
  useEffect(() => {
    const electronApi = (window as unknown as { electronApi?: { getBackendUrl?: () => Promise<string> } }).electronApi;
    if (electronApi?.getBackendUrl) {
      electronApi.getBackendUrl().then((url) => setBackendUrl(url)).catch(() => setBackendUrl(window.location.origin));
    } else {
      setBackendUrl(window.location.origin);
    }
  }, []);

  const loadWorkspace = async () => {
    try {
      setIsLoadingWorkspace(true);
      const response = await getWorkspace();
      if (response.workspace) {
        setWorkspacePath(response.workspace.path);
        setWorkspaceName(response.workspace.name);
      }
    } catch (error) {
      console.error("Failed to load workspace:", error);
    } finally {
      setIsLoadingWorkspace(false);
    }
  };

  const handleDeveloperModeChange = async (enabled: boolean) => {
    try {
      await setDeveloperMode(enabled);
    } catch (error) {
      console.error("Failed to update developer mode:", error);
    }
  };

  const handleTelemetryConsentChange = async (enabled: boolean) => {
    const status: Exclude<TelemetryConsentStatus, "unset"> = enabled ? "accepted" : "declined";
    setIsSavingTelemetryConsent(true);
    try {
      await setTelemetryConsentStatus(status);
      setTelemetryConsent(status);
      if (status === "accepted") {
        initSentry();
      } else {
        void disableSentry();
      }
    } catch (error) {
      console.error("Failed to update telemetry consent:", error);
    } finally {
      setIsSavingTelemetryConsent(false);
    }
  };

  const handleClearLocalStorage = () => {
    clearClientStorageArea("local");
    clearClientStorageArea("session");
    window.location.reload();
  };

  const handleResetToDefaults = () => {
    clearClientStorageArea("local");
    clearClientStorageArea("session");
    setTheme("system");
    window.location.reload();
  };

  const handleRestartBackend = async () => {
    setIsRestarting(true);
    try {
      const electronApi = (window as unknown as { electronApi?: { restartBackend?: () => Promise<{ success: boolean; port?: number }> } }).electronApi;
      if (electronApi?.restartBackend) {
        const result = await electronApi.restartBackend();
        if (result.success) {
          resetBackendUrl();
          if (result.port) setBackendUrl(`http://127.0.0.1:${result.port}`);
          dispatchOperatorAvailabilityInvalidated();
          window.dispatchEvent(new CustomEvent("backend-restarted"));
        }
      } else {
        await requestRestart();
        dispatchOperatorAvailabilityInvalidated();
      }
    } finally {
      setIsRestarting(false);
    }
  };

  const initialTab = useMemo(
    () => getSettingsTabFromSearchParams(searchParams),
    [searchParams],
  );

  const [activeTab, setActiveTab] = useState<string>(initialTab);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", value);
      return next;
    });
  };

  return (
    <motion.div
      className="space-y-6 max-w-4xl"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold tracking-tight">{t("settings.title")}</h1>
        <p className="text-muted-foreground">
          {t("settings.subtitle")}
        </p>
      </motion.div>

      {/* Tabs for organization */}
      <motion.div variants={itemVariants}>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4">
            {SETTINGS_TABS.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value}>
                {"labelKey" in tab ? t(tab.labelKey) : tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-6">
            <GeneralSettingsTab
              theme={theme}
              setTheme={setTheme}
              density={density}
              setDensity={setDensity}
              zoomLevel={zoomLevel}
              setZoomLevel={setZoomLevel}
              reduceAnimations={reduceAnimations}
              setReduceAnimations={setReduceAnimations}
              isLoadingUI={isLoadingUI}
              telemetryConsent={telemetryConsent}
              handleTelemetryConsentChange={handleTelemetryConsentChange}
              isSavingTelemetryConsent={isSavingTelemetryConsent}
            />
          </TabsContent>

          {/* Workspaces Tab (Merged) */}
          <TabsContent value="workspaces" className="space-y-6">
            <WorkspacesSettingsTab
              workspacePath={workspacePath}
              activeN4AWorkspaceId={activeN4AWorkspaceId}
              loadWorkspace={loadWorkspace}
              loadN4AWorkspaces={loadN4AWorkspaces}
            />
          </TabsContent>

          {/* Data Defaults Tab */}
          <TabsContent value="data" className="space-y-6">
            <DataSettingsTab />
          </TabsContent>

          {/* Advanced Tab */}
          <TabsContent value="advanced" className="space-y-6">
            <AdvancedSettingsTab
              isDeveloperMode={isDeveloperMode}
              handleDeveloperModeChange={handleDeveloperModeChange}
              isLoadingDevMode={isLoadingDevMode}
              workspacePath={workspacePath}
              backendUrl={backendUrl}
              isRestarting={isRestarting}
              handleRestartBackend={handleRestartBackend}
              handleClearLocalStorage={handleClearLocalStorage}
              handleResetToDefaults={handleResetToDefaults}
            />
          </TabsContent>
        </Tabs>
      </motion.div>

      {/* App Info */}
      <motion.div variants={itemVariants}>
        <Card className="border-dashed">
          <CardContent className="p-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>{t("settings.appInfo.version", { version: __APP_VERSION__ })}</span>
            <span>{t("settings.appInfo.copyright", { year: "2025-2026" })}</span>
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}

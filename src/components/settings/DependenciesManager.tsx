/**
 * Dependencies Manager Component
 *
 * Displays nirs4all optional dependencies with installation status
 * and provides install/uninstall/update/revert actions for each package.
 * Shows version status relative to recommended versions.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getDependencies,
  installDependency,
  uninstallDependency,
  refreshDependencies,
  revertDependency,
} from "@/api/dependencies";
import { requestRestart } from "@/api/updates";
import { resetBackendUrl } from "@/api/transport";
import { getRuntimeSummary } from "@/api/system";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import { getPythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import {
  DependenciesErrorCard,
  DependenciesLoadingCard,
  DependenciesManagerShell,
} from "./DependenciesManagerShell";
import { CategorySection } from "./DependenciesManagerRows";
import {
  countOutdatedPackages,
  type LastActionState,
} from "./DependenciesManagerLogic";
import type { DependenciesResponse } from "@/api/dependencies";
import type { RuntimeSummaryResponse } from "@/types/settings";

interface DependenciesManagerProps {
  /** Whether to show in compact mode */
  compact?: boolean;
}

export function DependenciesManager({ compact = false }: DependenciesManagerProps) {
  const [dependencies, setDependencies] = useState<DependenciesResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [processingPackage, setProcessingPackage] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<LastActionState | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummaryResponse | null>(null);

  const loadDependencies = useCallback(async (forceRefresh = false) => {
    try {
      if (!forceRefresh) {
        setIsLoading(true);
      }
      setError(null);
      const [data, summary] = await Promise.all([
        getDependencies(forceRefresh),
        getRuntimeSummary().catch(() => null),
      ]);
      setDependencies(data);
      setRuntimeSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dependencies");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await refreshDependencies();
    await loadDependencies(true);
  }, [loadDependencies]);

  const handleInstall = useCallback(async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await installDependency(packageName, undefined, false, "recommended");
      setLastAction({
        type: "install",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "install",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Installation failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  }, [loadDependencies]);

  const handleUninstall = useCallback(async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await uninstallDependency(packageName);
      setLastAction({
        type: "uninstall",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "uninstall",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Uninstallation failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  }, [loadDependencies]);

  const handleUpdateToLatest = useCallback(async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await installDependency(packageName, undefined, true, "latest");
      setLastAction({
        type: "update",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "update",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Update failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  }, [loadDependencies]);

  const handleRevertToRecommended = useCallback(async (packageName: string) => {
    try {
      setProcessingPackage(packageName);
      setLastAction(null);
      const result = await revertDependency(packageName);
      setLastAction({
        type: "update",
        package: packageName,
        success: result.success,
        message: result.message,
      });
      if (result.requires_restart) setNeedsRestart(true);
      await loadDependencies(true);
      dispatchOperatorAvailabilityInvalidated();
    } catch (err) {
      setLastAction({
        type: "update",
        package: packageName,
        success: false,
        message: err instanceof Error ? err.message : "Revert failed",
      });
    } finally {
      setProcessingPackage(null);
    }
  }, [loadDependencies]);

  const handleRestartBackend = useCallback(async () => {
    const electronApi = (window as unknown as {
      electronApi?: { restartBackend?: () => Promise<{ success: boolean }> };
    }).electronApi;

    if (electronApi?.restartBackend) {
      const result = await electronApi.restartBackend();
      if (result.success) {
        resetBackendUrl();
        setNeedsRestart(false);
        dispatchOperatorAvailabilityInvalidated();
        window.dispatchEvent(new CustomEvent("backend-restarted"));
      }
      return;
    }

    await requestRestart();
    setNeedsRestart(false);
    dispatchOperatorAvailabilityInvalidated();
  }, []);

  useEffect(() => {
    void loadDependencies();
  }, [loadDependencies]);

  // Reload after backend restart (e.g., env change in PythonEnvPicker)
  useEffect(() => {
    const handler = () => {
      // Backend just restarted — delay to let it warm up, then force refresh
      setTimeout(() => {
        void loadDependencies(true);
      }, 2000);
    };
    window.addEventListener("backend-restarted", handler);
    return () => window.removeEventListener("backend-restarted", handler);
  }, [loadDependencies]);

  if (isLoading) {
    return <DependenciesLoadingCard />;
  }

  if (error) {
    return (
      <DependenciesErrorCard
        error={error}
        onRetry={() => loadDependencies()}
      />
    );
  }

  if (!dependencies) {
    return null;
  }

  const outdatedCount = countOutdatedPackages(dependencies);
  const runtimeDisplay = getPythonRuntimeDisplayState(runtimeSummary);
  const isReadOnlyRuntime = runtimeDisplay.isReadOnly;

  return (
    <DependenciesManagerShell
      dependencies={dependencies}
      runtimeDisplay={runtimeDisplay}
      outdatedCount={outdatedCount}
      isRefreshing={isRefreshing}
      isRefreshDisabled={isRefreshing || !!processingPackage}
      lastAction={lastAction}
      needsRestart={needsRestart}
      compact={compact}
      onRefresh={handleRefresh}
      onDismissLastAction={() => setLastAction(null)}
      onRestartBackend={handleRestartBackend}
    >
      <div className="space-y-4">
        {dependencies.categories.map((category, index) => (
          <CategorySection
            key={category.id}
            category={category}
            onInstall={handleInstall}
            onUninstall={handleUninstall}
            onUpdateToLatest={handleUpdateToLatest}
            onRevertToRecommended={handleRevertToRecommended}
            isProcessing={isReadOnlyRuntime ? "__frozen__" : processingPackage}
            defaultOpen={index === 0}
          />
        ))}
      </div>
    </DependenciesManagerShell>
  );
}

/**
 * Updates Section Component
 *
 * Displays update status and controls for:
 * - Webapp updates (from GitHub Releases) with download/apply flow
 * - nirs4all library updates (from PyPI)
 * - Managed virtual environment status
 * - Update settings
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  useUpdateStatus,
  useCheckForUpdates,
  useUpdateSettings,
  useUpdateUpdateSettings,
  useVenvStatus,
  useInstallNirs4all,
  useUpdateDownload,
  useStagedUpdate,
  formatBytes,
} from "@/hooks/useUpdates";
import { useGPUDetection } from "@/hooks/useRecommendedConfig";
import {
  listSnapshots,
  createSnapshot,
  restoreSnapshot,
  deleteSnapshot,
  getWebappChangelog,
  requestRestart,
  getLastApplyResult,
  dismissLastApplyResult,
} from "@/api/updates";
import { getRuntimeSummary } from "@/api/system";
import { resetBackendUrl } from "@/api/transport";
import type { RuntimeSummaryResponse } from "@/types/settings";
import { dispatchOperatorAvailabilityInvalidated } from "@/lib/pipelineOperatorAvailability";
import { getPythonRuntimeDisplayState } from "@/lib/pythonRuntimeDisplay";
import {
  getCurrentRuntime,
  getGpuDisplay,
  getNirs4allUpdateRowState,
  getRuntimeExecutablePath,
  getTorchRuntimeDisplay,
  getUpdateAvailability,
  getWebappDialogCopy,
  getWebappUpdateRowState,
} from "./UpdatesSectionLogic";
import {
  UpdatesErrorCard,
  UpdatesLoadingCard,
  UpdatesSectionShell,
} from "./UpdatesSectionShell";
import { UpdatesApplyConfirmDialog } from "./UpdatesApplyConfirmDialog";
import { UpdatesNirs4allDialog } from "./UpdatesNirs4allDialog";
import { UpdatesWebappDialog } from "./UpdatesWebappDialog";

export function UpdatesSection() {
  const queryClient = useQueryClient();
  const { data: status, isLoading: statusLoading, error: statusError } = useUpdateStatus();
  const { data: settings, isLoading: settingsLoading } = useUpdateSettings();
  const { data: venvStatus, isLoading: venvLoading } = useVenvStatus();
  const { data: gpuInfo, isLoading: gpuLoading } = useGPUDetection();

  const checkMutation = useCheckForUpdates();
  const settingsMutation = useUpdateUpdateSettings();
  const installMutation = useInstallNirs4all();

  // Auto-update download/apply state
  const updateDownload = useUpdateDownload();
  const { data: stagedUpdate } = useStagedUpdate();

  // Surface a banner when the previous update apply silently failed (the app
  // closed for the updater but came back on the old version).
  const { data: lastApplyResult } = useQuery({
    queryKey: ["updates", "last-apply-result"],
    queryFn: getLastApplyResult,
    staleTime: 60 * 1000,
  });
  const dismissApplyResultMutation = useMutation({
    mutationFn: dismissLastApplyResult,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["updates", "last-apply-result"] }),
  });

  // Snapshots
  const snapshotsQuery = useQuery({
    queryKey: ["snapshots"],
    queryFn: listSnapshots,
    staleTime: 60 * 1000,
  });
  const createSnapshotMutation = useMutation({
    mutationFn: (label?: string) => createSnapshot(label),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });
  const restoreSnapshotMutation = useMutation({
    mutationFn: (name: string) => restoreSnapshot(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["snapshots"] });
      queryClient.invalidateQueries({ queryKey: ["updates", "venv"] });
      queryClient.invalidateQueries({ queryKey: ["updates", "status"] });
    },
  });
  const deleteSnapshotMutation = useMutation({
    mutationFn: (name: string) => deleteSnapshot(name),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["snapshots"] }),
  });

  // Changelog
  const changelogQuery = useQuery({
    queryKey: ["changelog", status?.webapp?.current_version],
    queryFn: () => getWebappChangelog(status?.webapp?.current_version),
    enabled: false, // only fetch on demand
    staleTime: 5 * 60 * 1000,
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [venvOpen, setVenvOpen] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [nirs4allDialogOpen, setNirs4allDialogOpen] = useState(false);
  const [webappDialogOpen, setWebappDialogOpen] = useState(false);
  const [applyConfirmOpen, setApplyConfirmOpen] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [runtimeSummary, setRuntimeSummary] = useState<RuntimeSummaryResponse | null>(null);

  const loadRuntimeSummary = useCallback(() => {
    void getRuntimeSummary()
      .then((summary) => setRuntimeSummary(summary))
      .catch(() => setRuntimeSummary(null));
  }, []);

  const handleRestartBackend = useCallback(async () => {
    const electronApi = (window as unknown as Record<string, unknown>).electronApi as
      | { restartBackend?: () => Promise<{ success: boolean }> }
      | undefined;
    if (electronApi?.restartBackend) {
      const result = await electronApi.restartBackend();
      if (result.success) {
        resetBackendUrl();
        setNeedsRestart(false);
        dispatchOperatorAvailabilityInvalidated();
        window.dispatchEvent(new CustomEvent("backend-restarted"));
      }
    } else {
      await requestRestart();
      setNeedsRestart(false);
      dispatchOperatorAvailabilityInvalidated();
    }
  }, []);

  // Reload after backend restart (e.g., env change in PythonEnvPicker)
  useEffect(() => {
    const handler = () => {
      // Backend just restarted — delay to let it warm up, then invalidate all update queries
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["updates"] });
        queryClient.invalidateQueries({ queryKey: ["snapshots"] });
        loadRuntimeSummary();
      }, 2000);
    };
    window.addEventListener("backend-restarted", handler);
    return () => window.removeEventListener("backend-restarted", handler);
  }, [loadRuntimeSummary, queryClient]);

  useEffect(() => {
    loadRuntimeSummary();
  }, [loadRuntimeSummary]);

  const isLoading = statusLoading || settingsLoading;

  if (isLoading) {
    return <UpdatesLoadingCard />;
  }

  if (statusError) {
    return (
      <UpdatesErrorCard
        onRetry={() => checkMutation.mutate()}
        isRetrying={checkMutation.isPending}
      />
    );
  }

  const updateAvailability = getUpdateAvailability(status);
  const {
    hasWebappUpdate,
    hasAnyUpdate,
    updateCount,
  } = updateAvailability;
  const webappRow = getWebappUpdateRowState({
    status,
    stagedUpdate,
    download: updateDownload,
  });
  // Prefer the resolved native installer (.exe/.dmg/.deb/.AppImage); fall back
  // to the release page when it couldn't be resolved.
  const installerUrl = webappRow.installerUrl;
  const canApplyInPlace = webappRow.canApplyInPlace;
  const openInstaller = () => {
    if (!installerUrl) return;
    const electronApi = (window as unknown as Record<string, unknown>).electronApi as
      | { openExternal?: (u: string) => Promise<void> }
      | undefined;
    if (electronApi?.openExternal) void electronApi.openExternal(installerUrl);
    else window.open(installerUrl, "_blank", "noopener,noreferrer");
  };
  const runtimeDisplay = getPythonRuntimeDisplayState(runtimeSummary);
  const isReadOnlyRuntime = runtimeDisplay.isReadOnly;
  const nirs4allRow = getNirs4allUpdateRowState(status, isReadOnlyRuntime);
  const currentRuntime = getCurrentRuntime(venvStatus);
  const runtimeExecutablePath = getRuntimeExecutablePath(runtimeSummary, currentRuntime);
  const gpuDisplay = getGpuDisplay(gpuInfo, gpuLoading);
  const torchDisplay = getTorchRuntimeDisplay(gpuInfo);
  const webappDialogCopy = getWebappDialogCopy({
    download: updateDownload,
    latestVersion: status?.webapp?.latest_version,
  });

  const handleAutoCheckToggle = (checked: boolean) => {
    settingsMutation.mutate({ auto_check: checked });
  };

  const handlePrereleaseToggle = (checked: boolean) => {
    settingsMutation.mutate({ prerelease_channel: checked }, {
      onSuccess: () => {
        // Re-check for updates with the new channel setting
        checkMutation.mutate();
      },
    });
  };

  const handleOfflineModeChange = (value: "auto" | "on" | "off") => {
    settingsMutation.mutate({ offline_mode: value });
  };

  return (
    <UpdatesSectionShell
      hasAnyUpdate={hasAnyUpdate}
      updateCount={updateCount}
      isChecking={checkMutation.isPending}
      onCheckNow={() => checkMutation.mutate()}
      needsRestart={needsRestart}
      onRestartBackend={handleRestartBackend}
      runtimeDisplay={runtimeDisplay}
      isReadOnlyRuntime={isReadOnlyRuntime}
      lastApplyResult={lastApplyResult}
      installerUrl={installerUrl}
      onOpenInstaller={openInstaller}
      onDismissApplyResult={() => dismissApplyResultMutation.mutate()}
      isDismissApplyResultPending={dismissApplyResultMutation.isPending}
      webappRow={webappRow}
      nirs4allRow={nirs4allRow}
      onOpenWebappDialog={() => setWebappDialogOpen(true)}
      onOpenNirs4allDialog={() => setNirs4allDialogOpen(true)}
      lastCheck={status?.last_check}
      currentRuntime={currentRuntime}
      gpuDisplay={gpuDisplay}
      isRuntimeLoading={venvLoading}
      venvOpen={venvOpen}
      onVenvOpenChange={setVenvOpen}
      packageCount={venvStatus?.packages?.length || 0}
      runtimeExecutablePath={runtimeExecutablePath}
      runtimeSizeLabel={currentRuntime ? formatBytes(currentRuntime.size_bytes) : ""}
      torchDisplay={torchDisplay}
      snapshotsOpen={snapshotsOpen}
      onSnapshotsOpenChange={setSnapshotsOpen}
      snapshots={snapshotsQuery.data?.snapshots ?? []}
      canCreateSnapshot={!!currentRuntime?.is_valid}
      onCreateSnapshot={() => createSnapshotMutation.mutate(undefined)}
      isCreatingSnapshot={createSnapshotMutation.isPending}
      onRestoreSnapshot={(name) => restoreSnapshotMutation.mutate(name)}
      isRestoringSnapshot={restoreSnapshotMutation.isPending}
      onDeleteSnapshot={(name) => deleteSnapshotMutation.mutate(name)}
      isDeletingSnapshot={deleteSnapshotMutation.isPending}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      settings={settings}
      onAutoCheckToggle={handleAutoCheckToggle}
      onPrereleaseToggle={handlePrereleaseToggle}
      onOfflineModeChange={handleOfflineModeChange}
      isSettingsPending={settingsMutation.isPending}
    >
      <UpdatesWebappDialog
        open={webappDialogOpen}
        onOpenChange={(open) => {
          if (!open && (updateDownload.isDownloading || updateDownload.readyToApply)) {
            return;
          }
          if (open && hasWebappUpdate) {
            void changelogQuery.refetch();
          }
          setWebappDialogOpen(open);
        }}
        onClose={() => setWebappDialogOpen(false)}
        onApplyClick={() => setApplyConfirmOpen(true)}
        copy={webappDialogCopy}
        status={status}
        updateDownload={updateDownload}
        canApplyInPlace={canApplyInPlace}
        isChangelogLoading={changelogQuery.isLoading}
        changelogEntries={changelogQuery.data?.entries}
      />

      <UpdatesApplyConfirmDialog
        open={applyConfirmOpen}
        onOpenChange={setApplyConfirmOpen}
        latestVersion={status?.webapp?.latest_version}
        updateDownload={updateDownload}
      />

      <UpdatesNirs4allDialog
        open={nirs4allDialogOpen}
        onOpenChange={setNirs4allDialogOpen}
        status={status}
        isInstalling={installMutation.isPending}
        onInstall={() => {
          installMutation.mutate(
            { version: status?.nirs4all?.latest_version || undefined },
            {
              onSuccess: (data) => {
                setNirs4allDialogOpen(false);
                if ("requires_restart" in data && data.requires_restart) {
                  setNeedsRestart(true);
                }
              },
            }
          );
        }}
      />
    </UpdatesSectionShell>
  );
}

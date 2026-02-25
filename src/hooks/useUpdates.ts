/**
 * Update system hooks using TanStack Query
 *
 * Provides hooks for:
 * - Checking for webapp and nirs4all updates
 * - Managing update settings
 * - Managing the managed virtual environment
 * - Downloading and applying webapp updates
 */

import { useState, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getUpdateStatus,
  checkForUpdates,
  getUpdateSettings,
  updateUpdateSettings,
  getVenvStatus,
  createVenv,
  installNirs4all,
  getVersionInfo,
  startWebappDownload,
  getDownloadStatus,
  cancelDownload,
  getStagedUpdateInfo,
  applyWebappUpdate,
  cancelStagedUpdate,
  requestRestart,
  type UpdateStatus,
  type UpdateSettings,
  type VenvStatus,
  type VersionInfo,
  type DownloadStatusResponse,
} from "@/api/client";

// Query keys
export const updateKeys = {
  all: ["updates"] as const,
  status: () => [...updateKeys.all, "status"] as const,
  settings: () => [...updateKeys.all, "settings"] as const,
  venv: () => [...updateKeys.all, "venv"] as const,
  version: () => [...updateKeys.all, "version"] as const,
};

/**
 * Hook to fetch current update status
 *
 * Returns cached results, refreshes on mount and every 5 minutes
 */
export function useUpdateStatus() {
  return useQuery({
    queryKey: updateKeys.status(),
    queryFn: getUpdateStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1, // Only retry once on failure
  });
}

/**
 * Hook to force check for updates
 */
export function useCheckForUpdates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: checkForUpdates,
    onSuccess: (data: UpdateStatus) => {
      // Update the cached status
      queryClient.setQueryData(updateKeys.status(), data);
    },
  });
}

/**
 * Hook to fetch update settings
 */
export function useUpdateSettings() {
  return useQuery({
    queryKey: updateKeys.settings(),
    queryFn: getUpdateSettings,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook to update settings
 */
export function useUpdateUpdateSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Partial<UpdateSettings>) => updateUpdateSettings(settings),
    onSuccess: (data: UpdateSettings) => {
      queryClient.setQueryData(updateKeys.settings(), data);
    },
  });
}

/**
 * Hook to fetch managed venv status
 */
export function useVenvStatus() {
  return useQuery({
    queryKey: updateKeys.venv(),
    queryFn: getVenvStatus,
    staleTime: 30 * 1000, // 30 seconds
    retry: 1,
  });
}

/**
 * Hook to create the managed venv
 */
export function useCreateVenv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: { force?: boolean; install_nirs4all?: boolean; extras?: string[] }) =>
      createVenv(options),
    onSuccess: () => {
      // Invalidate venv status to refetch
      queryClient.invalidateQueries({ queryKey: updateKeys.venv() });
      // Also invalidate update status since nirs4all version may have changed
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
  });
}

/**
 * Hook to install/upgrade nirs4all
 */
export function useInstallNirs4all() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (options?: { version?: string; extras?: string[] }) =>
      installNirs4all(options),
    onSuccess: () => {
      // Invalidate queries to refetch updated versions
      queryClient.invalidateQueries({ queryKey: updateKeys.venv() });
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
  });
}

/**
 * Hook to fetch version information
 */
export function useVersionInfo() {
  return useQuery({
    queryKey: updateKeys.version(),
    queryFn: getVersionInfo,
    staleTime: Infinity, // Version info doesn't change during runtime
  });
}

/**
 * Hook to check if any updates are available
 *
 * Returns a simplified boolean + counts for quick UI indicators
 */
export function useHasUpdates() {
  const { data: status, isLoading, error } = useUpdateStatus();

  return {
    isLoading,
    error,
    hasWebappUpdate: status?.webapp?.update_available ?? false,
    hasNirs4allUpdate: status?.nirs4all?.update_available ?? false,
    hasAnyUpdate:
      (status?.webapp?.update_available ?? false) ||
      (status?.nirs4all?.update_available ?? false),
    updateCount:
      (status?.webapp?.update_available ? 1 : 0) +
      (status?.nirs4all?.update_available ? 1 : 0),
    webappVersion: status?.webapp?.current_version,
    nirs4allVersion: status?.nirs4all?.current_version,
    latestWebappVersion: status?.webapp?.latest_version,
    latestNirs4allVersion: status?.nirs4all?.latest_version,
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "Unknown size";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${units[i]}`;
}

// ============= Auto-Update Hooks =============

/**
 * Hook to manage webapp update download and apply process
 *
 * Provides:
 * - Download state tracking with progress
 * - Apply update functionality
 * - Cancel operations
 */
export function useUpdateDownload() {
  const queryClient = useQueryClient();
  const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
  const [downloadStatus, setDownloadStatus] =
    useState<DownloadStatusResponse | null>(null);
  const [isPolling, setIsPolling] = useState(false);

  // Start download mutation
  const startDownloadMutation = useMutation({
    mutationFn: startWebappDownload,
    onSuccess: (data) => {
      setDownloadJobId(data.job_id);
      setIsPolling(true);
    },
    onError: () => {
      setDownloadJobId(null);
      setIsPolling(false);
    },
  });

  // Poll for download status
  useEffect(() => {
    if (!downloadJobId || !isPolling) return;

    const pollInterval = setInterval(async () => {
      try {
        const status = await getDownloadStatus(downloadJobId);
        setDownloadStatus(status);

        // Stop polling when complete, failed, or cancelled
        if (["completed", "failed", "cancelled"].includes(status.status)) {
          setIsPolling(false);
        }
      } catch (error) {
        console.error("Failed to get download status:", error);
        setIsPolling(false);
      }
    }, 500); // Poll every 500ms

    return () => clearInterval(pollInterval);
  }, [downloadJobId, isPolling]);

  // Cancel download mutation
  const cancelDownloadMutation = useMutation({
    mutationFn: () => {
      if (!downloadJobId) throw new Error("No download in progress");
      return cancelDownload(downloadJobId);
    },
    onSuccess: () => {
      setIsPolling(false);
      setDownloadStatus(null);
      setDownloadJobId(null);
    },
  });

  // Apply update mutation
  const applyMutation = useMutation({
    mutationFn: () => applyWebappUpdate(true),
    onSuccess: () => {
      // Updater script is now running and waiting for our PID to die.
      // Quit the app so it can proceed with file copy and relaunch.
      // Brief delay so the user sees the "restarting" message.
      setTimeout(() => {
        const electronApi = (window as Record<string, unknown>).electronApi as
          | { quitForUpdate?: () => Promise<{ success: boolean }> }
          | undefined;
        if (electronApi?.quitForUpdate) {
          electronApi.quitForUpdate();
        } else {
          // Web/browser mode: tell the backend to shut down so the updater
          // script sees the PID exit and can proceed with the file copy.
          requestRestart().catch(() => {});
        }
      }, 1500);
    },
  });

  // Cancel staged update mutation
  const cancelStagedMutation = useMutation({
    mutationFn: cancelStagedUpdate,
    onSuccess: () => {
      setDownloadStatus(null);
      setDownloadJobId(null);
      queryClient.invalidateQueries({ queryKey: updateKeys.status() });
    },
  });

  // Query for staged update info
  const stagedUpdateQuery = useQuery({
    queryKey: [...updateKeys.all, "staged"],
    queryFn: getStagedUpdateInfo,
    staleTime: 10 * 1000, // 10 seconds
    enabled:
      downloadStatus?.status === "completed" ||
      downloadStatus?.result?.ready_to_apply === true,
  });

  // Reset state
  const reset = useCallback(() => {
    setDownloadJobId(null);
    setDownloadStatus(null);
    setIsPolling(false);
  }, []);

  // Derived state — isPolling is set immediately on mutation success (before
  // the first poll returns), so using it alone avoids a brief false gap that
  // would flash the "Update Available" dialog content.
  const isDownloading = startDownloadMutation.isPending || isPolling;
  const downloadProgress = downloadStatus?.progress ?? 0;
  const downloadMessage = downloadStatus?.message ?? "";
  const downloadError =
    downloadStatus?.error ?? startDownloadMutation.error?.message;
  const downloadComplete = downloadStatus?.status === "completed";
  const readyToApply =
    downloadStatus?.result?.ready_to_apply ??
    stagedUpdateQuery.data?.has_staged_update ??
    false;
  const stagedVersion =
    downloadStatus?.result?.version ?? stagedUpdateQuery.data?.version;

  return {
    // Download state
    isDownloading,
    downloadProgress,
    downloadMessage,
    downloadError,
    downloadComplete,
    readyToApply,
    stagedVersion,
    downloadJobId,

    // Actions
    startDownload: startDownloadMutation.mutate,
    cancelDownload: cancelDownloadMutation.mutate,
    applyUpdate: applyMutation.mutate,
    cancelStagedUpdate: cancelStagedMutation.mutate,
    reset,

    // Apply state
    isApplying: applyMutation.isPending,
    applyError: applyMutation.error?.message,
    applySuccess: applyMutation.isSuccess,

    // Loading states
    isStartingDownload: startDownloadMutation.isPending,
    isCancellingDownload: cancelDownloadMutation.isPending,
    isCancellingStagedUpdate: cancelStagedMutation.isPending,
  };
}

/**
 * Hook to check for staged updates on mount
 */
export function useStagedUpdate() {
  return useQuery({
    queryKey: [...updateKeys.all, "staged"],
    queryFn: getStagedUpdateInfo,
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Update system hooks using TanStack Query
 *
 * Provides hooks for:
 * - Checking for application updates
 * - Managing update settings
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import i18n from "i18next";
import { formatBytes as formatByteSize } from "@/utils/formatters";
import {
  getUpdateStatus,
  checkForUpdates,
  getUpdateSettings,
  updateUpdateSettings,
  type UpdateStatus,
  type UpdateSettings,
} from "@/api/updates";

// Query keys
export const updateKeys = {
  all: ["updates"] as const,
  status: () => [...updateKeys.all, "status"] as const,
  settings: () => [...updateKeys.all, "settings"] as const,
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
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    networkMode: "offlineFirst",
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
    retry: false,
    networkMode: "offlineFirst",
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
 * Hook to check if an application update is available
 *
 * Returns a simplified boolean + counts for quick UI indicators
 */
export function useHasUpdates() {
  const { data: status, isLoading, error } = useUpdateStatus();

  return {
    isLoading,
    error,
    hasWebappUpdate: status?.webapp?.update_available ?? false,
    hasAnyUpdate: status?.webapp?.update_available ?? false,
    updateCount: status?.webapp?.update_available ? 1 : 0,
    webappVersion: status?.webapp?.current_version,
    latestWebappVersion: status?.webapp?.latest_version,
  };
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return i18n.t("common.format.unknownSize");
  return formatByteSize(bytes);
}

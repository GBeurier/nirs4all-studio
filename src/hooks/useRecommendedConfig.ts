/**
 * Recommended config hooks using TanStack Query
 *
 * Provides hooks for:
 * - Fetching recommended config (profiles + optional packages)
 * - Comparing installed vs recommended (config diff)
 * - First-launch setup status
 * - GPU detection
 * - Aligning packages with recommended config
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRecommendedConfig,
  getConfigDiff,
  alignConfig,
  getSetupStatus,
  completeSetup,
  detectGPU,
  skipSetup,
  type RecommendedConfigResponse,
  type ConfigComparisonResponse,
  type AlignConfigRequest,
  type AlignConfigResponse,
  type SetupStatusResponse,
} from "@/api/client";

// Query keys
export const configKeys = {
  all: ["config"] as const,
  recommended: () => [...configKeys.all, "recommended"] as const,
  diff: (profile?: string) => [...configKeys.all, "diff", profile] as const,
  setupStatus: () => [...configKeys.all, "setup-status"] as const,
  gpu: () => [...configKeys.all, "gpu"] as const,
};

/**
 * Fetch recommended config (profiles + optional packages)
 */
export function useRecommendedConfig() {
  return useQuery({
    queryKey: configKeys.recommended(),
    queryFn: () => getRecommendedConfig(),
    staleTime: 24 * 60 * 60 * 1000, // 24 hours
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Compare installed packages vs. recommended config
 */
export function useConfigDiff(profile?: string, includeOptional?: boolean) {
  return useQuery({
    queryKey: [...configKeys.diff(profile), includeOptional],
    queryFn: () => getConfigDiff(profile, includeOptional),
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Align packages with recommended config
 */
export function useAlignConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: AlignConfigRequest) => alignConfig(request),
    onSuccess: () => {
      // Invalidate diff queries to refetch after alignment
      queryClient.invalidateQueries({ queryKey: configKeys.all });
    },
  });
}

/**
 * Get first-launch setup status
 */
export function useSetupStatus() {
  return useQuery({
    queryKey: configKeys.setupStatus(),
    queryFn: getSetupStatus,
    staleTime: Infinity, // Doesn't change unless we complete setup
    refetchOnWindowFocus: false,
  });
}

/**
 * Complete first-launch setup
 */
export function useCompleteSetup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ profile, optionalPackages }: { profile: string; optionalPackages?: string[] }) =>
      completeSetup(profile, optionalPackages),
    onSuccess: (data: SetupStatusResponse) => {
      queryClient.setQueryData(configKeys.setupStatus(), data);
      // Invalidate config diff since packages may have changed
      queryClient.invalidateQueries({ queryKey: configKeys.all });
    },
  });
}

/**
 * Skip first-launch setup
 */
export function useSkipSetup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: skipSetup,
    onSuccess: (data: SetupStatusResponse) => {
      queryClient.setQueryData(configKeys.setupStatus(), data);
    },
  });
}

/**
 * Detect GPU hardware
 */
export function useGPUDetection() {
  return useQuery({
    queryKey: configKeys.gpu(),
    queryFn: detectGPU,
    staleTime: Infinity, // GPU hardware doesn't change during runtime
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Quick check: is config aligned?
 */
export function useIsConfigAligned() {
  const { data: diff, isLoading, error } = useConfigDiff();

  return {
    isLoading,
    error,
    isAligned: diff?.is_aligned ?? true,
    misalignedCount: (diff?.misaligned_count ?? 0) + (diff?.missing_count ?? 0),
    profile: diff?.profile,
  };
}

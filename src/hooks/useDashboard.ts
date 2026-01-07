/**
 * Dashboard data hooks using TanStack Query
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { DashboardData, DashboardStats, RecentRun } from "@/types";
// Re-export formatRelativeTime for backward compatibility
export { formatRelativeTime } from "@/utils/formatters";

/**
 * Fetch dashboard statistics and recent runs
 */
async function fetchDashboardData(): Promise<DashboardData> {
  return api.get<DashboardData>("/dashboard");
}

/**
 * Hook to fetch dashboard data (stats + recent runs)
 */
export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboardData,
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Auto-refresh every minute
  });
}

/**
 * Hook to fetch only dashboard statistics
 */
export function useDashboardStats() {
  return useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const data = await api.get<{ stats: DashboardStats }>("/dashboard/stats");
      return data.stats;
    },
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
  });
}

/**
 * Hook to fetch recent runs
 */
export function useRecentRuns(limit: number = 6) {
  return useQuery({
    queryKey: ["dashboard", "recent-runs", limit],
    queryFn: async () => {
      const data = await api.get<{ runs: RecentRun[] }>(
        `/dashboard/recent-runs?limit=${limit}`
      );
      return data.runs;
    },
    staleTime: 15 * 1000, // More frequent updates for recent runs
    refetchInterval: 30 * 1000,
  });
}

/**
 * Dashboard data hooks using TanStack Query
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { DashboardData, DashboardStats, RecentRun } from "@/types";

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

/**
 * Format relative time from ISO date string
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else if (diffDays === 1) {
    return "Yesterday";
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Dashboard data types
 */

export interface DashboardStats {
  datasets: number;
  pipelines: number;
  runs: number;
  avgMetric: number;
  trends: {
    datasets: { value: number; direction: "up" | "down" | "neutral" };
    pipelines: { value: number; direction: "up" | "down" | "neutral" };
    runs: { value: number; direction: "up" | "down" | "neutral" };
    avgMetric: { value: number; direction: "up" | "down" | "neutral" };
  };
}

export interface RecentRun {
  id: string;
  name: string;
  dataset_name: string;
  pipeline_name: string;
  status: "completed" | "running" | "failed" | "pending";
  metric_name?: string;
  metric_value?: number;
  created_at: string;
  completed_at?: string;
}

export interface DashboardData {
  stats: DashboardStats;
  recent_runs: RecentRun[];
}

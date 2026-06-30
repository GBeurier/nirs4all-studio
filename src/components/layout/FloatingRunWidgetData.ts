import type { RunProgressState } from "@/context/useActiveRuns";

export const RECENT_RUN_LOG_LIMIT = 3;

export interface FloatingRunWidgetRunItemReadModel {
  runId: string;
  runName: string;
  message: string;
  progress: number;
  progressLabel: string;
  containerClassName: string;
}

export interface FloatingRunWidgetReadModel {
  isVisible: boolean;
  selectedRun: RunProgressState | undefined;
  minimizedBadgeCount: number;
  runItems: FloatingRunWidgetRunItemReadModel[];
  recentLogs: string[];
  detailPath: string | null;
  showRunSelector: boolean;
  showSingleRunSummary: boolean;
  showRecentLogs: boolean;
}

export function shouldShowFloatingRunWidget(pathname: string, hasActiveRuns: boolean): boolean {
  if (!hasActiveRuns) return false;

  return !(pathname.startsWith("/runs/") && pathname !== "/runs/");
}

export function selectFloatingRun(
  activeRuns: readonly RunProgressState[],
  selectedRunId: string | null,
): RunProgressState | undefined {
  return activeRuns.find((run) => run.runId === selectedRunId) ?? activeRuns[0];
}

export function getMinimizedBadgeCount(activeRuns: readonly RunProgressState[]): number {
  return activeRuns.length;
}

export function buildRunItemReadModel(
  run: RunProgressState,
  isSelected: boolean,
): FloatingRunWidgetRunItemReadModel {
  return {
    runId: run.runId,
    runName: run.runName,
    message: run.message,
    progress: run.progress,
    progressLabel: `${run.progress}%`,
    containerClassName: isSelected
      ? "bg-chart-2/10 border border-chart-2/30"
      : "hover:bg-muted/50",
  };
}

export function getRecentRunLogs(
  logs: readonly string[],
  limit = RECENT_RUN_LOG_LIMIT,
): string[] {
  return logs.slice(-limit);
}

export function getRunDetailPath(runId: string | undefined): string | null {
  return runId ? `/runs/${runId}` : null;
}

export function buildFloatingRunWidgetReadModel({
  pathname,
  hasActiveRuns,
  activeRuns,
  selectedRunId,
}: {
  pathname: string;
  hasActiveRuns: boolean;
  activeRuns: readonly RunProgressState[];
  selectedRunId: string | null;
}): FloatingRunWidgetReadModel {
  const selectedRun = selectFloatingRun(activeRuns, selectedRunId);
  const isVisible = shouldShowFloatingRunWidget(pathname, hasActiveRuns);
  const recentLogs = selectedRun ? getRecentRunLogs(selectedRun.logs) : [];

  return {
    isVisible,
    selectedRun,
    minimizedBadgeCount: getMinimizedBadgeCount(activeRuns),
    runItems: activeRuns.map((run) => buildRunItemReadModel(run, run.runId === selectedRun?.runId)),
    recentLogs,
    detailPath: getRunDetailPath(selectedRun?.runId),
    showRunSelector: activeRuns.length > 1,
    showSingleRunSummary: activeRuns.length === 1 && Boolean(selectedRun),
    showRecentLogs: recentLogs.length > 0,
  };
}

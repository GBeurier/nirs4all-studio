import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RunDetailSheet } from "@/components/runs/RunDetailSheet";
import { useMetricSelection } from "@/components/scores/useMetricSelection";
import {
  RunsExecutionJobRecordDialog,
  RunsExecutionTasksPanel,
  RunsList,
  RunsPageHeader,
  RunsStatsGrid,
} from "./RunsSections";
import {
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getLegacySelectedMetricsForTaskTypes,
} from "@/lib/scores";
import {
  buildRunPageIdLookup,
  buildRunsExecutionJobListItems,
  buildRunsExecutionTaskPanelData,
  buildRunsMetricSelectionContext,
  buildRunsPageItems,
  getExecutionJobRecordDetailRefetchInterval,
  summarizeRunsPageStats,
} from "@/lib/runs/pageData";
import type { EnrichedRun } from "@/types/enriched-runs";
import { formatApiErrorDetail } from "@/api/transport";
import {
  cancelExecutionJobRecord,
  getWorkspaceExecutionJobRecord,
  listRunExecutionJobRecords,
  listRuns,
  retryRun,
} from "@/api/runs";
import { getEnrichedRuns } from "@/api/enrichedRuns";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";

function formatRunsErrorMessage(error: unknown): string | null {
  if (!error) return null;

  return formatApiErrorDetail(
    typeof error === "object" && error && "detail" in error
      ? (error as { detail: unknown }).detail
      : error,
  );
}

export default function Runs() {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailRun, setDetailRun] = useState<EnrichedRun | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [inspectedExecutionJobId, setInspectedExecutionJobId] = useState<string | null>(null);

  const { data: workspacesData } = useLinkedWorkspacesQuery();

  const activeWorkspaceId = workspacesData?.active_workspace_id ?? undefined;

  const {
    data: enrichedData,
    isLoading: isLoadingEnriched,
    error: enrichedError,
    refetch: refetchEnrichedRuns,
  } = useQuery({
    queryKey: ["enriched-runs", activeWorkspaceId, selectedProjectId],
    queryFn: () => getEnrichedRuns(activeWorkspaceId!, selectedProjectId ?? undefined),
    enabled: !!activeWorkspaceId,
    staleTime: 30000,
    refetchInterval: 30000,
  });

  const { data: activeRunsData } = useQuery({
    queryKey: ["runs"],
    queryFn: listRuns,
    staleTime: 5000,
    refetchInterval: 10000,
  });

  const { data: executionJobRecordsData } = useQuery({
    queryKey: ["runs", "execution-job-records", activeWorkspaceId],
    queryFn: () => listRunExecutionJobRecords({ include_orphaned: true }),
    enabled: !!activeWorkspaceId,
    staleTime: 5000,
    refetchInterval: 10000,
  });

  const {
    data: inspectedExecutionJobRecord = null,
    error: inspectedExecutionJobError,
    isLoading: isLoadingInspectedExecutionJob,
  } = useQuery({
    queryKey: ["runs", "execution-job-record-detail", inspectedExecutionJobId],
    queryFn: () => getWorkspaceExecutionJobRecord(inspectedExecutionJobId!),
    enabled: inspectedExecutionJobId != null,
    staleTime: 5000,
    refetchInterval: (query) => getExecutionJobRecordDetailRefetchInterval(query.state.data),
  });

  const runs = useMemo(
    () => buildRunsPageItems(enrichedData?.runs, activeRunsData?.runs),
    [enrichedData, activeRunsData],
  );

  const executionJobIndicators = useMemo(() => {
    return new Map(
      buildRunsExecutionJobListItems(runs, executionJobRecordsData?.records)
        .map(item => [item.runId, item.execution]),
    );
  }, [runs, executionJobRecordsData]);

  const executionTaskPanelData = useMemo(
    () => buildRunsExecutionTaskPanelData(executionJobRecordsData?.records),
    [executionJobRecordsData],
  );

  const runPageIdLookup = useMemo(
    () => buildRunPageIdLookup(activeRunsData?.runs),
    [activeRunsData],
  );

  const isLoading = isLoadingEnriched;
  const hasActiveWorkspace = !!activeWorkspaceId;
  const enrichedErrorMessage = formatRunsErrorMessage(enrichedError);
  const inspectedExecutionJobErrorMessage = formatRunsErrorMessage(inspectedExecutionJobError);
  const refreshRunExecutionData = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["runs"] }),
      queryClient.invalidateQueries({ queryKey: ["enriched-runs"] }),
    ]);
  };
  const cancelExecutionJobRecordMutation = useMutation({
    mutationFn: cancelExecutionJobRecord,
    onSuccess: refreshRunExecutionData,
  });
  const retryExecutionJobRunMutation = useMutation({
    mutationFn: retryRun,
    onSuccess: refreshRunExecutionData,
  });
  const executionJobActionErrorMessage = formatRunsErrorMessage(
    cancelExecutionJobRecordMutation.error ?? retryExecutionJobRunMutation.error,
  );
  const pendingExecutionJobAction = cancelExecutionJobRecordMutation.isPending
    ? "cancel"
    : retryExecutionJobRunMutation.isPending
      ? "retry"
      : null;

  const metricContext = useMemo(
    () => buildRunsMetricSelectionContext(runs),
    [runs],
  );

  const [selectedMetrics, setSelectedMetrics] = useMetricSelection(
    "runs",
    metricContext.taskType,
    getDefaultSelectedMetricsForTaskTypes(metricContext.taskTypes),
    getLegacySelectedMetricsForTaskTypes(metricContext.taskTypes),
    "task-aware-defaults-v1",
    metricContext.availableMetricKeys,
    getDefaultSelectionUpgradeCandidatesForTaskTypes(metricContext.taskTypes),
  );

  const stats = useMemo(() => summarizeRunsPageStats(runs), [runs]);

  const handleViewDetails = (enrichedRun: EnrichedRun) => {
    setDetailRun(enrichedRun);
    setSheetOpen(true);
  };

  return (
    <div className="p-6 space-y-5">
      <RunsPageHeader
        metricContext={metricContext}
        selectedMetrics={selectedMetrics}
        onSelectedMetricsChange={setSelectedMetrics}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
      />

      <RunsStatsGrid stats={stats} />

      <RunsExecutionTasksPanel
        data={executionTaskPanelData}
        onInspectJob={setInspectedExecutionJobId}
      />

      <RunsExecutionJobRecordDialog
        open={inspectedExecutionJobId != null}
        onOpenChange={(open) => {
          if (!open) setInspectedExecutionJobId(null);
        }}
        jobId={inspectedExecutionJobId}
        record={inspectedExecutionJobRecord}
        isLoading={isLoadingInspectedExecutionJob}
        errorMessage={inspectedExecutionJobErrorMessage}
        actionErrorMessage={executionJobActionErrorMessage}
        pendingAction={pendingExecutionJobAction}
        onCancelJob={(jobId) => cancelExecutionJobRecordMutation.mutate(jobId)}
        onRetryRun={(runId) => retryExecutionJobRunMutation.mutate(runId)}
      />

      <RunsList
        isLoading={isLoading}
        hasActiveWorkspace={hasActiveWorkspace}
        errorMessage={enrichedErrorMessage}
        runs={runs}
        onRetry={refetchEnrichedRuns}
        onViewDetails={handleViewDetails}
        workspaceId={activeWorkspaceId}
        selectedMetrics={selectedMetrics}
        executionJobIndicators={executionJobIndicators}
      />

      <RunDetailSheet
        run={detailRun}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        workspaceId={activeWorkspaceId!}
        runPageId={detailRun ? runPageIdLookup.get(detailRun.run_id) ?? null : null}
        selectedMetrics={selectedMetrics}
      />
    </div>
  );
}

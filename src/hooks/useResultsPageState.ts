import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getDefaultSelectedMetricsForTaskTypes,
  getDefaultSelectionUpgradeCandidatesForTaskTypes,
  getLegacySelectedMetricsForTaskTypes,
} from "@/lib/scores";
import {
  buildResultsDatasetView,
  buildResultsMetricSelectionContext,
} from "@/lib/resultsPageData";
import { getWorkspaceResultsSummary } from "@/api/linkedWorkspaces";
import { useMetricSelection } from "@/components/scores/useMetricSelection";
import { useLinkedWorkspacesQuery } from "@/hooks/useDatasetQueries";
import type { DatasetTopChains } from "@/types/runs";
import { useMlReadiness } from "@/context/useMlReadiness";

export function useResultsPageState() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const { mlReady, workspaceReady } = useMlReadiness();
  const { data: workspacesData, isLoading: workspacesLoading, error: workspaceError, refetch: refetchWorkspaces } = useLinkedWorkspacesQuery();
  const activeWorkspace = workspacesData?.workspaces.find((workspace) => workspace.is_active) ?? null;

  const {
    data: summaryData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["results-summary", activeWorkspace?.id],
    queryFn: () => getWorkspaceResultsSummary(activeWorkspace!.id),
    enabled: !!activeWorkspace && mlReady && workspaceReady,
    staleTime: 30000,
    refetchOnMount: "always",
  });

  const datasets = useMemo<DatasetTopChains[]>(
    () => summaryData?.datasets ?? [],
    [summaryData],
  );

  const datasetView = useMemo(
    () => buildResultsDatasetView(datasets, searchQuery),
    [datasets, searchQuery],
  );

  const metricContext = useMemo(
    () => buildResultsMetricSelectionContext(datasetView.metricSourceDatasets, activeWorkspace),
    [activeWorkspace, datasetView.metricSourceDatasets],
  );

  const [selectedMetrics, setSelectedMetrics] = useMetricSelection(
    "results",
    metricContext.taskType,
    getDefaultSelectedMetricsForTaskTypes(metricContext.taskTypes),
    getLegacySelectedMetricsForTaskTypes(metricContext.taskTypes),
    "task-aware-defaults-v1",
    metricContext.availableMetricKeys,
    getDefaultSelectionUpgradeCandidatesForTaskTypes(metricContext.taskTypes),
  );

  return {
    activeWorkspace,
    adaptedDatasets: datasetView.adaptedDatasets,
    datasets,
    filteredDatasets: datasetView.filteredDatasets,
    isLoading: workspacesLoading || isLoading,
    error: error ?? workspaceError,
    metricContext,
    refetch: async () => {
      if (!activeWorkspace) {
        await refetchWorkspaces();
        return;
      }
      if (!mlReady || !workspaceReady) return;
      await Promise.all([
        refetch(),
        queryClient.invalidateQueries({ queryKey: ["dataset-all-chains", activeWorkspace?.id] }),
      ]);
    },
    searchQuery,
    selectedMetrics,
    setSearchQuery,
    setSelectedMetrics,
  };
}

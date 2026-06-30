import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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

export function useResultsPageState() {
  const [searchQuery, setSearchQuery] = useState("");
  const { data: workspacesData } = useLinkedWorkspacesQuery();
  const activeWorkspace = workspacesData?.workspaces.find((workspace) => workspace.is_active) ?? null;

  const {
    data: summaryData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["results-summary", activeWorkspace?.id],
    queryFn: () => getWorkspaceResultsSummary(activeWorkspace!.id),
    enabled: !!activeWorkspace,
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
    isLoading,
    metricContext,
    refetch,
    searchQuery,
    selectedMetrics,
    setSearchQuery,
    setSelectedMetrics,
  };
}

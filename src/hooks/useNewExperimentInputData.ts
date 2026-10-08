import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listPipelines, type PipelineInfo } from "@/api/pipelines";
import { listRunPipelines } from "@/api/runs";
import { useDatasetsQuery } from "@/hooks/useDatasetQueries";
import {
  filterExperimentDatasets,
  filterExperimentPipelines,
  type PipelineFilterMode,
} from "@/lib/experimentInputFilters";
import {
  toExperimentPipelineOption,
  type ExperimentPipelineOption,
} from "@/lib/experimentPipelineSelection";
import {
  toExperimentDatasetOption,
  type ExperimentDatasetOption,
} from "@/lib/experimentDatasetOptions";
import type { Dataset } from "@/types/datasets";

export interface NewExperimentInputData {
  datasets: ExperimentDatasetOption[];
  datasetsError: unknown;
  isLoadingDatasets: boolean;
  isLoadingPipelines: boolean;
  pipelineError: unknown;
  pipelines: ExperimentPipelineOption[];
  rawDatasets: Dataset[];
  rawPipelines: PipelineInfo[];
}

export interface UseNewExperimentFilteredInputsInput {
  allPipelineOptions: ExperimentPipelineOption[];
  datasetSearch: string;
  datasets: ExperimentDatasetOption[];
  pipelineFilter: PipelineFilterMode;
  pipelineSearch: string;
}

export interface UseNewExperimentFilteredInputsResult {
  filteredDatasets: ExperimentDatasetOption[];
  filteredPipelines: ExperimentPipelineOption[];
}

export function mergeExperimentPipelineSources(
  savedPipelines: PipelineInfo[],
  historicalPipelines: PipelineInfo[],
): PipelineInfo[] {
  const merged = [...savedPipelines];
  // Route selections refer to identities, even when two pipelines have the same steps.
  const seenIds = new Set(savedPipelines.map((pipeline) => pipeline.id));

  for (const pipeline of historicalPipelines) {
    if (seenIds.has(pipeline.id)) continue;
    seenIds.add(pipeline.id);
    merged.push({ ...pipeline, source: "history" });
  }

  return merged;
}

export function useNewExperimentInputData(): NewExperimentInputData {
  const { data: datasetsData, isLoading: isLoadingDatasets, error: datasetsError } = useDatasetsQuery();
  const { data: savedPipelinesData, isLoading: isLoadingSavedPipelines, error: savedPipelineError } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => listPipelines(),
    staleTime: 0,
    refetchOnMount: "always",
  });
  const { data: historicalPipelinesData, isLoading: isLoadingHistoricalPipelines, error: historyPipelineError } = useQuery({
    queryKey: ["run-pipelines"],
    queryFn: () => listRunPipelines(),
    // Saved pipelines must be visible before the more expensive history translation starts.
    enabled: savedPipelinesData != null,
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const rawDatasets = useMemo(
    () => (datasetsData?.datasets ?? []) as Dataset[],
    [datasetsData],
  );
  const datasets = useMemo(
    () => rawDatasets.map(toExperimentDatasetOption),
    [rawDatasets],
  );
  const rawPipelines = useMemo(
    () => mergeExperimentPipelineSources(
      (savedPipelinesData?.pipelines ?? []) as PipelineInfo[],
      (historicalPipelinesData?.pipelines ?? []) as PipelineInfo[],
    ),
    [historicalPipelinesData, savedPipelinesData],
  );
  const pipelines = useMemo(
    () => rawPipelines.map(toExperimentPipelineOption),
    [rawPipelines],
  );

  return {
    datasets,
    datasetsError,
    isLoadingDatasets,
    isLoadingPipelines: isLoadingSavedPipelines || (rawPipelines.length === 0 && isLoadingHistoricalPipelines),
    pipelineError: savedPipelineError ?? (rawPipelines.length === 0 ? historyPipelineError : null),
    pipelines,
    rawDatasets,
    rawPipelines,
  };
}

export function useNewExperimentFilteredInputs({
  allPipelineOptions,
  datasetSearch,
  datasets,
  pipelineFilter,
  pipelineSearch,
}: UseNewExperimentFilteredInputsInput): UseNewExperimentFilteredInputsResult {
  const filteredDatasets = useMemo(
    () => filterExperimentDatasets(datasets, datasetSearch),
    [datasetSearch, datasets],
  );
  const filteredPipelines = useMemo(
    () => filterExperimentPipelines(allPipelineOptions, pipelineSearch, pipelineFilter),
    [allPipelineOptions, pipelineFilter, pipelineSearch],
  );

  return {
    filteredDatasets,
    filteredPipelines,
  };
}

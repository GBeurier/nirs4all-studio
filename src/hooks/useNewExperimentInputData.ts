import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { listPipelines, type PipelineInfo } from "@/api/pipelines";
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

export function useNewExperimentInputData(): NewExperimentInputData {
  const { data: datasetsData, isLoading: isLoadingDatasets, error: datasetsError } = useDatasetsQuery();
  const { data: pipelinesData, isLoading: isLoadingPipelines, error: pipelineError } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => listPipelines(),
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
    () => (pipelinesData?.pipelines ?? []) as PipelineInfo[],
    [pipelinesData],
  );
  const pipelines = useMemo(
    () => rawPipelines.map(toExperimentPipelineOption),
    [rawPipelines],
  );

  return {
    datasets,
    datasetsError,
    isLoadingDatasets,
    isLoadingPipelines,
    pipelineError,
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

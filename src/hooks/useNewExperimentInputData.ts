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

function stablePipelineStepsKey(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stablePipelineStepsKey).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stablePipelineStepsKey(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function mergeExperimentPipelineSources(
  savedPipelines: PipelineInfo[],
  historicalPipelines: PipelineInfo[],
): PipelineInfo[] {
  const merged = [...savedPipelines];
  const seenSteps = new Set(savedPipelines.map((pipeline) => stablePipelineStepsKey(pipeline.steps)));

  for (const pipeline of historicalPipelines) {
    const stepsKey = stablePipelineStepsKey(pipeline.steps);
    if (seenSteps.has(stepsKey)) continue;
    seenSteps.add(stepsKey);
    merged.push({ ...pipeline, source: "history" });
  }

  return merged;
}

export function useNewExperimentInputData(): NewExperimentInputData {
  const { data: datasetsData, isLoading: isLoadingDatasets, error: datasetsError } = useDatasetsQuery();
  const { data: savedPipelinesData, isLoading: isLoadingPipelines, error: pipelineError } = useQuery({
    queryKey: ["pipelines"],
    queryFn: () => listPipelines(),
  });
  const { data: historicalPipelinesData } = useQuery({
    queryKey: ["run-pipelines"],
    queryFn: () => listRunPipelines(),
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

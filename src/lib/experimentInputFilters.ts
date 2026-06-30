import type { ExperimentDatasetOption } from "./experimentDatasetOptions";
import type { ExperimentPipelineOption } from "./experimentPipelineSelection";
import {
  buildExperimentDatasetSelectionDetails,
  buildExperimentPipelineSelectionDetails,
} from "./experimentSelectionPresentation";

export type PipelineFilterMode = "all" | "favorites" | "presets";

export function buildExperimentDatasetSearchText(dataset: ExperimentDatasetOption): string {
  const details = buildExperimentDatasetSelectionDetails(dataset);
  return [
    dataset.name,
    dataset.target,
    dataset.dataViewLabel,
    dataset.metadataColumns.join(" "),
    dataset.repetitionColumn,
    dataset.aggregationLabel,
    details.sourceLabel,
    details.sourceModeLabel,
    details.representationLabel,
    details.dataViewTaskLabel,
    details.targetCountLabel,
    details.metadataLabel,
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

export function buildExperimentPipelineSearchText(pipeline: ExperimentPipelineOption): string {
  const details = buildExperimentPipelineSelectionDetails(pipeline);
  return [
    pipeline.name,
    details.stepSummaryLabel,
    details.graphReadinessLabel,
    details.nodeLabel,
    details.branchLabel,
    details.generatorLabel,
    details.depthLabel,
    ...details.complexityLabels,
  ].filter((value): value is string => Boolean(value)).join(" ").toLowerCase();
}

export function filterExperimentDatasets(
  datasets: ExperimentDatasetOption[],
  searchQuery: string,
): ExperimentDatasetOption[] {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  if (!normalizedSearch) return datasets;
  return datasets.filter((dataset) =>
    buildExperimentDatasetSearchText(dataset).includes(normalizedSearch),
  );
}

export function filterExperimentPipelines(
  pipelines: ExperimentPipelineOption[],
  searchQuery: string,
  filterMode: PipelineFilterMode,
): ExperimentPipelineOption[] {
  const normalizedSearch = searchQuery.trim().toLowerCase();

  return pipelines.filter((pipeline) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      buildExperimentPipelineSearchText(pipeline).includes(normalizedSearch);

    if (pipeline.isCurrentEdited) return matchesSearch;
    if (filterMode === "favorites") return matchesSearch && pipeline.favorite;
    if (filterMode === "presets") return matchesSearch && pipeline.preset;
    return matchesSearch;
  });
}

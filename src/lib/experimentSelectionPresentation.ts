import type { ExperimentDatasetOption } from "./experimentDatasetOptions";
import type { ExperimentPipelineOption } from "./experimentPipelineSelection";
import {
  formatDatasetSchemaTaskTypeLabel,
  formatDatasetSourceModeLabel,
  formatDatasetTargetCountLabel,
} from "./datasetSchemaDisplay";

export const experimentSelectionCopy = {
  datasetsTitle: "Select Datasets",
  pipelinesTitle: "Select Pipelines",
  datasetSearchPlaceholder: "Search datasets...",
  pipelineSearchPlaceholder: "Search pipelines...",
  datasetLoadingMessage: "Loading datasets...",
  pipelineLoadingMessage: "Loading pipelines...",
  datasetLoadErrorFallback: "Failed to load datasets",
  pipelineLoadErrorFallback: "Failed to load pipelines",
  datasetEmptyTitle: "No datasets available",
  datasetEmptyDescription: "Link a workspace with datasets in Settings, or import a dataset.",
  datasetEmptyActionLabel: "Go to Settings",
  datasetEmptyActionPath: "/settings",
  pipelineEmptyTitle: "No pipelines available",
  pipelineEmptyDescription: "Create a pipeline in the Pipeline Editor first.",
  pipelineEmptyActionLabel: "Create Pipeline",
  pipelineEmptyActionPath: "/pipelines/new",
  pipelineFilterAll: "All Pipelines",
  pipelineFilterFavorites: "Favorites",
  pipelineFilterPresets: "Presets",
  pipelinePresetBadge: "Preset",
} as const;

export interface ExperimentDatasetSelectionDetails {
  sampleLabel: string;
  splitLabel: string | null;
  featureLabel: string;
  sourceLabel: string;
  sourceModeLabel: string;
  representationLabel: string;
  dataViewLabel: string;
  dataViewTaskLabel: string;
  targetLabel: string;
  targetCountLabel: string;
  metadataLabel: string;
  repetitionLabel: string | null;
  aggregationLabel: string | null;
}

export interface ExperimentPipelineSelectionBadges {
  showFavorite: boolean;
  showPreset: boolean;
}

export interface ExperimentPipelineSelectionDetails {
  stepSummaryLabel: string;
  graphReadinessLabel: string;
  nodeLabel: string;
  branchLabel: string | null;
  generatorLabel: string | null;
  depthLabel: string | null;
  complexityLabels: string[];
}

export function formatExperimentSelectionCount(selectedCount: number): string {
  return `${selectedCount} selected`;
}

export function getExperimentSelectionErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

export function formatNoExperimentDatasetSearchMatch(searchQuery: string): string {
  return `No datasets match "${searchQuery}"`;
}

export function formatNoExperimentPipelineSearchMatch(searchQuery: string): string {
  return `No pipelines match "${searchQuery}"`;
}

function formatCount(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatOptionalCount(
  count: number | null | undefined,
  singular: string,
  plural = `${singular}s`,
): string {
  if (typeof count !== "number") return `Unknown ${plural}`;
  return formatCount(count, singular, plural);
}

export function buildExperimentDatasetSelectionDetails(
  dataset: ExperimentDatasetOption,
): ExperimentDatasetSelectionDetails {
  return {
    sampleLabel: `${dataset.samples} samples`,
    splitLabel: dataset.testSamples != null && dataset.testSamples > 0
      ? `(${dataset.trainSamples?.toLocaleString() ?? "—"} train · ${dataset.testSamples.toLocaleString()} test)`
      : null,
    featureLabel: `${dataset.features} features`,
    sourceLabel: formatOptionalCount(dataset.sourceCount, "source"),
    sourceModeLabel: formatDatasetSourceModeLabel(dataset.isMultiSource),
    representationLabel: formatCount(dataset.representationCount, "representation"),
    dataViewLabel: `View: ${dataset.dataViewLabel}`,
    dataViewTaskLabel: `Task: ${formatDatasetSchemaTaskTypeLabel(dataset.dataViewTaskType)}`,
    targetLabel: `Target: ${dataset.target}`,
    targetCountLabel: formatDatasetTargetCountLabel(dataset.targetCount),
    metadataLabel: `Metadata: ${dataset.metadataColumns.length || 0} columns`,
    repetitionLabel: dataset.repetitionColumn ? `Repetition: ${dataset.repetitionColumn}` : null,
    aggregationLabel: dataset.aggregationLabel,
  };
}

export function buildExperimentDatasetSelectionChipLabels(
  details: ExperimentDatasetSelectionDetails,
): string[] {
  return [
    details.sourceLabel,
    details.sourceModeLabel,
    details.representationLabel,
    details.dataViewLabel,
    details.dataViewTaskLabel,
    details.targetCountLabel,
    details.metadataLabel,
    details.repetitionLabel,
    details.aggregationLabel,
  ].filter((label): label is string => Boolean(label));
}

export function buildExperimentPipelineSelectionBadges(
  pipeline: ExperimentPipelineOption,
): ExperimentPipelineSelectionBadges {
  return {
    showFavorite: Boolean(pipeline.favorite),
    showPreset: Boolean(pipeline.preset),
  };
}

export function formatExperimentPipelineGraphReadiness(
  pipeline: Pick<ExperimentPipelineOption, "nodeCount" | "activeNodeCount" | "disabledNodeCount">,
): string {
  if (pipeline.nodeCount === 0) return "Empty graph";
  if (pipeline.activeNodeCount === 0) return "No active nodes";
  if (pipeline.disabledNodeCount > 0) return "Graph has disabled nodes";
  return "Graph ready";
}

export function buildExperimentPipelineSelectionDetails(
  pipeline: ExperimentPipelineOption,
): ExperimentPipelineSelectionDetails {
  const nodeLabel = pipeline.disabledNodeCount > 0
    ? `${pipeline.activeNodeCount}/${pipeline.nodeCount} active nodes`
    : formatCount(pipeline.nodeCount, "node");
  const complexityLabels = [
    pipeline.stepGeneratorCount > 0 ? formatCount(pipeline.stepGeneratorCount, "step generator") : null,
    pipeline.parameterSweepCount > 0 ? formatCount(pipeline.parameterSweepCount, "parameter sweep") : null,
    pipeline.finetuneNodeCount > 0 ? formatCount(pipeline.finetuneNodeCount, "finetune node") : null,
    pipeline.refitNodeCount > 0 ? formatCount(pipeline.refitNodeCount, "refit node") : null,
  ].filter((label): label is string => Boolean(label));

  return {
    stepSummaryLabel: pipeline.steps,
    graphReadinessLabel: formatExperimentPipelineGraphReadiness(pipeline),
    nodeLabel,
    branchLabel: pipeline.branchCount > 0 ? formatCount(pipeline.branchCount, "branch", "branches") : null,
    generatorLabel: pipeline.generatorCount > 0 ? formatCount(pipeline.generatorCount, "generator") : null,
    depthLabel: pipeline.maxDepth > 0 ? `Depth ${pipeline.maxDepth + 1}` : null,
    complexityLabels,
  };
}

export function buildExperimentPipelineSelectionChipLabels(
  details: ExperimentPipelineSelectionDetails,
): string[] {
  return [
    details.graphReadinessLabel,
    details.nodeLabel,
    details.branchLabel,
    details.generatorLabel,
    details.depthLabel,
    ...details.complexityLabels,
  ].filter((label): label is string => Boolean(label));
}

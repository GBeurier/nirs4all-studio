import i18n from "i18next";

import type { ExperimentDatasetOption } from "./experimentDatasetOptions";
import type { ExperimentPipelineOption } from "./experimentPipelineSelection";
import {
  formatDatasetSchemaTaskTypeLabel,
  formatDatasetSourceModeLabel,
  formatDatasetTargetCountLabel,
} from "./datasetSchemaDisplay";
import { getActiveLocale } from "@/lib/activeLocale";

/** User-visible copy of the selection steps; getters resolve the active language at read time. */
export const experimentSelectionCopy = {
  get datasetsTitle() { return i18n.t("newExperiment.steps.selectDatasets"); },
  get pipelinesTitle() { return i18n.t("newExperiment.steps.selectPipelines"); },
  get datasetSearchPlaceholder() { return i18n.t("newExperiment.filters.searchDatasets"); },
  get pipelineSearchPlaceholder() { return i18n.t("newExperiment.filters.searchPipelines"); },
  get datasetLoadingMessage() { return i18n.t("newExperiment.selection.datasetLoading"); },
  get pipelineLoadingMessage() { return i18n.t("newExperiment.selection.pipelineLoading"); },
  get datasetLoadErrorFallback() { return i18n.t("newExperiment.selection.datasetLoadError"); },
  get pipelineLoadErrorFallback() { return i18n.t("newExperiment.selection.pipelineLoadError"); },
  get datasetEmptyTitle() { return i18n.t("newExperiment.selection.datasetEmptyTitle"); },
  get datasetEmptyDescription() { return i18n.t("newExperiment.selection.datasetEmptyDescription"); },
  get datasetEmptyActionLabel() { return i18n.t("newExperiment.selection.datasetEmptyAction"); },
  datasetEmptyActionPath: "/settings",
  get pipelineEmptyTitle() { return i18n.t("newExperiment.selection.pipelineEmptyTitle"); },
  get pipelineEmptyDescription() { return i18n.t("newExperiment.selection.pipelineEmptyDescription"); },
  get pipelineEmptyActionLabel() { return i18n.t("newExperiment.selection.pipelineEmptyAction"); },
  pipelineEmptyActionPath: "/pipelines/new",
  get pipelineFilterAll() { return i18n.t("newExperiment.tabs.allPipelines"); },
  get pipelineFilterFavorites() { return i18n.t("newExperiment.tabs.favorites"); },
  get pipelineFilterPresets() { return i18n.t("newExperiment.tabs.presets"); },
  get pipelinePresetBadge() { return i18n.t("newExperiment.selection.presetBadge"); },
  get pipelineHistoryBadge() { return i18n.t("newExperiment.selection.historyBadge"); },
};

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
  showHistory: boolean;
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
  return i18n.t("newExperiment.selection.selectedCount", { count: selectedCount });
}

export function getExperimentSelectionErrorMessage(
  error: unknown,
  fallback: string,
): string {
  return error instanceof Error ? error.message : fallback;
}

export function formatNoExperimentDatasetSearchMatch(searchQuery: string): string {
  return i18n.t("newExperiment.selection.noDatasetMatch", { query: searchQuery });
}

export function formatNoExperimentPipelineSearchMatch(searchQuery: string): string {
  return i18n.t("newExperiment.selection.noPipelineMatch", { query: searchQuery });
}

function formatCount(key: string, count: number): string {
  return i18n.t(`newExperiment.counts.${key}`, { count });
}

export function buildExperimentDatasetSelectionDetails(
  dataset: ExperimentDatasetOption,
): ExperimentDatasetSelectionDetails {
  return {
    sampleLabel: formatCount("sample", dataset.samples),
    splitLabel: dataset.testSamples != null && dataset.testSamples > 0
      ? i18n.t("newExperiment.selection.dataset.split", {
        train: dataset.trainSamples?.toLocaleString(getActiveLocale()) ?? "—",
        test: dataset.testSamples.toLocaleString(getActiveLocale()),
      })
      : null,
    featureLabel: dataset.multimodalSummary
      ? formatCount("modality", dataset.multimodalSummary.sources.length)
      : formatCount("feature", dataset.features),
    sourceLabel: typeof dataset.sourceCount === "number"
      ? formatCount("source", dataset.sourceCount)
      : i18n.t("newExperiment.unknownCount.source"),
    sourceModeLabel: formatDatasetSourceModeLabel(dataset.isMultiSource),
    representationLabel: formatCount("representation", dataset.representationCount),
    dataViewLabel: i18n.t("newExperiment.selection.dataset.view", { value: dataset.dataViewLabel }),
    dataViewTaskLabel: i18n.t("newExperiment.selection.dataset.task", { value: formatDatasetSchemaTaskTypeLabel(dataset.dataViewTaskType) }),
    targetLabel: i18n.t("newExperiment.selection.dataset.target", { value: dataset.target }),
    targetCountLabel: formatDatasetTargetCountLabel(dataset.targetCount),
    metadataLabel: i18n.t("newExperiment.selection.dataset.metadata", { count: dataset.metadataColumns.length || 0 }),
    repetitionLabel: dataset.repetitionColumn
      ? i18n.t("newExperiment.selection.dataset.repetition", { value: dataset.repetitionColumn })
      : null,
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
    showHistory: Boolean(pipeline.isHistory),
    showPreset: Boolean(pipeline.preset),
  };
}

export function formatExperimentPipelineGraphReadiness(
  pipeline: Pick<ExperimentPipelineOption, "nodeCount" | "activeNodeCount" | "disabledNodeCount">,
): string {
  if (pipeline.nodeCount === 0) return i18n.t("newExperiment.selection.pipeline.emptyGraph");
  if (pipeline.activeNodeCount === 0) return i18n.t("newExperiment.selection.pipeline.noActiveNodes");
  if (pipeline.disabledNodeCount > 0) return i18n.t("newExperiment.selection.pipeline.disabledNodes");
  return i18n.t("newExperiment.selection.pipeline.graphReady");
}

export function buildExperimentPipelineSelectionDetails(
  pipeline: ExperimentPipelineOption,
): ExperimentPipelineSelectionDetails {
  const nodeLabel = pipeline.disabledNodeCount > 0
    ? i18n.t("newExperiment.selection.pipeline.activeNodes", { active: pipeline.activeNodeCount, total: pipeline.nodeCount })
    : formatCount("node", pipeline.nodeCount);
  const complexityLabels = [
    pipeline.stepGeneratorCount > 0 ? formatCount("stepGenerator", pipeline.stepGeneratorCount) : null,
    pipeline.parameterSweepCount > 0 ? formatCount("parameterSweep", pipeline.parameterSweepCount) : null,
    pipeline.finetuneNodeCount > 0 ? formatCount("finetuneNode", pipeline.finetuneNodeCount) : null,
    pipeline.refitNodeCount > 0 ? formatCount("refitNode", pipeline.refitNodeCount) : null,
  ].filter((label): label is string => Boolean(label));

  return {
    stepSummaryLabel: pipeline.steps,
    graphReadinessLabel: formatExperimentPipelineGraphReadiness(pipeline),
    nodeLabel,
    branchLabel: pipeline.branchCount > 0 ? formatCount("branch", pipeline.branchCount) : null,
    generatorLabel: pipeline.generatorCount > 0 ? formatCount("generator", pipeline.generatorCount) : null,
    depthLabel: pipeline.maxDepth > 0 ? i18n.t("newExperiment.selection.pipeline.depth", { depth: pipeline.maxDepth + 1 }) : null,
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

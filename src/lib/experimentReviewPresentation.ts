import type { CampaignPlanSummary } from "./campaignSpecTypes";
import {
  getRuntimeGroupingSummary,
  RUNTIME_GROUPING_COPY,
  type DatasetRuntimeGroupingState,
  type SelectedPipelinesRuntimeGrouping,
} from "./runtimeSplitGrouping";

export const experimentReviewCopy = {
  title: "Review Experiment",
  nameLabel: "Experiment Name",
  descriptionLabel: "Description (optional)",
  descriptionPlaceholder: "Add notes about this experiment...",
  groupingTitle: "Runtime Grouping Summary",
  noSplittersBadge: "No splitters",
} as const;

export interface ExperimentReviewSummaryField {
  id: string;
  label: string;
  value: number;
}

export interface ExperimentReviewDatasetLabelSource {
  name: string;
}

export interface ExperimentReviewGroupingRow {
  id: string;
  datasetName: string;
  summary: string;
}

export function buildExperimentReviewSummaryFields(
  campaignSummary: CampaignPlanSummary,
): ExperimentReviewSummaryField[] {
  return [
    { id: "datasets", label: "Datasets", value: campaignSummary.datasetCount },
    { id: "pipelines", label: "Pipelines", value: campaignSummary.pipelineCount },
    { id: "runs", label: "Total Runs", value: campaignSummary.runCount },
  ];
}

export function getExperimentReviewGroupingBadgeLabel(
  groupingSelection: SelectedPipelinesRuntimeGrouping,
): string | null {
  return groupingSelection.hasSplitters ? null : experimentReviewCopy.noSplittersBadge;
}

export function getExperimentReviewNoSplitterMessage(): string {
  return RUNTIME_GROUPING_COPY.noSplitterInjection;
}

export function buildExperimentReviewGroupingRows({
  datasetById,
  datasetGroupingStates,
  selectedDatasetIds,
}: {
  datasetById: ReadonlyMap<string, ExperimentReviewDatasetLabelSource>;
  datasetGroupingStates: Record<string, DatasetRuntimeGroupingState>;
  selectedDatasetIds: string[];
}): ExperimentReviewGroupingRow[] {
  return selectedDatasetIds.flatMap((datasetId) => {
    const dataset = datasetById.get(datasetId);
    const groupingState = datasetGroupingStates[datasetId];
    if (!dataset || !groupingState) return [];

    return [{
      id: datasetId,
      datasetName: dataset.name,
      summary: getRuntimeGroupingSummary(
        groupingState.repetitionColumn,
        groupingState.selectedGroupBy,
      ),
    }];
  });
}

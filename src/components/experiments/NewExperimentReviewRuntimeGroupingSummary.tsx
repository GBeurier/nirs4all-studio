import { Badge } from "@/components/ui/badge";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  buildExperimentReviewGroupingRows,
  experimentReviewCopy,
  getExperimentReviewGroupingBadgeLabel,
  getExperimentReviewNoSplitterMessage,
} from "@/lib/experimentReviewPresentation";
import type {
  DatasetRuntimeGroupingState,
  SelectedPipelinesRuntimeGrouping,
} from "@/lib/runtimeSplitGrouping";

import { NewExperimentReviewRuntimeGroupingContent } from "./NewExperimentReviewRuntimeGroupingContent";

export interface NewExperimentReviewRuntimeGroupingSummaryProps {
  datasetById: Map<string, ExperimentDatasetOption>;
  datasetGroupingStates: Record<string, DatasetRuntimeGroupingState>;
  groupingSelection: SelectedPipelinesRuntimeGrouping;
  selectedDatasetIds: string[];
}

export function NewExperimentReviewRuntimeGroupingSummary({
  datasetById,
  datasetGroupingStates,
  groupingSelection,
  selectedDatasetIds,
}: NewExperimentReviewRuntimeGroupingSummaryProps) {
  const badgeLabel = getExperimentReviewGroupingBadgeLabel(groupingSelection);
  const groupingRows = buildExperimentReviewGroupingRows({
    datasetById,
    datasetGroupingStates,
    selectedDatasetIds,
  });

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {experimentReviewCopy.groupingTitle}
        </h3>
        {badgeLabel && <Badge variant="outline">{badgeLabel}</Badge>}
      </div>
      <NewExperimentReviewRuntimeGroupingContent
        groupingRows={groupingRows}
        hasSplitters={groupingSelection.hasSplitters}
        noSplitterMessage={getExperimentReviewNoSplitterMessage()}
      />
    </div>
  );
}

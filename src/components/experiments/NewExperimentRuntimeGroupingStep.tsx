import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  type DatasetRuntimeGroupingState,
  type SelectedPipelinesRuntimeGrouping,
} from "@/lib/runtimeSplitGrouping";
import { NewExperimentRuntimeGroupingConflictNotice } from "./NewExperimentRuntimeGroupingConflictNotice";
import { NewExperimentRuntimeGroupingDatasetList } from "./NewExperimentRuntimeGroupingDatasetList";
import { NewExperimentRuntimeGroupingHeader } from "./NewExperimentRuntimeGroupingHeader";
import { NewExperimentRuntimeGroupingNoSplitterNotice } from "./NewExperimentRuntimeGroupingNoSplitterNotice";

export interface NewExperimentRuntimeGroupingStepProps {
  datasetById: Map<string, ExperimentDatasetOption>;
  datasetGroupingStates: Record<string, DatasetRuntimeGroupingState>;
  groupingSelection: SelectedPipelinesRuntimeGrouping;
  selectedDatasetIds: string[];
  splitGroupByByDataset: Record<string, string | null>;
  onDatasetGroupChange: (datasetId: string, groupBy: string | null) => void;
}

export function NewExperimentRuntimeGroupingStep({
  datasetById,
  datasetGroupingStates,
  groupingSelection,
  selectedDatasetIds,
  splitGroupByByDataset,
  onDatasetGroupChange,
}: NewExperimentRuntimeGroupingStepProps) {
  return (
    <div className="space-y-4">
      <NewExperimentRuntimeGroupingHeader selectedDatasetCount={selectedDatasetIds.length} />
      {!groupingSelection.hasSplitters && (
        <NewExperimentRuntimeGroupingNoSplitterNotice />
      )}
      {groupingSelection.hasPersistedGroupConflict && (
        <NewExperimentRuntimeGroupingConflictNotice
          conflictingPipelines={groupingSelection.conflictingPipelines}
        />
      )}
      {groupingSelection.hasSplitters && !groupingSelection.hasPersistedGroupConflict && (
        <NewExperimentRuntimeGroupingDatasetList
          datasetById={datasetById}
          datasetGroupingStates={datasetGroupingStates}
          hasRequiredSplitters={groupingSelection.hasRequiredSplitters}
          selectedDatasetIds={selectedDatasetIds}
          splitGroupByByDataset={splitGroupByByDataset}
          onDatasetGroupChange={onDatasetGroupChange}
        />
      )}
    </div>
  );
}

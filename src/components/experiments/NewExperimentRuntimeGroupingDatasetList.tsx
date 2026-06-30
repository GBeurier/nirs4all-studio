import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import type { DatasetRuntimeGroupingState } from "@/lib/runtimeSplitGrouping";
import { NewExperimentRuntimeGroupingDatasetCard } from "./NewExperimentRuntimeGroupingDatasetCard";

export interface NewExperimentRuntimeGroupingDatasetListProps {
  datasetById: Map<string, ExperimentDatasetOption>;
  datasetGroupingStates: Record<string, DatasetRuntimeGroupingState>;
  hasRequiredSplitters: boolean;
  selectedDatasetIds: string[];
  splitGroupByByDataset: Record<string, string | null>;
  onDatasetGroupChange: (datasetId: string, groupBy: string | null) => void;
}

export function NewExperimentRuntimeGroupingDatasetList({
  datasetById,
  datasetGroupingStates,
  hasRequiredSplitters,
  selectedDatasetIds,
  splitGroupByByDataset,
  onDatasetGroupChange,
}: NewExperimentRuntimeGroupingDatasetListProps) {
  return (
    <div className="space-y-3">
      {selectedDatasetIds.map((datasetId) => {
        const dataset = datasetById.get(datasetId);
        const groupingState = datasetGroupingStates[datasetId];
        if (!dataset || !groupingState) return null;

        return (
          <NewExperimentRuntimeGroupingDatasetCard
            key={datasetId}
            dataset={dataset}
            groupingState={groupingState}
            hasRequiredSplitters={hasRequiredSplitters}
            selectedGroupBy={splitGroupByByDataset[datasetId]}
            onGroupChange={(groupBy) => onDatasetGroupChange(datasetId, groupBy)}
          />
        );
      })}
    </div>
  );
}

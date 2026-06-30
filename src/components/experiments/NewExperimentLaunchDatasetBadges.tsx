import { Badge } from "@/components/ui/badge";
import {
  getExperimentLaunchDatasetBadgeLabel,
  type ExperimentLaunchDatasetLabelSource,
} from "@/lib/experimentLaunchPresentation";

export interface NewExperimentLaunchDatasetBadgesProps {
  datasetById: ReadonlyMap<string, ExperimentLaunchDatasetLabelSource>;
  selectedDatasetIds: readonly string[];
}

export function NewExperimentLaunchDatasetBadges({
  datasetById,
  selectedDatasetIds,
}: NewExperimentLaunchDatasetBadgesProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {selectedDatasetIds.map((datasetId) => (
        <Badge key={datasetId} variant="secondary">
          {getExperimentLaunchDatasetBadgeLabel(datasetId, datasetById)}
        </Badge>
      ))}
    </div>
  );
}

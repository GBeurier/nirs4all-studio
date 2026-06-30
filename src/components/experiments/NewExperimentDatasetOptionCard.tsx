import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  buildExperimentDatasetSelectionChipLabels,
  buildExperimentDatasetSelectionDetails,
} from "@/lib/experimentSelectionPresentation";

import { NewExperimentSelectionDetailChips } from "./NewExperimentSelectionDetailChips";
import { NewExperimentSelectableOptionCard } from "./NewExperimentSelectableOptionCard";

export interface NewExperimentDatasetOptionCardProps {
  dataset: ExperimentDatasetOption;
  selected: boolean;
  onToggleDataset: (datasetId: string) => void;
}

export function NewExperimentDatasetOptionCard({
  dataset,
  selected,
  onToggleDataset,
}: NewExperimentDatasetOptionCardProps) {
  const details = buildExperimentDatasetSelectionDetails(dataset);
  const detailChipLabels = buildExperimentDatasetSelectionChipLabels(details);

  return (
    <NewExperimentSelectableOptionCard
      dataAttributeName="data-experiment-dataset-id"
      optionId={dataset.id}
      selected={selected}
      onToggle={onToggleDataset}
    >
      <p className="font-medium text-foreground">{dataset.name}</p>
      <p className="text-sm text-muted-foreground">
        {details.sampleLabel}
        {details.splitLabel && (
          <span className="ml-1 tabular-nums">{details.splitLabel}</span>
        )}
        {" • "}{details.featureLabel} • {details.targetLabel}
      </p>
      <NewExperimentSelectionDetailChips labels={detailChipLabels} />
    </NewExperimentSelectableOptionCard>
  );
}

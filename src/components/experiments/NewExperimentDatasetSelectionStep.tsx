import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  experimentSelectionCopy,
  formatNoExperimentDatasetSearchMatch,
} from "@/lib/experimentSelectionPresentation";
import { NewExperimentDatasetOptionCard } from "./NewExperimentDatasetOptionCard";
import { NewExperimentSelectionEmptyCatalogState } from "./NewExperimentSelectionEmptyCatalogState";
import { NewExperimentSelectionFeedbackState } from "./NewExperimentSelectionFeedbackState";
import { NewExperimentSelectionResultsList } from "./NewExperimentSelectionResultsList";
import { NewExperimentSelectionSearchField } from "./NewExperimentSelectionSearchField";
import { NewExperimentSelectionStepHeader } from "./NewExperimentSelectionStepHeader";

export interface NewExperimentDatasetSelectionStepProps {
  availableDatasetCount: number;
  datasetError: unknown;
  datasetSearch: string;
  filteredDatasets: ExperimentDatasetOption[];
  isLoading: boolean;
  selectedDatasetIds: string[];
  onDatasetSearchChange: (value: string) => void;
  onToggleDataset: (datasetId: string) => void;
}

export function NewExperimentDatasetSelectionStep({
  availableDatasetCount,
  datasetError,
  datasetSearch,
  filteredDatasets,
  isLoading,
  selectedDatasetIds,
  onDatasetSearchChange,
  onToggleDataset,
}: NewExperimentDatasetSelectionStepProps) {
  return (
    <div className="space-y-4">
      <NewExperimentSelectionStepHeader
        selectedCount={selectedDatasetIds.length}
        title={experimentSelectionCopy.datasetsTitle}
      />
      <NewExperimentSelectionSearchField
        placeholder={experimentSelectionCopy.datasetSearchPlaceholder}
        value={datasetSearch}
        onSearchChange={onDatasetSearchChange}
      />
      <NewExperimentSelectionFeedbackState
        error={datasetError}
        errorFallback={experimentSelectionCopy.datasetLoadErrorFallback}
        isLoading={isLoading}
        loadingMessage={experimentSelectionCopy.datasetLoadingMessage}
      />
      {!isLoading && !datasetError && availableDatasetCount === 0 && (
        <NewExperimentSelectionEmptyCatalogState kind="datasets" />
      )}
      {!isLoading && !datasetError && availableDatasetCount > 0 && (
        <NewExperimentSelectionResultsList
          emptySearchMessage={
            datasetSearch ? formatNoExperimentDatasetSearchMatch(datasetSearch) : null
          }
          itemCount={filteredDatasets.length}
        >
          {filteredDatasets.map((dataset) => {
            const selected = selectedDatasetIds.includes(dataset.id);
            return (
              <NewExperimentDatasetOptionCard
                key={dataset.id}
                dataset={dataset}
                selected={selected}
                onToggleDataset={onToggleDataset}
              />
            );
          })}
        </NewExperimentSelectionResultsList>
      )}
    </div>
  );
}

import type { PipelineFilterMode } from "@/lib/experimentInputFilters";
import type { ExperimentPipelineOption } from "@/lib/experimentPipelineSelection";
import {
  experimentSelectionCopy,
  formatNoExperimentPipelineSearchMatch,
} from "@/lib/experimentSelectionPresentation";
import { NewExperimentPipelineFilterSelect } from "./NewExperimentPipelineFilterSelect";
import { NewExperimentPipelineOptionCard } from "./NewExperimentPipelineOptionCard";
import { NewExperimentSelectionEmptyCatalogState } from "./NewExperimentSelectionEmptyCatalogState";
import { NewExperimentSelectionFeedbackState } from "./NewExperimentSelectionFeedbackState";
import { NewExperimentSelectionResultsList } from "./NewExperimentSelectionResultsList";
import { NewExperimentSelectionSearchField } from "./NewExperimentSelectionSearchField";
import { NewExperimentSelectionStepHeader } from "./NewExperimentSelectionStepHeader";

export interface NewExperimentPipelineSelectionStepProps {
  availablePipelineCount: number;
  filteredPipelines: ExperimentPipelineOption[];
  isLoading: boolean;
  pipelineError: unknown;
  pipelineFilter: PipelineFilterMode;
  pipelineSearch: string;
  selectedPipelineIds: string[];
  onPipelineFilterChange: (value: PipelineFilterMode) => void;
  onPipelineSearchChange: (value: string) => void;
  onTogglePipeline: (pipelineId: string) => void;
}

export function NewExperimentPipelineSelectionStep({
  availablePipelineCount,
  filteredPipelines,
  isLoading,
  pipelineError,
  pipelineFilter,
  pipelineSearch,
  selectedPipelineIds,
  onPipelineFilterChange,
  onPipelineSearchChange,
  onTogglePipeline,
}: NewExperimentPipelineSelectionStepProps) {
  return (
    <div className="space-y-4">
      <NewExperimentSelectionStepHeader
        selectedCount={selectedPipelineIds.length}
        title={experimentSelectionCopy.pipelinesTitle}
      />
      <div className="flex gap-3">
        <NewExperimentSelectionSearchField
          className="flex-1"
          placeholder={experimentSelectionCopy.pipelineSearchPlaceholder}
          value={pipelineSearch}
          onSearchChange={onPipelineSearchChange}
        />
        <NewExperimentPipelineFilterSelect
          value={pipelineFilter}
          onValueChange={onPipelineFilterChange}
        />
      </div>
      <NewExperimentSelectionFeedbackState
        error={pipelineError}
        errorFallback={experimentSelectionCopy.pipelineLoadErrorFallback}
        isLoading={isLoading}
        loadingMessage={experimentSelectionCopy.pipelineLoadingMessage}
      />
      {!isLoading && !pipelineError && availablePipelineCount === 0 && (
        <NewExperimentSelectionEmptyCatalogState kind="pipelines" />
      )}
      {!isLoading && !pipelineError && availablePipelineCount > 0 && (
        <NewExperimentSelectionResultsList
          emptySearchMessage={
            pipelineSearch ? formatNoExperimentPipelineSearchMatch(pipelineSearch) : null
          }
          itemCount={filteredPipelines.length}
        >
          {filteredPipelines.map((pipeline) => {
            const selected = selectedPipelineIds.includes(pipeline.id);
            return (
              <NewExperimentPipelineOptionCard
                key={pipeline.id}
                pipeline={pipeline}
                selected={selected}
                onTogglePipeline={onTogglePipeline}
              />
            );
          })}
        </NewExperimentSelectionResultsList>
      )}
    </div>
  );
}

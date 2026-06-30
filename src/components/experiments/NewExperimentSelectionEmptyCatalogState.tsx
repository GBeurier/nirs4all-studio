import { NoDatasetsState, NoPipelinesState } from "@/components/ui/state-display";
import { experimentSelectionCopy } from "@/lib/experimentSelectionPresentation";

export type NewExperimentSelectionEmptyCatalogKind = "datasets" | "pipelines";

export interface NewExperimentSelectionEmptyCatalogStateProps {
  kind: NewExperimentSelectionEmptyCatalogKind;
}

export function NewExperimentSelectionEmptyCatalogState({
  kind,
}: NewExperimentSelectionEmptyCatalogStateProps) {
  if (kind === "datasets") {
    return (
      <NoDatasetsState
        title={experimentSelectionCopy.datasetEmptyTitle}
        description={experimentSelectionCopy.datasetEmptyDescription}
        actionLabel={experimentSelectionCopy.datasetEmptyActionLabel}
        actionPath={experimentSelectionCopy.datasetEmptyActionPath}
      />
    );
  }

  return (
    <NoPipelinesState
      title={experimentSelectionCopy.pipelineEmptyTitle}
      description={experimentSelectionCopy.pipelineEmptyDescription}
      actionLabel={experimentSelectionCopy.pipelineEmptyActionLabel}
      actionPath={experimentSelectionCopy.pipelineEmptyActionPath}
    />
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

import {
  RUNTIME_GROUPING_COPY,
  type DatasetRuntimeGroupingState,
  type SelectedPipelinesRuntimeGrouping,
} from "@/lib/runtimeSplitGrouping";
import {
  getRuntimeGroupingRequirementBadge,
  runtimeGroupingPresentationCopy,
} from "@/lib/runtimeGroupingPresentation";

export function RuntimeGroupingConflictNotice({
  groupingSelection,
}: {
  groupingSelection: SelectedPipelinesRuntimeGrouping;
}) {
  if (!groupingSelection.hasPersistedGroupConflict) {
    return null;
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <div className="flex items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 text-destructive" />
        <div className="space-y-1">
          <p className="font-medium text-destructive">
            {RUNTIME_GROUPING_COPY.conflictTitle}
          </p>
          <p className="text-muted-foreground">
            {RUNTIME_GROUPING_COPY.conflictDescription}
          </p>
          {groupingSelection.conflictingPipelines.map((pipeline) => (
            <p key={pipeline.id} className="text-xs text-muted-foreground">
              {pipeline.name}: {pipeline.steps.join(", ")}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}

function RuntimeGroupingWarnings({
  groupingState,
}: {
  groupingState: DatasetRuntimeGroupingState;
}) {
  return (
    <>
      {groupingState.hasBlockingError && (
        <p className="text-xs text-destructive">
          {groupingState.blockingMessage}
        </p>
      )}

      {groupingState.repetitionOnlyWarning && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {groupingState.repetitionOnlyWarning}
        </p>
      )}

      {groupingState.optionalPropagationWarning && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {groupingState.optionalPropagationWarning}
        </p>
      )}

      {!groupingState.hasBlockingError &&
        groupingState.metadataColumns.length === 0 &&
        !groupingState.repetitionColumn && (
          <p className="text-xs text-muted-foreground">
            {runtimeGroupingPresentationCopy.noMetadataColumns}
          </p>
        )}
    </>
  );
}

export function RuntimeGroupingSection({
  disabled,
  groupingSelection,
  groupingState,
  selectedDataset,
  selectedGroupBy,
  onGroupByChange,
}: {
  disabled: boolean;
  groupingSelection: SelectedPipelinesRuntimeGrouping;
  groupingState: DatasetRuntimeGroupingState;
  selectedDataset: string;
  selectedGroupBy: string | null | undefined;
  onGroupByChange: (datasetId: string, groupBy: string | null) => void;
}) {
  const requirementBadge = getRuntimeGroupingRequirementBadge(
    groupingState,
    groupingSelection.hasRequiredSplitters,
  );

  return (
    <div className="space-y-2 rounded-lg border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <label className="text-sm font-medium">
          {runtimeGroupingPresentationCopy.title}
        </label>
        <Badge variant={requirementBadge.variant}>
          {requirementBadge.label}
        </Badge>
      </div>

      <Select
        value={(selectedGroupBy ?? "__none__") || "__none__"}
        onValueChange={(value) =>
          onGroupByChange(selectedDataset, value === "__none__" ? null : value)
        }
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue placeholder={runtimeGroupingPresentationCopy.selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">
            {runtimeGroupingPresentationCopy.noAdditionalGroupLabel}
          </SelectItem>
          {groupingState.metadataColumns.map((column) => (
            <SelectItem key={column} value={column}>
              {column}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {RUNTIME_GROUPING_COPY.additiveDescription}
      </p>

      {groupingState.repetitionColumn && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">
            {runtimeGroupingPresentationCopy.datasetRepetitionBadge}
          </Badge>
          <code>{groupingState.repetitionColumn}</code>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {RUNTIME_GROUPING_COPY.legacyGroupDeprecation}
      </p>

      <RuntimeGroupingWarnings groupingState={groupingState} />
    </div>
  );
}

export function RuntimeGroupingStatusMessage({
  hasSelectedDataset,
  isLoadingPipeline,
  hasSplitters,
}: {
  hasSelectedDataset: boolean;
  isLoadingPipeline: boolean;
  hasSplitters: boolean;
}) {
  if (!hasSelectedDataset) {
    return null;
  }

  if (isLoadingPipeline) {
    return (
      <p className="text-xs text-muted-foreground">
        Loading pipeline split requirements...
      </p>
    );
  }

  if (!hasSplitters) {
    return (
      <p className="text-xs text-muted-foreground">
        {RUNTIME_GROUPING_COPY.noSplitterPipeline}
      </p>
    );
  }

  return null;
}

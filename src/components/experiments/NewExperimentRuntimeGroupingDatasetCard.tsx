import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ExperimentDatasetOption } from "@/lib/experimentDatasetOptions";
import {
  formatRuntimeGroupingMetadataColumnCount,
  getRuntimeGroupingRequirementBadge,
  runtimeGroupingPresentationCopy,
} from "@/lib/runtimeGroupingPresentation";
import {
  RUNTIME_GROUPING_COPY,
  type DatasetRuntimeGroupingState,
} from "@/lib/runtimeSplitGrouping";

const NO_ADDITIONAL_GROUP_VALUE = "__none__";

export interface NewExperimentRuntimeGroupingDatasetCardProps {
  dataset: ExperimentDatasetOption;
  groupingState: DatasetRuntimeGroupingState;
  hasRequiredSplitters: boolean;
  selectedGroupBy: string | null | undefined;
  onGroupChange: (groupBy: string | null) => void;
}

export function NewExperimentRuntimeGroupingDatasetCard({
  dataset,
  groupingState,
  hasRequiredSplitters,
  selectedGroupBy,
  onGroupChange,
}: NewExperimentRuntimeGroupingDatasetCardProps) {
  const requirementBadge = getRuntimeGroupingRequirementBadge(
    groupingState,
    hasRequiredSplitters,
  );

  return (
    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-medium text-foreground">{dataset.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatRuntimeGroupingMetadataColumnCount(dataset.metadataColumns.length || 0)}
          </p>
        </div>
        <Badge variant={requirementBadge.variant}>{requirementBadge.label}</Badge>
      </div>
      <Select
        value={selectedGroupBy ?? NO_ADDITIONAL_GROUP_VALUE}
        onValueChange={(value) =>
          onGroupChange(value === NO_ADDITIONAL_GROUP_VALUE ? null : value)
        }
      >
        <SelectTrigger>
          <SelectValue placeholder={runtimeGroupingPresentationCopy.selectPlaceholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ADDITIONAL_GROUP_VALUE}>
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
      {groupingState.hasBlockingError && (
        <p className="text-xs text-destructive">{groupingState.blockingMessage}</p>
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
      {!groupingState.hasBlockingError && groupingState.metadataColumns.length === 0 && (
        <p className="text-xs text-muted-foreground">
          {runtimeGroupingPresentationCopy.noMetadataColumns}
        </p>
      )}
    </div>
  );
}

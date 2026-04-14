import { getNodeByClassPath, getNodeByName } from "@/data/nodes";
import type { PipelineStep } from "@/api/client";

type StepLike = PipelineStep & {
  classPath?: string;
  children?: unknown[];
  branches?: unknown[];
};

export interface PipelineRuntimeGroupingAnalysis {
  hasSplitters: boolean;
  hasRequiredSplitters: boolean;
  hasOptionalSplitters: boolean;
  persistedGroupParamSteps: string[];
}

export interface SelectedPipelinesRuntimeGrouping {
  hasSplitters: boolean;
  hasRequiredSplitters: boolean;
  hasOptionalSplitters: boolean;
  hasPersistedGroupConflict: boolean;
  conflictingPipelines: Array<{
    id: string;
    name: string;
    steps: string[];
  }>;
}

export interface DatasetRuntimeGroupingState {
  repetitionColumn: string | null;
  metadataColumns: string[];
  selectedGroupBy: string | null;
  requiresExplicitGroup: boolean;
  hasBlockingError: boolean;
  blockingMessage: string | null;
  repetitionOnlyWarning: string | null;
  optionalPropagationWarning: string | null;
}

type DatasetGroupingInput = {
  config?: {
    aggregation?: {
      enabled?: boolean;
      column?: string;
      method?: "mean" | "median" | "vote";
    };
    repetition?: string;
  };
  metadata_columns?: string[];
  metadataColumns?: string[];
  repetitionColumn?: string | null;
};

export const RUNTIME_GROUPING_COPY = {
  additiveDescription:
    "Runtime group_by adds an extra split constraint. When a dataset repetition is configured, samples sharing the repetition value or the selected group_by value stay in the same fold. group_by never replaces dataset repetition.",
  conflictTitle: "A selected pipeline already persists splitter grouping.",
  conflictDescription:
    "Remove the saved group_by or legacy group value from the pipeline definition and use runtime grouping instead. The legacy group alias is deprecated and will be removed in a future release.",
  conflictToast:
    "This pipeline already persists splitter grouping. Remove the saved group_by or legacy group value from the pipeline definition and use runtime grouping instead.",
  legacyGroupDeprecation:
    "Use group_by for new configurations. The legacy group alias is deprecated and will be removed in a future release.",
  requiredBlocking:
    "At least one selected pipeline requires an effective group. Choose a metadata column for group_by or configure a dataset repetition column.",
  noMetadataBlocking:
    "At least one selected pipeline requires an effective group, but this dataset has no metadata column available for group_by and no configured repetition column.",
  noSplitterRun:
    "No splitter was found in the selected pipelines. No runtime grouping is required for this run.",
  noSplitterInjection:
    "No runtime grouping will be injected because the selected pipelines do not contain splitters.",
  noSplitterPipeline:
    "This pipeline has no splitter. No runtime grouping is required.",
} as const;

export function getRuntimeGroupingRepetitionOnlyWarning(
  repetitionColumn: string,
): string {
  return `No additional group_by selected. Group-required splitters will use only the configured dataset repetition '${repetitionColumn}'.`;
}

export function getRuntimeGroupingOptionalPropagationWarning(): string {
  return "The explicit group_by selected here will also be applied to selected pipelines whose splitters do not strictly require groups.";
}

export function getRuntimeGroupingSummary(
  repetitionColumn: string | null,
  selectedGroupBy: string | null,
): string {
  if (repetitionColumn && selectedGroupBy) {
    return `Split constraints: ${repetitionColumn} + ${selectedGroupBy}`;
  }

  if (selectedGroupBy) {
    return `Explicit group_by: ${selectedGroupBy}`;
  }

  if (repetitionColumn) {
    return `Dataset repetition only (${repetitionColumn})`;
  }

  return "No additional group";
}

export function analyzeSelectedPipelinesRuntimeGrouping(
  pipelines: Array<{ id: string; name: string; steps: unknown[] }>,
): SelectedPipelinesRuntimeGrouping {
  const conflictingPipelines: SelectedPipelinesRuntimeGrouping["conflictingPipelines"] = [];
  let hasSplitters = false;
  let hasRequiredSplitters = false;
  let hasOptionalSplitters = false;

  for (const pipeline of pipelines) {
    const analysis = analyzePipelineRuntimeGrouping(pipeline.steps);
    hasSplitters = hasSplitters || analysis.hasSplitters;
    hasRequiredSplitters = hasRequiredSplitters || analysis.hasRequiredSplitters;
    hasOptionalSplitters = hasOptionalSplitters || analysis.hasOptionalSplitters;

    if (analysis.persistedGroupParamSteps.length > 0) {
      conflictingPipelines.push({
        id: pipeline.id,
        name: pipeline.name,
        steps: analysis.persistedGroupParamSteps,
      });
    }
  }

  return {
    hasSplitters,
    hasRequiredSplitters,
    hasOptionalSplitters,
    hasPersistedGroupConflict: conflictingPipelines.length > 0,
    conflictingPipelines,
  };
}

export function analyzePipelineRuntimeGrouping(
  steps: unknown[],
): PipelineRuntimeGroupingAnalysis {
  let hasSplitters = false;
  let hasRequiredSplitters = false;
  let hasOptionalSplitters = false;
  const persistedGroupParamSteps: string[] = [];

  visitSteps(steps, (step) => {
    if (step.type !== "splitting") {
      return;
    }

    hasSplitters = true;
    const metadata = resolveSplitMetadata(step);
    if (metadata?.groupRequired) {
      hasRequiredSplitters = true;
    } else {
      hasOptionalSplitters = true;
    }

    const params = isRecord(step.params) ? step.params : {};
    if (hasExplicitGroupValue(params.group_by) || hasExplicitGroupValue(params.group)) {
      persistedGroupParamSteps.push(String(step.name || step.id || "Unnamed splitter"));
    }
  });

  return {
    hasSplitters,
    hasRequiredSplitters,
    hasOptionalSplitters,
    persistedGroupParamSteps,
  };
}

export function evaluateDatasetRuntimeGrouping(
  dataset: DatasetGroupingInput,
  selection: SelectedPipelinesRuntimeGrouping,
  selectedGroupBy: string | null | undefined,
): DatasetRuntimeGroupingState {
  const repetitionColumn = getDatasetRepetitionColumn(dataset);
  const metadataColumns = getDatasetMetadataColumns(dataset);
  const cleanedGroupBy = typeof selectedGroupBy === "string" && selectedGroupBy.trim()
    ? selectedGroupBy.trim()
    : null;

  if (!selection.hasSplitters) {
    return {
      repetitionColumn,
      metadataColumns,
      selectedGroupBy: cleanedGroupBy,
      requiresExplicitGroup: false,
      hasBlockingError: false,
      blockingMessage: null,
      repetitionOnlyWarning: null,
      optionalPropagationWarning: null,
    };
  }

  if (cleanedGroupBy && !metadataColumns.includes(cleanedGroupBy)) {
    return {
      repetitionColumn,
      metadataColumns,
      selectedGroupBy: cleanedGroupBy,
      requiresExplicitGroup: false,
      hasBlockingError: true,
      blockingMessage: `Metadata column "${cleanedGroupBy}" is not available on this dataset.`,
      repetitionOnlyWarning: null,
      optionalPropagationWarning: null,
    };
  }

  const requiresExplicitGroup = selection.hasRequiredSplitters && !repetitionColumn;
  const missingRequiredGroup = requiresExplicitGroup && !cleanedGroupBy;
  const noMetadataColumns = metadataColumns.length === 0;

  return {
    repetitionColumn,
    metadataColumns,
    selectedGroupBy: cleanedGroupBy,
    requiresExplicitGroup,
    hasBlockingError: missingRequiredGroup,
    blockingMessage: missingRequiredGroup
      ? noMetadataColumns
        ? RUNTIME_GROUPING_COPY.noMetadataBlocking
        : RUNTIME_GROUPING_COPY.requiredBlocking
      : null,
    repetitionOnlyWarning:
      selection.hasRequiredSplitters && !cleanedGroupBy && Boolean(repetitionColumn)
        ? getRuntimeGroupingRepetitionOnlyWarning(repetitionColumn)
        : null,
    optionalPropagationWarning:
      selection.hasRequiredSplitters && selection.hasOptionalSplitters && Boolean(cleanedGroupBy)
        ? getRuntimeGroupingOptionalPropagationWarning()
        : null,
  };
}

export function getDatasetRepetitionColumn(
  dataset: Pick<DatasetGroupingInput, "config" | "repetitionColumn"> | null | undefined,
): string | null {
  if (typeof dataset?.repetitionColumn === "string" && dataset.repetitionColumn.trim()) {
    return dataset.repetitionColumn.trim();
  }

  const config = dataset?.config;
  if (!config) {
    return null;
  }

  if (config.aggregation?.enabled && typeof config.aggregation.column === "string" && config.aggregation.column.trim()) {
    return config.aggregation.column.trim();
  }

  if (typeof config.repetition === "string" && config.repetition.trim()) {
    return config.repetition.trim();
  }

  return null;
}

export function getDatasetMetadataColumns(
  dataset: Pick<DatasetGroupingInput, "metadata_columns" | "metadataColumns"> | null | undefined,
): string[] {
  const columns = dataset?.metadata_columns ?? dataset?.metadataColumns ?? [];
  return [...new Set(columns.filter((column): column is string => typeof column === "string" && column.length > 0))].sort(
    (left, right) => left.localeCompare(right),
  );
}

function visitSteps(
  steps: unknown[],
  visitor: (step: StepLike) => void,
): void {
  for (const rawStep of steps) {
    if (!isRecord(rawStep)) {
      continue;
    }

    const step = rawStep as StepLike;
    visitor(step);

    if (Array.isArray(step.children)) {
      visitSteps(step.children, visitor);
    }

    if (Array.isArray(step.branches)) {
      for (const branch of step.branches) {
        if (Array.isArray(branch)) {
          visitSteps(branch, visitor);
        } else if (isRecord(branch)) {
          visitSteps([branch], visitor);
        }
      }
    }
  }
}

function resolveSplitMetadata(step: StepLike) {
  const node = typeof step.classPath === "string"
    ? getNodeByClassPath(step.classPath) ?? (step.name ? getNodeByName(step.name) : undefined)
    : (step.name ? getNodeByName(step.name) : undefined);
  return node?._webapp_split;
}

function hasExplicitGroupValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }

  return value != null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

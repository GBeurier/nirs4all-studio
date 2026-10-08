import { getNodeByClassPath, getNodeByName } from "@/data/nodes";
import type { PipelineStep } from "@/api/pipelines";

import {
  getDatasetMetadataColumns,
  getDatasetRepetitionColumn,
  hasEmbeddedCohortGroups,
  type DatasetGroupingFieldsInput,
} from "./datasetGroupingFields";

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
  embeddedGroups?: boolean;
  metadataColumns: string[];
  selectedGroupBy: string | null;
  requiresExplicitGroup: boolean;
  hasBlockingError: boolean;
  blockingMessage: string | null;
  repetitionOnlyWarning: string | null;
  optionalPropagationWarning: string | null;
}

type DatasetGroupingInput = DatasetGroupingFieldsInput;

export const RUNTIME_GROUPING_COPY = {
  additiveDescription:
    "Keep related samples together during cross-validation. Samples sharing a repetition identifier or the selected group stay in the same fold. Repeated measurements always remain together.",
  conflictTitle: "A selected pipeline already defines sample groups.",
  conflictDescription:
    "Remove the grouping setting from the pipeline, then choose the sample groups here.",
  conflictToast:
    "This pipeline already defines sample groups. Remove its grouping setting, then choose the groups here.",
  legacyGroupDeprecation:
    "Update the sample grouping setting before using this pipeline.",
  requiredBlocking:
    "A selected pipeline requires sample groups. Choose a sample information column or define the repeated measurements in the dataset.",
  noMetadataBlocking:
    "A selected pipeline requires sample groups. Add sample information or define the repeated measurements in the dataset first.",
  noSplitterRun:
    "The selected pipelines do not divide the samples into validation sets. No sample grouping is needed.",
  noSplitterInjection:
    "No sample grouping is needed for the selected pipelines.",
  noSplitterPipeline:
    "This pipeline does not divide the samples into validation sets. No sample grouping is needed.",
} as const;

export function getRuntimeGroupingRepetitionOnlyWarning(
  repetitionColumn: string,
): string {
  return `No additional group selected. Repeated measurements will be kept together using '${repetitionColumn}'.`;
}

export function getRuntimeGroupingOptionalPropagationWarning(): string {
  return "The sample groups selected here will apply to all selected pipelines.";
}

export function getRuntimeGroupingSummary(
  repetitionColumn: string | null,
  selectedGroupBy: string | null,
): string {
  if (repetitionColumn && selectedGroupBy) {
    return `Split constraints: ${repetitionColumn} + ${selectedGroupBy}`;
  }

  if (selectedGroupBy) {
    return `Group samples by: ${selectedGroupBy}`;
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
  const embeddedGroups = hasEmbeddedCohortGroups(dataset);
  const metadataColumns = getDatasetMetadataColumns(dataset);
  const cleanedGroupBy = typeof selectedGroupBy === "string" && selectedGroupBy.trim()
    ? selectedGroupBy.trim()
    : null;

  if (!selection.hasSplitters) {
    return {
      repetitionColumn,
      embeddedGroups,
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
      embeddedGroups,
      metadataColumns,
      selectedGroupBy: cleanedGroupBy,
      requiresExplicitGroup: false,
      hasBlockingError: true,
      blockingMessage: `Metadata column "${cleanedGroupBy}" is not available on this dataset.`,
      repetitionOnlyWarning: null,
      optionalPropagationWarning: null,
    };
  }

  const requiresExplicitGroup = selection.hasRequiredSplitters && !repetitionColumn && !embeddedGroups;
  const missingRequiredGroup = requiresExplicitGroup && !cleanedGroupBy;
  const noMetadataColumns = metadataColumns.length === 0;

  return {
    repetitionColumn,
    embeddedGroups,
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
      selection.hasRequiredSplitters && !cleanedGroupBy && repetitionColumn
        ? getRuntimeGroupingRepetitionOnlyWarning(repetitionColumn)
        : null,
    optionalPropagationWarning:
      selection.hasRequiredSplitters && selection.hasOptionalSplitters && Boolean(cleanedGroupBy)
        ? getRuntimeGroupingOptionalPropagationWarning()
        : null,
  };
}

export { getDatasetMetadataColumns, getDatasetRepetitionColumn };

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

import i18n from "i18next";

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

/** User-visible runtime-grouping copy; getters resolve the active language at read time. */
export const RUNTIME_GROUPING_COPY = {
  get additiveDescription() { return i18n.t("newExperiment.runtimeGrouping.copy.additiveDescription"); },
  get conflictTitle() { return i18n.t("newExperiment.runtimeGrouping.copy.conflictTitle"); },
  get conflictDescription() { return i18n.t("newExperiment.runtimeGrouping.copy.conflictDescription"); },
  get conflictToast() { return i18n.t("newExperiment.runtimeGrouping.copy.conflictToast"); },
  get legacyGroupDeprecation() { return i18n.t("newExperiment.runtimeGrouping.copy.legacyGroupDeprecation"); },
  get requiredBlocking() { return i18n.t("newExperiment.runtimeGrouping.copy.requiredBlocking"); },
  get noMetadataBlocking() { return i18n.t("newExperiment.runtimeGrouping.copy.noMetadataBlocking"); },
  get noSplitterRun() { return i18n.t("newExperiment.runtimeGrouping.copy.noSplitterRun"); },
  get noSplitterInjection() { return i18n.t("newExperiment.runtimeGrouping.copy.noSplitterInjection"); },
  get noSplitterPipeline() { return i18n.t("newExperiment.runtimeGrouping.copy.noSplitterPipeline"); },
};

export function getRuntimeGroupingRepetitionOnlyWarning(
  repetitionColumn: string,
): string {
  return i18n.t("newExperiment.runtimeGrouping.repetitionOnlyWarning", { column: repetitionColumn });
}

export function getRuntimeGroupingOptionalPropagationWarning(): string {
  return i18n.t("newExperiment.runtimeGrouping.optionalPropagationWarning");
}

export function getRuntimeGroupingSummary(
  repetitionColumn: string | null,
  selectedGroupBy: string | null,
): string {
  if (repetitionColumn && selectedGroupBy) {
    return i18n.t("newExperiment.runtimeGrouping.summary.both", {
      repetition: repetitionColumn,
      groupBy: selectedGroupBy,
    });
  }

  if (selectedGroupBy) {
    return i18n.t("newExperiment.runtimeGrouping.summary.groupBy", { groupBy: selectedGroupBy });
  }

  if (repetitionColumn) {
    return i18n.t("newExperiment.runtimeGrouping.summary.repetitionOnly", { repetition: repetitionColumn });
  }

  return i18n.t("newExperiment.runtimeGrouping.summary.none");
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
      persistedGroupParamSteps.push(String(step.name || step.id || i18n.t("newExperiment.runtimeGrouping.unnamedSplitter")));
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
      blockingMessage: i18n.t("newExperiment.runtimeGrouping.metadataColumnMissing", { column: cleanedGroupBy }),
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

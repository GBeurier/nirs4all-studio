import type { TFunction } from "i18next";
import {
  collectPresentMetricKeys,
  isClassificationTaskType,
  orderMetricKeys,
} from "@/lib/scores";
import { formatRunTokenLabel } from "@/lib/runs/format";
import type { EnrichedRun } from "@/types/enriched-runs";
import type { Run, RunStatsResponse } from "@/types/runs";
import { getActiveLocale } from "@/lib/activeLocale";

export {
  EXECUTION_JOB_RECORD_DETAIL_REFETCH_MS,
  buildRunsExecutionJobListItems,
  buildRunsExecutionTaskPanelData,
  getExecutionJobRecordDetailRefetchInterval,
} from "@/lib/runs/executionJobPageData";
export type {
  RunsExecutionJobListIndicators,
  RunsExecutionJobListItem,
  RunsExecutionTaskGroup,
  RunsExecutionTaskItem,
  RunsExecutionTaskPanelData,
} from "@/lib/runs/executionJobPageData";

export interface RunsMetricSelectionContext {
  taskType: string | null;
  taskTypes: string[];
  availableMetricKeys: string[];
}

export interface RunsPageStats {
  runningCount: number;
  queuedCount: number;
  completedCount: number;
  failedCount: number;
  cancelledCount?: number;
  totalPipelines: number;
}

export interface RunsStorageArtifactProvenance {
  manifestPath: string | null;
  repositoryId: string | null;
  runDirectory: string | null;
  storeRunId: string | null;
  workspaceId: string | null;
}

export interface RunsStorageArtifactMetadataField {
  key: string;
  label: string;
  value: string;
}

export interface RunsStorageArtifactMetadata {
  runId: string;
  artifactCount: number | null;
  artifactCountLabel: string;
  artifactSizeBytes: number;
  artifactSizeLabel: string;
  executionBackend: string | null;
  executionBackendLabel: string | null;
  storageBackend: string | null;
  storageBackendLabel: string | null;
  provenance: RunsStorageArtifactProvenance;
  fields: RunsStorageArtifactMetadataField[];
}

function isLiveRunStatus(status: string): boolean {
  return status === "running" || status === "queued";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readStringField(source: unknown, keys: readonly string[]): string | null {
  const record = asRecord(source);

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function readNonNegativeNumberField(source: unknown, keys: readonly string[]): number | null {
  const record = asRecord(source);

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, value);
    }
  }

  return null;
}

function readArtifactCount(source: unknown): number | null {
  const explicitCount = readNonNegativeNumberField(source, [
    "artifact_count",
    "artifactCount",
    "artifacts_count",
    "artifactsCount",
  ]);

  if (explicitCount != null) {
    return Math.floor(explicitCount);
  }

  const artifacts = asRecord(source).artifacts;
  if (Array.isArray(artifacts)) {
    return artifacts.length;
  }

  const artifactItems = asRecord(artifacts).items;
  return Array.isArray(artifactItems) ? artifactItems.length : null;
}

function formatArtifactCountLabel(count: number | null, t: TFunction): string {
  if (count == null) {
    return t("runs.storage.notReported");
  }

  return t("runs.storage.artifactCount", { count });
}

function formatArtifactSizeLabel(bytes: number): string {
  if (bytes <= 0) {
    return "0 B";
  }

  const unitSize = 1024;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(unitSize)), units.length - 1);

  const value = (bytes / Math.pow(unitSize, unitIndex)).toLocaleString(getActiveLocale(), { maximumFractionDigits: 1 });
  return `${value} ${units[unitIndex]}`;
}

function metadataField(
  key: string,
  label: string,
  value: string | null,
): RunsStorageArtifactMetadataField | null {
  return value == null ? null : { key, label, value };
}

function compactMetadataFields(
  fields: readonly (RunsStorageArtifactMetadataField | null)[],
): RunsStorageArtifactMetadataField[] {
  return fields.filter((field): field is RunsStorageArtifactMetadataField => field != null);
}

function getRunStorageMetadataRunId(run: EnrichedRun | Run): string {
  return "run_id" in run ? run.run_id : run.id;
}

function readRunExecutionBackend(run: EnrichedRun | Run): string | null {
  return readStringField(run.config, ["execution_backend", "executionBackend"])
    ?? readStringField(run, ["execution_backend", "executionBackend"]);
}

function getActiveRunIdentityKeys(run: Run): string[] {
  return run.store_run_id ? [run.id, run.store_run_id] : [run.id];
}

function buildActiveRunLookup(activeRuns: readonly Run[]): Map<string, Run> {
  const lookup = new Map<string, Run>();

  for (const run of activeRuns) {
    for (const key of getActiveRunIdentityKeys(run)) {
      if (!lookup.has(key)) {
        lookup.set(key, run);
      }
    }
  }

  return lookup;
}

function buildActiveRunConfig(run: Run): EnrichedRun["config"] | undefined {
  if (!run.execution_backend) {
    return undefined;
  }

  return {
    execution_backend: run.execution_backend,
  };
}

function buildActiveOnlyRun(run: Run): EnrichedRun {
  const activeConfig = buildActiveRunConfig(run);

  return {
    run_id: run.id,
    name: run.name,
    status: run.status,
    project_id: null,
    created_at: run.created_at,
    completed_at: run.completed_at || null,
    duration_seconds: null,
    artifact_size_bytes: 0,
    datasets_count: run.datasets?.length || 0,
    pipeline_runs_count: run.total_pipelines || 0,
    final_models_count: 0,
    total_models_trained: 0,
    total_folds: 0,
    datasets: [],
    ...(activeConfig ? { config: activeConfig } : {}),
  };
}

function mergeActiveRunFields(run: EnrichedRun, activeRun: Run): EnrichedRun {
  if (!isLiveRunStatus(activeRun.status)) {
    return run;
  }

  const activeConfig = buildActiveRunConfig(activeRun);
  return {
    ...run,
    status: activeRun.status,
    ...(activeConfig ? { config: { ...run.config, ...activeConfig } } : {}),
  };
}

function hasEnrichedRunIdentity(enrichedIds: ReadonlySet<string>, run: Run): boolean {
  for (const key of getActiveRunIdentityKeys(run)) {
    if (enrichedIds.has(key)) {
      return true;
    }
  }

  return false;
}

export function buildRunsPageItems(
  enrichedRuns: readonly EnrichedRun[] | undefined,
  activeRuns: readonly Run[] | undefined,
): EnrichedRun[] {
  const enriched = enrichedRuns ?? [];
  const active = activeRuns ?? [];
  const enrichedIds = new Set(enriched.map(run => run.run_id));
  const activeRunLookup = buildActiveRunLookup(active);

  const activeOnlyRuns: EnrichedRun[] = active
    .filter(run => (
      !hasEnrichedRunIdentity(enrichedIds, run)
      && isLiveRunStatus(run.status)
    ))
    .map(buildActiveOnlyRun);

  const mergedRuns = enriched.map((run) => {
    const activeMatch = activeRunLookup.get(run.run_id);
    if (activeMatch) {
      return mergeActiveRunFields(run, activeMatch);
    }
    return run;
  });

  return [...activeOnlyRuns, ...mergedRuns];
}

export function buildRunPageIdLookup(activeRuns: readonly Run[] | undefined): Map<string, string> {
  const lookup = new Map<string, string>();

  for (const run of activeRuns ?? []) {
    for (const key of getActiveRunIdentityKeys(run)) {
      lookup.set(key, run.id);
    }
  }

  return lookup;
}

export function buildRunStorageArtifactMetadata(run: EnrichedRun | Run, t: TFunction): RunsStorageArtifactMetadata {
  const artifactCount = readArtifactCount(run);
  const artifactCountLabel = formatArtifactCountLabel(artifactCount, t);
  const artifactSizeBytes = readNonNegativeNumberField(run, ["artifact_size_bytes", "artifactSizeBytes"]) ?? 0;
  const artifactSizeLabel = formatArtifactSizeLabel(artifactSizeBytes);
  const executionBackend = readRunExecutionBackend(run);
  const storageBackend = readStringField(run, ["storage_backend", "storageBackend", "storage_mode", "storageMode"])
    ?? readStringField(run.config, ["storage_backend", "storageBackend", "storage_mode", "storageMode"]);
  const provenance: RunsStorageArtifactProvenance = {
    manifestPath: readStringField(run, ["manifest_path", "manifestPath"]),
    repositoryId: readStringField(run, ["repository_id", "repositoryId"]),
    runDirectory: readStringField(run, ["run_dir", "runDirectory", "runDir"]),
    storeRunId: readStringField(run, ["store_run_id", "storeRunId"]),
    workspaceId: readStringField(run, ["workspace_id", "workspaceId"]),
  };
  const executionBackendLabel = executionBackend ? formatRunTokenLabel(executionBackend, t) : null;
  const storageBackendLabel = storageBackend ? formatRunTokenLabel(storageBackend, t) : null;

  return {
    runId: getRunStorageMetadataRunId(run),
    artifactCount,
    artifactCountLabel,
    artifactSizeBytes,
    artifactSizeLabel,
    executionBackend,
    executionBackendLabel,
    storageBackend,
    storageBackendLabel,
    provenance,
    fields: compactMetadataFields([
      metadataField("artifact-count", t("runs.storage.artifacts"), artifactCountLabel),
      metadataField("artifact-size", t("runs.storage.artifactSize"), artifactSizeLabel),
      metadataField("execution-backend", t("runs.storage.executionBackend"), executionBackendLabel),
      metadataField("storage-backend", t("runs.storage.storageBackend"), storageBackendLabel),
      metadataField("store-run-id", t("runs.storage.storeRunId"), provenance.storeRunId),
      metadataField("manifest-path", t("runs.storage.manifestPath"), provenance.manifestPath),
      metadataField("run-directory", t("runs.storage.runDirectory"), provenance.runDirectory),
      metadataField("repository-id", t("runs.storage.repositoryId"), provenance.repositoryId),
      metadataField("workspace-id", t("runs.storage.workspaceId"), provenance.workspaceId),
    ]),
  };
}

export function buildRunsStorageArtifactMetadata(
  runs: readonly (EnrichedRun | Run)[],
  t: TFunction,
): RunsStorageArtifactMetadata[] {
  return runs.map(run => buildRunStorageArtifactMetadata(run, t));
}

export function buildRunsMetricSelectionContext(
  runs: readonly EnrichedRun[],
): RunsMetricSelectionContext {
  const taskTypes = new Set<string>();
  const availableMetricKeys = new Set<string>();

  for (const run of runs) {
    for (const dataset of run.datasets) {
      if (isClassificationTaskType(dataset.task_type)) {
        taskTypes.add("classification");
      } else if (dataset.task_type) {
        taskTypes.add("regression");
      }

      if (
        dataset.metric
        && (
          dataset.best_final_score != null
          || dataset.best_avg_val_score != null
          || dataset.best_avg_test_score != null
        )
      ) {
        availableMetricKeys.add(dataset.metric);
      }

      for (const chain of dataset.top_5) {
        for (const key of collectPresentMetricKeys(
          chain.scores?.val as Record<string, unknown> | undefined,
          chain.scores?.test as Record<string, unknown> | undefined,
          chain.final_scores as Record<string, unknown> | undefined,
          chain.final_agg_scores as Record<string, unknown> | undefined,
        )) {
          availableMetricKeys.add(key);
        }

        if (
          dataset.metric
          && (
            chain.avg_val_score != null
            || chain.avg_test_score != null
            || chain.avg_train_score != null
            || chain.final_test_score != null
            || chain.final_train_score != null
          )
        ) {
          availableMetricKeys.add(dataset.metric);
        }
      }
    }
  }

  const taskTypeList = [...taskTypes];

  return {
    taskType: taskTypeList.length === 1 ? taskTypeList[0] : null,
    taskTypes: taskTypeList,
    availableMetricKeys: orderMetricKeys([...availableMetricKeys]),
  };
}

/** Workspace aggregates include durable failures without a stored scientific run. */
export function buildRunsPageStats(
  runs: readonly EnrichedRun[],
  workspaceStats: RunStatsResponse | undefined,
  selectedProjectId: string | null,
): RunsPageStats {
  if (selectedProjectId || !workspaceStats) return summarizeRunsPageStats(runs);
  return {
    runningCount: workspaceStats.running,
    queuedCount: workspaceStats.queued,
    completedCount: workspaceStats.completed,
    failedCount: workspaceStats.failed,
    ...(workspaceStats.cancelled != null ? { cancelledCount: workspaceStats.cancelled } : {}),
    totalPipelines: workspaceStats.total_pipelines,
  };
}

export function summarizeRunsPageStats(runs: readonly EnrichedRun[]): RunsPageStats {
  return runs.reduce<RunsPageStats>(
    (stats, run) => {
      if (run.status === "running") stats.runningCount += 1;
      if (run.status === "queued") stats.queuedCount += 1;
      if (run.status === "completed") stats.completedCount += 1;
      if (run.status === "failed") stats.failedCount += 1;
      stats.totalPipelines += run.pipeline_runs_count;
      return stats;
    },
    {
      runningCount: 0,
      queuedCount: 0,
      completedCount: 0,
      failedCount: 0,
      totalPipelines: 0,
    },
  );
}

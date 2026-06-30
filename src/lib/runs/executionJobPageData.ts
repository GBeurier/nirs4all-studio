import {
  isActiveExecutionStatus,
  isFailedExecutionStatus,
} from "@/lib/runs/executionJobStatus";
import { clampRunProgress } from "@/lib/runs/format";
import type { ExecutionJobRecord } from "@/lib/runs/executionJobRecords";
import type { EnrichedRun } from "@/types/enriched-runs";
import type { Run } from "@/types/runs";

export interface RunsExecutionJobListIndicators {
  latestJobId: string | null;
  requestedBackend: string | null;
  executionBackend: string | null;
  executionStatus: string | null;
  progress: number | null;
  progressMessage: string | null;
  progressUnavailable: boolean;
  hasDurableRecord: boolean;
  jobCount: number;
  activeJobCount: number;
  failedJobCount: number;
  hasMultipleJobs: boolean;
}

export interface RunsExecutionJobListItem<TRun extends EnrichedRun | Run = EnrichedRun | Run> {
  run: TRun;
  runId: string;
  execution: RunsExecutionJobListIndicators;
}

export interface RunsExecutionTaskItem {
  jobId: string;
  runId: string;
  runName: string;
  runStatus: string;
  requestedBackend: string;
  executionBackend: string;
  executionStatus: string;
  progress: number;
  progressMessage: string;
  progressUnavailable: boolean;
  isActive: boolean;
  isOrphaned: boolean;
  isRemoteRequested: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface RunsExecutionTaskGroup {
  groupId: string;
  runId: string;
  runName: string;
  runStatus: string;
  isOrphaned: boolean;
  totalCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  remoteRequestedCount: number;
  latestItem: RunsExecutionTaskItem;
  items: RunsExecutionTaskItem[];
}

export interface RunsExecutionTaskPanelData {
  hasTasks: boolean;
  totalCount: number;
  activeCount: number;
  completedCount: number;
  failedCount: number;
  remoteRequestedCount: number;
  items: RunsExecutionTaskItem[];
  groups: RunsExecutionTaskGroup[];
}

export const EXECUTION_JOB_RECORD_DETAIL_REFETCH_MS = 10_000;

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

function getRunStorageMetadataRunId(run: EnrichedRun | Run): string {
  return "run_id" in run ? run.run_id : run.id;
}

function readRunExecutionBackend(run: EnrichedRun | Run): string | null {
  return readStringField(run.config, ["execution_backend", "executionBackend"])
    ?? readStringField(run, ["execution_backend", "executionBackend"]);
}

function getRunListIdentityKeys(run: EnrichedRun | Run): string[] {
  const keys = [getRunStorageMetadataRunId(run)];
  const storeRunId = readStringField(run, ["store_run_id", "storeRunId"]);

  if (storeRunId && !keys.includes(storeRunId)) {
    keys.push(storeRunId);
  }

  return keys;
}

function getExecutionJobRecordTimestamp(record: ExecutionJobRecord): number {
  for (const timestamp of [record.completed_at, record.started_at, record.created_at]) {
    if (!timestamp) continue;

    const parsedTimestamp = Date.parse(timestamp);
    if (Number.isFinite(parsedTimestamp)) {
      return parsedTimestamp;
    }
  }

  return 0;
}

function buildExecutionJobRecordLookup(
  executionJobRecords: readonly ExecutionJobRecord[] | undefined,
): Map<string, ExecutionJobRecord[]> {
  const lookup = new Map<string, ExecutionJobRecord[]>();

  for (const record of executionJobRecords ?? []) {
    const records = lookup.get(record.run_id) ?? [];
    records.push(record);
    lookup.set(record.run_id, records);
  }

  return lookup;
}

function sortExecutionJobRecords(records: readonly ExecutionJobRecord[]): ExecutionJobRecord[] {
  return [...records].sort(
    (left, right) => getExecutionJobRecordTimestamp(right) - getExecutionJobRecordTimestamp(left),
  );
}

function getExecutionJobRecordsForRun(
  run: EnrichedRun | Run,
  executionJobRecordLookup: ReadonlyMap<string, readonly ExecutionJobRecord[]>,
): ExecutionJobRecord[] {
  const recordsByJobId = new Map<string, ExecutionJobRecord>();

  for (const key of getRunListIdentityKeys(run)) {
    for (const record of executionJobRecordLookup.get(key) ?? []) {
      const current = recordsByJobId.get(record.job_id);
      if (
        !current
        || getExecutionJobRecordTimestamp(record) > getExecutionJobRecordTimestamp(current)
      ) {
        recordsByJobId.set(record.job_id, record);
      }
    }
  }

  return sortExecutionJobRecords([...recordsByJobId.values()]);
}

function buildRunsExecutionJobListIndicators(
  run: EnrichedRun | Run,
  executionJobRecords: readonly ExecutionJobRecord[],
): RunsExecutionJobListIndicators {
  const runExecutionBackend = readRunExecutionBackend(run);
  const executionJobRecord = executionJobRecords[0] ?? null;

  if (!executionJobRecord) {
    return {
      latestJobId: null,
      requestedBackend: runExecutionBackend,
      executionBackend: runExecutionBackend,
      executionStatus: null,
      progress: null,
      progressMessage: null,
      progressUnavailable: false,
      hasDurableRecord: false,
      jobCount: 0,
      activeJobCount: 0,
      failedJobCount: 0,
      hasMultipleJobs: false,
    };
  }

  const activeJobCount = executionJobRecords.filter(record => isActiveExecutionStatus(record.status)).length;
  const failedJobCount = executionJobRecords.filter(record => isFailedExecutionStatus(record.status)).length;

  return {
    latestJobId: executionJobRecord.job_id,
    requestedBackend: executionJobRecord.requested_backend || runExecutionBackend,
    executionBackend: executionJobRecord.execution_backend || runExecutionBackend,
    executionStatus: executionJobRecord.status || null,
    progress: Number.isFinite(executionJobRecord.progress) ? executionJobRecord.progress : null,
    progressMessage: executionJobRecord.progress_message || null,
    progressUnavailable: executionJobRecord.progress_unavailable === true,
    hasDurableRecord: true,
    jobCount: executionJobRecords.length,
    activeJobCount,
    failedJobCount,
    hasMultipleJobs: executionJobRecords.length > 1,
  };
}

export function buildRunsExecutionJobListItems<TRun extends EnrichedRun | Run>(
  runs: readonly TRun[] | undefined,
  executionJobRecords: readonly ExecutionJobRecord[] | undefined,
): RunsExecutionJobListItem<TRun>[] {
  const executionJobRecordLookup = buildExecutionJobRecordLookup(executionJobRecords);

  return (runs ?? []).map((run) => {
    const executionJobRecordsForRun = getExecutionJobRecordsForRun(run, executionJobRecordLookup);

    return {
      run,
      runId: getRunStorageMetadataRunId(run),
      execution: buildRunsExecutionJobListIndicators(run, executionJobRecordsForRun),
    };
  });
}

export function getExecutionJobRecordDetailRefetchInterval(
  record: Pick<ExecutionJobRecord, "status"> | null | undefined,
): typeof EXECUTION_JOB_RECORD_DETAIL_REFETCH_MS | false {
  return !record || isActiveExecutionStatus(record.status)
    ? EXECUTION_JOB_RECORD_DETAIL_REFETCH_MS
    : false;
}

function isRemoteRequestedBackend(backend: string): boolean {
  return backend !== "local-python";
}

function parseExecutionTaskTimestamp(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareExecutionTaskItems(left: RunsExecutionTaskItem, right: RunsExecutionTaskItem): number {
  if (left.isActive !== right.isActive) {
    return left.isActive ? -1 : 1;
  }
  return parseExecutionTaskTimestamp(right.createdAt) - parseExecutionTaskTimestamp(left.createdAt);
}

function buildRunsExecutionTaskGroups(
  items: readonly RunsExecutionTaskItem[],
): RunsExecutionTaskGroup[] {
  const groupsByRunId = new Map<string, RunsExecutionTaskItem[]>();

  for (const item of items) {
    const groupItems = groupsByRunId.get(item.runId) ?? [];
    groupItems.push(item);
    groupsByRunId.set(item.runId, groupItems);
  }

  const groups = [...groupsByRunId.entries()].map(([runId, groupItems]) => {
    const sortedItems = [...groupItems].sort(compareExecutionTaskItems);
    const latestItem = sortedItems[0]!;

    return {
      groupId: runId,
      runId,
      runName: latestItem.runName,
      runStatus: latestItem.runStatus,
      isOrphaned: sortedItems.every(item => item.isOrphaned),
      totalCount: sortedItems.length,
      activeCount: sortedItems.filter(item => item.isActive).length,
      completedCount: sortedItems.filter(item => item.executionStatus === "completed").length,
      failedCount: sortedItems.filter(item => isFailedExecutionStatus(item.executionStatus)).length,
      remoteRequestedCount: sortedItems.filter(item => item.isRemoteRequested).length,
      latestItem,
      items: sortedItems,
    };
  });

  return groups.sort((left, right) => compareExecutionTaskItems(left.latestItem, right.latestItem));
}

export function buildRunsExecutionTaskPanelData(
  executionJobRecords: readonly ExecutionJobRecord[] | undefined,
): RunsExecutionTaskPanelData {
  const items = (executionJobRecords ?? [])
    .map((record): RunsExecutionTaskItem => ({
      jobId: record.job_id,
      runId: record.run_id,
      runName: record.run_name,
      runStatus: record.run_status,
      requestedBackend: record.requested_backend,
      executionBackend: record.execution_backend,
      executionStatus: record.status,
      progress: record.status === "completed" ? 100 : clampRunProgress(record.progress),
      progressMessage: record.progress_message,
      progressUnavailable: record.progress_unavailable === true,
      isActive: isActiveExecutionStatus(record.status),
      isOrphaned: record.is_orphaned,
      isRemoteRequested: isRemoteRequestedBackend(record.requested_backend),
      createdAt: record.created_at,
      startedAt: record.started_at,
      completedAt: record.completed_at,
    }))
    .sort(compareExecutionTaskItems);
  const groups = buildRunsExecutionTaskGroups(items);

  return {
    hasTasks: items.length > 0,
    totalCount: items.length,
    activeCount: items.filter((item) => item.isActive).length,
    completedCount: items.filter((item) => item.executionStatus === "completed").length,
    failedCount: items.filter((item) => isFailedExecutionStatus(item.executionStatus)).length,
    remoteRequestedCount: items.filter((item) => item.isRemoteRequested).length,
    items,
    groups,
  };
}

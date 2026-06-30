import type { ExecutionJobRecord, ExecutionJobRecordObject } from "./executionJobRecords";
import {
  isActiveExecutionStatus,
  isRetryableExecutionStatus,
} from "./executionJobStatus";
import { formatRunProgress, formatRunTokenLabel } from "./format";

export type ExecutionJobRecordDetailActionId = "cancel" | "retry" | "workerLogs";

export interface ExecutionJobRecordDetailField {
  id: string;
  label: string;
  value: string | number;
  tone?: "default" | "destructive";
}

export interface ExecutionJobRecordDetailSummaryField {
  id: string;
  label: string;
  value: string | number | null;
}

export interface ExecutionJobRecordDetailJsonSection {
  id: string;
  label: string;
  value: ExecutionJobRecordObject;
}

export interface ExecutionJobRecordDetailAction {
  id: ExecutionJobRecordDetailActionId;
  label: string;
  enabled: boolean;
  visible: boolean;
  availability: "available" | "unavailable";
  reason: string | null;
  runId: string | null;
  jobId: string;
  href?: string;
}

export interface ExecutionJobRecordDetail {
  description: string;
  summaryFields: ExecutionJobRecordDetailSummaryField[];
  fields: ExecutionJobRecordDetailField[];
  jsonSections: ExecutionJobRecordDetailJsonSection[];
  actions: ExecutionJobRecordDetailAction[];
  errorMessage: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectField(source: Record<string, unknown>, key: string): ExecutionJobRecordObject {
  const value = source[key];
  return isRecord(value) ? { ...value } : {};
}

function hasObjectContent(value: ExecutionJobRecordObject | null | undefined): value is ExecutionJobRecordObject {
  return value != null && Object.keys(value).length > 0;
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function nestedObjectField(source: Record<string, unknown>, key: string): ExecutionJobRecordObject {
  const value = source[key];
  return isRecord(value) ? { ...value } : {};
}

function nestedStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "-";

  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function getRunId(record: ExecutionJobRecord): string | null {
  return record.run_id.trim() && !record.is_orphaned ? record.run_id : null;
}

function findWorkerLogsHref(record: ExecutionJobRecord): string | null {
  const directHref = stringField(record, "worker_logs_url")
    ?? stringField(record, "worker_log_url")
    ?? stringField(record, "logs_url")
    ?? stringField(record, "log_url");
  if (directHref) return directHref;

  return nestedStringField(record.driver, "worker_logs_url")
    ?? nestedStringField(record.driver, "worker_log_url")
    ?? nestedStringField(record.driver, "logs_url")
    ?? nestedStringField(record.driver, "log_url");
}

function hasEmbeddedWorkerLogs(record: ExecutionJobRecord): boolean {
  return hasObjectContent(objectField(record, "worker_logs"))
    || hasObjectContent(objectField(record, "logs"))
    || hasObjectContent(nestedObjectField(record.driver, "worker_logs"))
    || hasObjectContent(nestedObjectField(record.driver, "logs"));
}

function buildExecutionJobRecordActions(record: ExecutionJobRecord): ExecutionJobRecordDetailAction[] {
  const runId = getRunId(record);
  const canTargetRun = runId != null;
  const canTargetJob = record.job_id.trim().length > 0;
  const canCancel = canTargetJob && isActiveExecutionStatus(record.status);
  const canRetry = canTargetRun && isRetryableExecutionStatus(record.status);
  const workerLogsHref = findWorkerLogsHref(record);
  const hasWorkerLogs = workerLogsHref != null || hasEmbeddedWorkerLogs(record);

  return [
    {
      id: "cancel",
      label: "Cancel job",
      enabled: canCancel,
      visible: canCancel,
      availability: canCancel ? "available" : "unavailable",
      reason: canCancel ? null : "Only active execution jobs can be cancelled.",
      runId,
      jobId: record.job_id,
    },
    {
      id: "retry",
      label: "Retry run",
      enabled: canRetry,
      visible: canRetry,
      availability: canRetry ? "available" : "unavailable",
      reason: canTargetRun ? null : "No Studio run is linked to this job.",
      runId,
      jobId: record.job_id,
    },
    {
      id: "workerLogs",
      label: "Worker logs",
      enabled: hasWorkerLogs,
      visible: true,
      availability: hasWorkerLogs ? "available" : "unavailable",
      reason: hasWorkerLogs ? null : "Worker logs are not attached to this execution snapshot yet.",
      runId,
      jobId: record.job_id,
      ...(workerLogsHref ? { href: workerLogsHref } : {}),
    },
  ];
}

function getMetadataSection(record: ExecutionJobRecord): ExecutionJobRecordObject {
  const directMetadata = objectField(record, "metadata");
  if (hasObjectContent(directMetadata)) {
    return directMetadata;
  }
  return nestedObjectField(record.request, "metadata");
}

export function buildExecutionJobRecordDetail(record: ExecutionJobRecord): ExecutionJobRecordDetail {
  const summaryFields: ExecutionJobRecordDetailSummaryField[] = [
    { id: "job_id", label: "Job ID", value: record.job_id },
    { id: "job_type", label: "Type", value: record.job_type },
    { id: "run_id", label: "Run ID", value: record.run_id || null },
    { id: "run_name", label: "Run name", value: record.run_name || null },
    { id: "run_status", label: "Run status", value: record.run_status },
    { id: "requested_backend", label: "Requested backend", value: record.requested_backend },
    { id: "execution_backend", label: "Execution backend", value: record.execution_backend },
    { id: "execution_status", label: "Execution status", value: record.status },
    { id: "created_at", label: "Created", value: record.created_at },
    { id: "started_at", label: "Started", value: record.started_at },
    { id: "completed_at", label: "Completed", value: record.completed_at },
    { id: "progress", label: "Progress", value: record.progress },
    { id: "progress_message", label: "Progress message", value: record.progress_message },
    { id: "error", label: "Error", value: record.error ?? null },
  ];

  const fields: ExecutionJobRecordDetailField[] = [
    { id: "job_id", label: "Job ID", value: record.job_id },
    { id: "job_type", label: "Type", value: formatRunTokenLabel(record.job_type) },
    { id: "status", label: "Status", value: formatRunTokenLabel(record.status) },
    { id: "progress", label: "Progress", value: formatRunProgress(record.progress) },
    { id: "run_id", label: "Run ID", value: record.run_id || "-" },
    { id: "run_name", label: "Run name", value: record.run_name || "-" },
    { id: "run_status", label: "Run status", value: formatRunTokenLabel(record.run_status) },
    { id: "requested_backend", label: "Requested backend", value: formatRunTokenLabel(record.requested_backend) },
    { id: "execution_backend", label: "Execution backend", value: formatRunTokenLabel(record.execution_backend) },
    { id: "created_at", label: "Created", value: formatTimestamp(record.created_at) },
    { id: "started_at", label: "Started", value: formatTimestamp(record.started_at) },
    { id: "completed_at", label: "Completed", value: formatTimestamp(record.completed_at) },
  ];

  if (record.error) {
    fields.push({
      id: "error",
      label: "Error",
      value: record.error,
      tone: "destructive",
    });
  }

  const candidateJsonSections: ExecutionJobRecordDetailJsonSection[] = [
    { id: "request", label: "Request", value: record.request },
    { id: "driver", label: "Driver", value: record.driver },
    { id: "metadata", label: "Metadata", value: getMetadataSection(record) },
    { id: "metrics", label: "Metrics", value: record.metrics ?? {} },
  ];

  return {
    description: record.job_id ? `Job ${record.job_id}` : "Execution snapshot",
    summaryFields,
    fields,
    jsonSections: candidateJsonSections.filter(section => hasObjectContent(section.value)),
    actions: buildExecutionJobRecordActions(record),
    errorMessage: record.error || null,
  };
}

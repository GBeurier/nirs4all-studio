import type { TFunction } from "i18next";
import type { ExecutionJobRecord, ExecutionJobRecordObject } from "./executionJobRecords";
import {
  isActiveExecutionStatus,
  isRetryableExecutionStatus,
} from "./executionJobStatus";
import { formatRunProgress, formatRunTokenLabel } from "./format";
import { getActiveLocale } from "@/lib/activeLocale";

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

  return date.toLocaleString(getActiveLocale(), { dateStyle: "medium", timeStyle: "short" });
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

function buildExecutionJobRecordActions(record: ExecutionJobRecord, t: TFunction): ExecutionJobRecordDetailAction[] {
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
      label: t("runs.jobDetail.cancelJob"),
      enabled: canCancel,
      visible: canCancel,
      availability: canCancel ? "available" : "unavailable",
      reason: canCancel ? null : t("runs.jobDetail.cancelUnavailable"),
      runId,
      jobId: record.job_id,
    },
    {
      id: "retry",
      label: t("runs.jobDetail.retryRun"),
      enabled: canRetry,
      visible: canRetry,
      availability: canRetry ? "available" : "unavailable",
      reason: canTargetRun ? null : t("runs.jobDetail.noLinkedRun"),
      runId,
      jobId: record.job_id,
    },
    {
      id: "workerLogs",
      label: t("runs.jobDetail.workerLogs"),
      enabled: hasWorkerLogs,
      visible: true,
      availability: hasWorkerLogs ? "available" : "unavailable",
      reason: hasWorkerLogs ? null : t("runs.jobDetail.workerLogsUnavailable"),
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

export function buildExecutionJobRecordDetail(record: ExecutionJobRecord, t: TFunction): ExecutionJobRecordDetail {
  const summaryFields: ExecutionJobRecordDetailSummaryField[] = [
    { id: "job_id", label: t("runs.jobDetail.jobId"), value: record.job_id },
    { id: "job_type", label: t("runs.jobDetail.type"), value: record.job_type },
    { id: "run_id", label: t("runs.jobDetail.runId"), value: record.run_id || null },
    { id: "run_name", label: t("runs.jobDetail.runName"), value: record.run_name || null },
    { id: "run_status", label: t("runs.jobDetail.runStatus"), value: record.run_status },
    { id: "requested_backend", label: t("runs.jobDetail.requestedBackend"), value: record.requested_backend },
    { id: "execution_backend", label: t("runs.jobDetail.executionBackend"), value: record.execution_backend },
    { id: "execution_status", label: t("runs.jobDetail.executionStatus"), value: record.status },
    { id: "created_at", label: t("runs.jobDetail.created"), value: record.created_at },
    { id: "started_at", label: t("runs.jobDetail.started"), value: record.started_at },
    { id: "completed_at", label: t("runs.jobDetail.completed"), value: record.completed_at },
    { id: "progress", label: t("runs.jobDetail.progress"), value: record.progress },
    { id: "progress_message", label: t("runs.jobDetail.progressMessage"), value: record.progress_message },
    { id: "error", label: t("runs.jobDetail.error"), value: record.error ?? null },
  ];

  const fields: ExecutionJobRecordDetailField[] = [
    { id: "job_id", label: t("runs.jobDetail.jobId"), value: record.job_id },
    { id: "job_type", label: t("runs.jobDetail.type"), value: formatRunTokenLabel(record.job_type, t) },
    { id: "status", label: t("runs.jobDetail.status"), value: formatRunTokenLabel(record.status, t) },
    { id: "progress", label: t("runs.jobDetail.progress"), value: formatRunProgress(record.progress) },
    { id: "run_id", label: t("runs.jobDetail.runId"), value: record.run_id || "-" },
    { id: "run_name", label: t("runs.jobDetail.runName"), value: record.run_name || "-" },
    { id: "run_status", label: t("runs.jobDetail.runStatus"), value: formatRunTokenLabel(record.run_status, t) },
    { id: "requested_backend", label: t("runs.jobDetail.requestedBackend"), value: formatRunTokenLabel(record.requested_backend, t) },
    { id: "execution_backend", label: t("runs.jobDetail.executionBackend"), value: formatRunTokenLabel(record.execution_backend, t) },
    { id: "created_at", label: t("runs.jobDetail.created"), value: formatTimestamp(record.created_at) },
    { id: "started_at", label: t("runs.jobDetail.started"), value: formatTimestamp(record.started_at) },
    { id: "completed_at", label: t("runs.jobDetail.completed"), value: formatTimestamp(record.completed_at) },
  ];

  if (record.error) {
    fields.push({
      id: "error",
      label: t("runs.jobDetail.error"),
      value: record.error,
      tone: "destructive",
    });
  }

  const candidateJsonSections: ExecutionJobRecordDetailJsonSection[] = [
    { id: "request", label: t("runs.jobDetail.request"), value: record.request },
    { id: "driver", label: t("runs.jobDetail.driver"), value: record.driver },
    { id: "metadata", label: t("runs.jobDetail.metadata"), value: getMetadataSection(record) },
    { id: "metrics", label: t("runs.jobDetail.metrics"), value: record.metrics ?? {} },
  ];

  return {
    description: record.job_id ? t("runs.jobDetail.jobTitle", { id: record.job_id }) : t("runs.jobDetail.snapshot"),
    summaryFields,
    fields,
    jsonSections: candidateJsonSections.filter(section => hasObjectContent(section.value)),
    actions: buildExecutionJobRecordActions(record, t),
    errorMessage: record.error || null,
  };
}

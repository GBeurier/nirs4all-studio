import type { RunExecutionBackend, RunStatus } from "@/types/runs";

type FutureString<TKnown extends string> = TKnown | (string & Record<never, never>);

export const EXECUTION_JOB_RECORDS_ENDPOINT = "/api/runs/execution-job-records";

export type ExecutionJobRecordBackend = FutureString<RunExecutionBackend>;
export type ExecutionJobRecordRunStatus = FutureString<RunStatus>;
export type ExecutionJobRecordStatus = FutureString<
  "pending" | "running" | "completed" | "failed" | "cancelled"
>;
export type ExecutionJobRecordType = FutureString<
  | "training"
  | "evaluation"
  | "prediction"
  | "automl"
  | "export"
  | "analysis"
  | "maintenance"
  | "update_download"
  | "update_apply"
  | "venv_create"
  | "venv_install"
>;

export type ExecutionJobRecordObject = Record<string, unknown>;

export interface ExecutionJobRecord extends Record<string, unknown> {
  job_id: string;
  job_type: ExecutionJobRecordType;
  requested_backend: ExecutionJobRecordBackend;
  execution_backend: ExecutionJobRecordBackend;
  execution_mode: string | null;
  status: ExecutionJobRecordStatus;
  progress: number;
  progress_message: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  request: ExecutionJobRecordObject;
  driver: ExecutionJobRecordObject;
  metrics?: ExecutionJobRecordObject;
  error?: string | null;
  progress_unavailable?: boolean;
  run_id: string;
  run_name: string;
  run_status: ExecutionJobRecordRunStatus;
  is_orphaned: boolean;
}

export interface ExecutionJobRecordsListPayload extends Record<string, unknown> {
  records: ExecutionJobRecord[];
  total: number;
}

export type ExecutionJobRecordFilterValue<TValue extends string = string> =
  | TValue
  | readonly TValue[]
  | null
  | undefined;

export interface ExecutionJobRecordFilters {
  run_status?: ExecutionJobRecordFilterValue<ExecutionJobRecordRunStatus>;
  execution_status?: ExecutionJobRecordFilterValue<ExecutionJobRecordStatus>;
  requested_backend?: ExecutionJobRecordFilterValue<ExecutionJobRecordBackend>;
  include_orphaned?: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function nullableStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function numberField(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanField(source: Record<string, unknown>, key: string): boolean | null {
  const value = source[key];
  return typeof value === "boolean" ? value : null;
}

function objectField(source: Record<string, unknown>, key: string): ExecutionJobRecordObject {
  const value = source[key];
  return isRecord(value) ? { ...value } : {};
}

function optionalObjectField(
  source: Record<string, unknown>,
  key: string,
): ExecutionJobRecordObject | undefined {
  return source[key] === undefined ? undefined : objectField(source, key);
}

function optionalNullableStringField(
  source: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return source[key] === undefined ? undefined : nullableStringField(source, key);
}

function hasStringField(source: Record<string, unknown>, key: string): boolean {
  return typeof source[key] === "string";
}

function hasNullableStringField(source: Record<string, unknown>, key: string): boolean {
  return source[key] == null || typeof source[key] === "string";
}

function hasRecordField(source: Record<string, unknown>, key: string): boolean {
  return isRecord(source[key]);
}

function hasOptionalRecordField(source: Record<string, unknown>, key: string): boolean {
  return source[key] === undefined || isRecord(source[key]);
}

function hasOptionalNullableStringField(source: Record<string, unknown>, key: string): boolean {
  return source[key] === undefined || source[key] == null || typeof source[key] === "string";
}

function hasBooleanField(source: Record<string, unknown>, key: string): boolean {
  return typeof source[key] === "boolean";
}

function fallbackProgressForStatus(status: string): number {
  return status === "completed" ? 100 : 0;
}

export function isExecutionJobRecord(value: unknown): value is ExecutionJobRecord {
  if (!isRecord(value)) return false;

  return (
    hasStringField(value, "job_id")
    && hasStringField(value, "job_type")
    && hasStringField(value, "requested_backend")
    && hasStringField(value, "execution_backend")
    && hasNullableStringField(value, "execution_mode")
    && hasStringField(value, "status")
    && numberField(value, "progress") != null
    && hasStringField(value, "progress_message")
    && hasStringField(value, "created_at")
    && hasNullableStringField(value, "started_at")
    && hasNullableStringField(value, "completed_at")
    && hasRecordField(value, "request")
    && hasRecordField(value, "driver")
    && hasOptionalRecordField(value, "metrics")
    && hasOptionalNullableStringField(value, "error")
    && hasStringField(value, "run_id")
    && hasStringField(value, "run_name")
    && hasStringField(value, "run_status")
    && hasBooleanField(value, "is_orphaned")
  );
}

export function isExecutionJobRecordsListPayload(
  value: unknown,
): value is ExecutionJobRecordsListPayload {
  if (!isRecord(value) || !Array.isArray(value.records)) return false;
  return numberField(value, "total") != null && value.records.every(isExecutionJobRecord);
}

export function normalizeExecutionJobRecord(value: unknown): ExecutionJobRecord | null {
  if (!isRecord(value)) return null;

  const jobId = stringField(value, "job_id");
  const jobType = stringField(value, "job_type");
  const requestedBackend = stringField(value, "requested_backend");
  const executionBackend = stringField(value, "execution_backend");
  const status = stringField(value, "status");
  const progress = numberField(value, "progress");
  const progressMessage = stringField(value, "progress_message");
  const createdAt = stringField(value, "created_at");

  if (
    jobId == null
    || jobType == null
    || requestedBackend == null
    || executionBackend == null
    || status == null
    || createdAt == null
  ) {
    return null;
  }

  const progressUnavailable = progress == null || progressMessage == null;
  const request = objectField(value, "request");
  const rawRunId = stringField(value, "run_id");
  const requestRunId = stringField(request, "run_id");
  const runId = rawRunId ?? requestRunId ?? jobId;
  const isOrphaned = booleanField(value, "is_orphaned") ?? rawRunId == null;
  const runStatus = stringField(value, "run_status") ?? (isOrphaned ? "orphaned" : status);
  const runName = stringField(value, "run_name") ?? stringField(request, "run_name") ?? runId;
  const metrics = optionalObjectField(value, "metrics");
  const error = optionalNullableStringField(value, "error");

  return {
    ...value,
    job_id: jobId,
    job_type: jobType,
    requested_backend: requestedBackend,
    execution_backend: executionBackend,
    execution_mode: nullableStringField(value, "execution_mode"),
    status,
    progress: progress ?? fallbackProgressForStatus(status),
    progress_message: progressMessage ?? "Progress unavailable",
    created_at: createdAt,
    started_at: nullableStringField(value, "started_at"),
    completed_at: nullableStringField(value, "completed_at"),
    request,
    driver: objectField(value, "driver"),
    ...(metrics !== undefined ? { metrics } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(progressUnavailable ? { progress_unavailable: true } : {}),
    run_id: runId,
    run_name: runName,
    run_status: runStatus,
    is_orphaned: isOrphaned,
  };
}

export function normalizeExecutionJobRecordsListPayload(
  value: unknown,
): ExecutionJobRecordsListPayload {
  const source = isRecord(value) ? value : {};
  const rawRecords = Array.isArray(source.records) ? source.records : [];
  const records = rawRecords
    .map(normalizeExecutionJobRecord)
    .filter((record): record is ExecutionJobRecord => record != null);
  const total = numberField(source, "total");

  return {
    ...source,
    records,
    total: total != null ? Math.max(0, Math.floor(total)) : records.length,
  };
}

function normalizeFilterValue(value: ExecutionJobRecordFilterValue): string | null {
  const values = Array.isArray(value) ? value : [value];
  const normalizedValues = values
    .map(item => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
  const uniqueValues = [...new Set(normalizedValues)];

  return uniqueValues.length > 0 ? uniqueValues.join(",") : null;
}

export function buildExecutionJobRecordsQueryParams(
  filters: ExecutionJobRecordFilters = {},
): URLSearchParams {
  const params = new URLSearchParams();
  const runStatus = normalizeFilterValue(filters.run_status);
  const executionStatus = normalizeFilterValue(filters.execution_status);
  const requestedBackend = normalizeFilterValue(filters.requested_backend);

  if (runStatus != null) params.set("run_status", runStatus);
  if (executionStatus != null) params.set("execution_status", executionStatus);
  if (requestedBackend != null) params.set("requested_backend", requestedBackend);
  if (filters.include_orphaned === true) params.set("include_orphaned", "true");

  return params;
}

export function buildExecutionJobRecordsUrl(
  filters: ExecutionJobRecordFilters = {},
): string {
  const params = buildExecutionJobRecordsQueryParams(filters);
  const query = params.toString();
  return query ? `${EXECUTION_JOB_RECORDS_ENDPOINT}?${query}` : EXECUTION_JOB_RECORDS_ENDPOINT;
}

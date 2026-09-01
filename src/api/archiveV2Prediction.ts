import { api } from "./transport";
import type {
  ArchiveV2ArrayPredictionRequest,
  ArchiveV2ArrayPredictionResponse,
} from "@/types/archiveV2Prediction";

export const ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT =
  "/predict/archive-v2" as const;
export const MAX_ARCHIVE_V2_PREDICTION_RESPONSE_BYTES = 2 * 1024 * 1024;

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_SAMPLES = 128;
const MAX_FEATURES = 256;
const MAX_CELLS = 16_384;
const MAX_TARGETS = 64;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_ARCHIVE_REF_BYTES = 240;
const MAX_EXECUTOR_BYTES = 256;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const CORE_METHODS_EXECUTOR =
  /^nirs4all-core@0\.3\.23\+libn4m-abi-2\.2:[a-f0-9]{64}$/;
const encoder = new TextEncoder();

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: JsonRecord, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    byteLength(value) <= MAX_IDENTIFIER_BYTES &&
    IDENTIFIER.test(value)
  );
}

function isUniqueIdentifiers(
  value: unknown,
  maximum: number,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= maximum &&
    value.every(isIdentifier) &&
    new Set(value).size === value.length
  );
}

function isArchiveRef(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    byteLength(value) > MAX_ARCHIVE_REF_BYTES ||
    !value.endsWith(".n4a") ||
    value.startsWith("/") ||
    value.includes("\\")
  ) {
    return false;
  }
  const components = value.split("/");
  return components.every(
    (component) =>
      component !== "." && component !== ".." && isIdentifier(component),
  );
}

function isFiniteMatrix(
  value: unknown,
  rows: number,
  columns?: number,
): value is number[][] {
  if (!Array.isArray(value) || value.length !== rows || rows === 0)
    return false;
  const width = Array.isArray(value[0]) ? value[0].length : 0;
  if (
    width === 0 ||
    width > MAX_FEATURES ||
    rows * width > MAX_CELLS ||
    (columns !== undefined && width !== columns)
  ) {
    return false;
  }
  return value.every(
    (row) =>
      Array.isArray(row) &&
      row.length === width &&
      row.every((item) => typeof item === "number" && Number.isFinite(item)),
  );
}

function assertRequest(value: ArchiveV2ArrayPredictionRequest): void {
  const root = value as unknown as JsonRecord;
  if (
    !isRecord(root) ||
    !hasExactKeys(root, [
      "schema_version",
      "operation",
      "workspace_id",
      "archive",
      "input",
      "execution",
    ]) ||
    root.schema_version !== 1 ||
    root.operation !== "archive_v2_predict" ||
    !isIdentifier(root.workspace_id) ||
    !isRecord(root.archive) ||
    !hasExactKeys(root.archive, ["ref", "sha256"]) ||
    !isArchiveRef(root.archive.ref) ||
    typeof root.archive.sha256 !== "string" ||
    !SHA256.test(root.archive.sha256) ||
    !isRecord(root.input) ||
    !hasExactKeys(root.input, [
      "kind",
      "sample_ids",
      "x",
      "expected_target_names",
    ]) ||
    root.input.kind !== "array" ||
    !isUniqueIdentifiers(root.input.sample_ids, MAX_SAMPLES) ||
    !isUniqueIdentifiers(root.input.expected_target_names, MAX_TARGETS) ||
    !isFiniteMatrix(root.input.x, root.input.sample_ids.length) ||
    !isRecord(root.execution) ||
    !hasExactKeys(root.execution, ["engine", "allow_fallback"]) ||
    root.execution.engine !== "core_rust_methods" ||
    root.execution.allow_fallback !== false ||
    byteLength(JSON.stringify(value)) > MAX_REQUEST_BYTES
  ) {
    throw new TypeError("Invalid native Archive V2 array prediction request");
  }
}

function parseResponse(
  value: unknown,
  request: ArchiveV2ArrayPredictionRequest,
): ArchiveV2ArrayPredictionResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schema_version",
      "operation",
      "archive_id",
      "archive_sha256",
      "engine",
      "fallback_used",
      "sample_ids",
      "target_names",
      "values",
      "provenance",
    ]) ||
    value.schema_version !== 1 ||
    value.operation !== "archive_v2_predict" ||
    !isIdentifier(value.archive_id) ||
    value.archive_sha256 !== request.archive.sha256 ||
    value.engine !== "core_rust_methods" ||
    value.fallback_used !== false ||
    !Array.isArray(value.sample_ids) ||
    !Array.isArray(value.target_names) ||
    value.sample_ids.length !== request.input.sample_ids.length ||
    value.target_names.length !== request.input.expected_target_names.length ||
    !value.sample_ids.every(
      (item, index) => item === request.input.sample_ids[index],
    ) ||
    !value.target_names.every(
      (item, index) => item === request.input.expected_target_names[index],
    ) ||
    !isFiniteMatrix(
      value.values,
      request.input.sample_ids.length,
      request.input.expected_target_names.length,
    ) ||
    !isRecord(value.provenance) ||
    !hasExactKeys(value.provenance, [
      "executor",
      "archive_ref",
      "workspace_id",
    ]) ||
    typeof value.provenance.executor !== "string" ||
    value.provenance.executor.length === 0 ||
    byteLength(value.provenance.executor) > MAX_EXECUTOR_BYTES ||
    !CORE_METHODS_EXECUTOR.test(value.provenance.executor) ||
    value.provenance.archive_ref !== request.archive.ref ||
    value.provenance.workspace_id !== request.workspace_id
  ) {
    throw new TypeError("Invalid native Archive V2 array prediction response");
  }
  return value as unknown as ArchiveV2ArrayPredictionResponse;
}

/**
 * Predict an array with one already-persisted Archive V2 through the native
 * Rust/Core/Methods route. This client has no upload, fit, Python, or fallback
 * branch.
 */
export async function predictPersistedArchiveV2Array(
  request: ArchiveV2ArrayPredictionRequest,
): Promise<ArchiveV2ArrayPredictionResponse> {
  assertRequest(request);
  const response = await api.postBoundedJson<unknown>(
    ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT,
    request,
    MAX_ARCHIVE_V2_PREDICTION_RESPONSE_BYTES,
  );
  return parseResponse(response, request);
}

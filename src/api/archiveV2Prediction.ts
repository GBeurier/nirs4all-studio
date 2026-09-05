import { api } from "./transport";
import type {
  ArchiveV2ArrayPredictionRequest,
  ArchiveV2ArrayPredictionResponse,
  ArchiveV2CatalogueResponse,
  ArchiveV2ConformalPresentation,
  ArchiveV2ConformalPresentationRequest,
  ArchiveV2ConformalProjectionReference,
} from "@/types/archiveV2Prediction";

export const ARCHIVE_V2_ARRAY_PREDICTION_ENDPOINT =
  "/predict/archive-v2" as const;
export const MAX_ARCHIVE_V2_PREDICTION_RESPONSE_BYTES = 2 * 1024 * 1024;
export const MAX_ARCHIVE_V2_CATALOGUE_RESPONSE_BYTES = 256 * 1024;
export const ARCHIVE_V2_CONFORMAL_PRESENTATION_ENDPOINT =
  "/predict/archive-v2/conformal-presentation" as const;
export const MAX_ARCHIVE_V2_CONFORMAL_PRESENTATION_BYTES = 2 * 1024 * 1024;
export const ARCHIVE_V2_CONFORMAL_PROJECTION_ENDPOINT =
  "/predict/archive-v2/conformal-projection" as const;

// Match sidecar/src/matrix_limits.rs: training and prediction share spectral
// width, while prediction batches retain a separate bounded cell budget.
const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const MAX_SAMPLES = 128;
const MAX_FEATURES = 8_192;
const MAX_CELLS = 1_000_000;
const MAX_TARGETS = 64;
const MAX_IDENTIFIER_BYTES = 256;
const MAX_ARCHIVE_REF_BYTES = 240;
const MAX_EXECUTOR_BYTES = 256;
const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[A-Za-z0-9._:-]+$/;
const CORE_METHODS_EXECUTOR =
  /^nirs4all-core@0\.3\.28\+libn4m-abi-2\.5:[a-f0-9]{64}$/;
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

function parseCatalogue(value: unknown, workspaceId: string): ArchiveV2CatalogueResponse {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["schema_version", "operation", "workspace_id", "archives"]) ||
    value.schema_version !== 1 ||
    value.operation !== "archive_v2_catalogue" ||
    value.workspace_id !== workspaceId ||
    !Array.isArray(value.archives) ||
    value.archives.length > 128
  ) {
    throw new TypeError("Invalid native Archive V2 catalogue response");
  }
  const seen = new Set<string>();
  for (const entry of value.archives) {
    if (
      !isRecord(entry) ||
      !hasExactKeys(entry, [
        "archive_id", "archive_ref", "archive_sha256", "n_features",
        "target_names", "descriptor_fingerprint", "identity_status",
      ]) ||
      !isIdentifier(entry.archive_id) ||
      !isArchiveRef(entry.archive_ref) ||
      typeof entry.archive_sha256 !== "string" || !SHA256.test(entry.archive_sha256) ||
      !Number.isSafeInteger(entry.n_features) || (entry.n_features as number) < 1 ||
      (entry.n_features as number) > MAX_FEATURES ||
      !isUniqueIdentifiers(entry.target_names, MAX_TARGETS) ||
      typeof entry.descriptor_fingerprint !== "string" || !SHA256.test(entry.descriptor_fingerprint) ||
      entry.identity_status !== "verified" ||
      seen.has(`${entry.archive_ref}:${entry.archive_sha256}`)
    ) {
      throw new TypeError("Invalid native Archive V2 catalogue response");
    }
    seen.add(`${entry.archive_ref}:${entry.archive_sha256}`);
  }
  return value as unknown as ArchiveV2CatalogueResponse;
}

function isOptionalIdentifier(value: unknown): boolean {
  return value === null || isIdentifier(value);
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isConformalRadius(value: unknown): boolean {
  return isRecord(value) && (
    (hasExactKeys(value, ["status", "value"]) && value.status === "finite" &&
      typeof value.value === "number" && Number.isFinite(value.value) && value.value >= 0) ||
    (hasExactKeys(value, ["status"]) && value.status === "unbounded")
  );
}

function isConformalCell(value: unknown): boolean {
  return isRecord(value) && (
    (hasExactKeys(value, ["status", "lower", "upper"]) && value.status === "finite" &&
      typeof value.lower === "number" && Number.isFinite(value.lower) &&
      typeof value.upper === "number" && Number.isFinite(value.upper) && value.lower <= value.upper) ||
    (hasExactKeys(value, ["status"]) && value.status === "unbounded")
  );
}

function orderedEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function parseConformalPresentation(
  value: unknown,
  request: ArchiveV2ConformalPresentationRequest,
): ArchiveV2ConformalPresentation {
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema_version", "archive_sha256", "package_fingerprint",
    "replay_outcome_fingerprint", "binding_id", "predictor", "dimensions",
    "target_names", "sample_ids", "point_prediction", "interval_block",
    "guarantee", "calibration_fingerprint", "presentation_fingerprint",
  ]) || value.schema_version !== 2 || value.archive_sha256 !== request.archive.sha256 ||
    value.presentation_fingerprint !== request.presentation_fingerprint ||
    typeof value.package_fingerprint !== "string" || !SHA256.test(value.package_fingerprint) ||
    typeof value.replay_outcome_fingerprint !== "string" || !SHA256.test(value.replay_outcome_fingerprint) ||
    typeof value.calibration_fingerprint !== "string" || !SHA256.test(value.calibration_fingerprint) ||
    !isIdentifier(value.binding_id) || !isRecord(value.predictor) ||
    !hasExactKeys(value.predictor, ["model_artifact_fingerprint", "predictor_binding_fingerprint", "predictor_descriptor_fingerprint"]) ||
    ![value.predictor.model_artifact_fingerprint, value.predictor.predictor_binding_fingerprint, value.predictor.predictor_descriptor_fingerprint]
      .every((fingerprint) => typeof fingerprint === "string" && SHA256.test(fingerprint)) ||
    !isRecord(value.dimensions) || !hasExactKeys(value.dimensions, ["sample_count", "target_count"]) ||
    !isPositiveSafeInteger(value.dimensions.sample_count) || !isPositiveSafeInteger(value.dimensions.target_count) ||
    !isUniqueIdentifiers(value.sample_ids, MAX_SAMPLES) || !isUniqueIdentifiers(value.target_names, MAX_TARGETS) ||
    value.dimensions.sample_count !== value.sample_ids.length || value.dimensions.target_count !== value.target_names.length ||
    !isRecord(value.point_prediction) || !hasExactKeys(value.point_prediction, [
      "prediction_id", "producer_node", "producer_port", "partition", "fold_id", "sample_ids", "values", "target_names",
    ]) || !isOptionalIdentifier(value.point_prediction.prediction_id) || !isIdentifier(value.point_prediction.producer_node) ||
    !isOptionalIdentifier(value.point_prediction.producer_port) || typeof value.point_prediction.partition !== "string" ||
    !isOptionalIdentifier(value.point_prediction.fold_id) || !Array.isArray(value.point_prediction.sample_ids) ||
    !Array.isArray(value.point_prediction.target_names) || !orderedEqual(value.point_prediction.sample_ids, value.sample_ids) ||
    !orderedEqual(value.point_prediction.target_names, value.target_names) ||
    !isFiniteMatrix(value.point_prediction.values, value.sample_ids.length, value.target_names.length) ||
    !isRecord(value.interval_block) || !hasExactKeys(value.interval_block, [
      "schema_version", "binding_id", "sample_ids", "intervals", "calibration_fingerprint", "point_prediction_fingerprint",
    ]) || value.interval_block.schema_version !== 2 || value.interval_block.binding_id !== value.binding_id ||
    value.interval_block.calibration_fingerprint !== value.calibration_fingerprint ||
    typeof value.interval_block.point_prediction_fingerprint !== "string" || !SHA256.test(value.interval_block.point_prediction_fingerprint) ||
    !Array.isArray(value.interval_block.sample_ids) || !orderedEqual(value.interval_block.sample_ids, value.sample_ids) ||
    !Array.isArray(value.interval_block.intervals) || value.interval_block.intervals.length === 0 ||
    !isRecord(value.guarantee) || !hasExactKeys(value.guarantee, [
      "calibration_sample_count", "multi_target_policy", "small_sample_policy", "quantiles",
    ]) || !isPositiveSafeInteger(value.guarantee.calibration_sample_count) ||
    !["marginal", "joint_max"].includes(value.guarantee.multi_target_policy as string) ||
    !["error", "unbounded"].includes(value.guarantee.small_sample_policy as string) ||
    !Array.isArray(value.guarantee.quantiles) || value.guarantee.quantiles.length !== value.interval_block.intervals.length
  ) throw new TypeError("Invalid native conformal presentation response");

  const targetCount = value.target_names.length;
  for (let index = 0; index < value.guarantee.quantiles.length; index += 1) {
    const quantile = value.guarantee.quantiles[index];
    const interval = value.interval_block.intervals[index];
    const radiusCount = value.guarantee.multi_target_policy === "marginal" ? targetCount : 1;
    if (!isRecord(quantile) || !hasExactKeys(quantile, ["coverage", "rank", "radii"]) ||
      typeof quantile.coverage !== "number" || !Number.isFinite(quantile.coverage) || quantile.coverage <= 0 || quantile.coverage >= 1 ||
      !isPositiveSafeInteger(quantile.rank) || !Array.isArray(quantile.radii) || quantile.radii.length !== radiusCount ||
      !quantile.radii.every(isConformalRadius) || !isRecord(interval) || !hasExactKeys(interval, ["coverage", "cells"]) ||
      interval.coverage !== quantile.coverage || !Array.isArray(interval.cells) || interval.cells.length !== value.sample_ids.length ||
      !interval.cells.every((row) => Array.isArray(row) && row.length === targetCount && row.every(isConformalCell))) {
      throw new TypeError("Invalid native conformal presentation response");
    }
  }
  return value as unknown as ArchiveV2ConformalPresentation;
}

export async function getPersistedArchiveV2Catalogue(
  workspaceId: string,
): Promise<ArchiveV2CatalogueResponse> {
  if (!isIdentifier(workspaceId)) throw new TypeError("Invalid workspace identifier");
  const endpoint = `/workspaces/${workspaceId}/archive-v2`;
  const response = await api.getBoundedJson<unknown>(
    endpoint,
    MAX_ARCHIVE_V2_CATALOGUE_RESPONSE_BYTES,
  );
  return parseCatalogue(response, workspaceId);
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

/** Load a persisted native presentation; no conformal arithmetic exists here. */
export async function getPersistedArchiveV2ConformalPresentation(
  request: ArchiveV2ConformalPresentationRequest,
): Promise<ArchiveV2ConformalPresentation> {
  const root = request as unknown as JsonRecord;
  if (!isRecord(root) || !hasExactKeys(root, ["schema_version", "operation", "workspace_id", "archive", "presentation_fingerprint"]) ||
    root.schema_version !== 2 || root.operation !== "archive_v2_conformal_presentation" || !isIdentifier(root.workspace_id) ||
    !isRecord(root.archive) || !hasExactKeys(root.archive, ["ref", "sha256"]) || !isArchiveRef(root.archive.ref) ||
    !(root.archive.ref as string).startsWith("artifacts/") || typeof root.archive.sha256 !== "string" || !SHA256.test(root.archive.sha256) ||
    typeof root.presentation_fingerprint !== "string" || !SHA256.test(root.presentation_fingerprint) ||
    byteLength(JSON.stringify(request)) > MAX_REQUEST_BYTES) {
    throw new TypeError("Invalid native conformal presentation request");
  }
  const response = await api.postBoundedJson<unknown>(
    ARCHIVE_V2_CONFORMAL_PRESENTATION_ENDPOINT,
    request,
    MAX_ARCHIVE_V2_CONFORMAL_PRESENTATION_BYTES,
  );
  return parseConformalPresentation(response, request);
}

/** Ask Core to persist the conformal projection for this exact prediction. */
export async function projectPersistedArchiveV2ConformalPresentation(
  request: ArchiveV2ArrayPredictionRequest,
): Promise<ArchiveV2ConformalProjectionReference> {
  assertRequest(request);
  if (!request.archive.ref.startsWith("artifacts/")) {
    throw new TypeError("Conformal projection requires a store-registered Archive V2");
  }
  const value = await api.postBoundedJson<unknown>(
    ARCHIVE_V2_CONFORMAL_PROJECTION_ENDPOINT,
    request,
    MAX_ARCHIVE_V2_CONFORMAL_PRESENTATION_BYTES,
  );
  if (!isRecord(value) || !hasExactKeys(value, [
    "schema_version", "operation", "archive_sha256", "sample_ids",
    "target_names", "presentation_fingerprint",
  ]) || value.schema_version !== 1 || value.operation !== "archive_v2_conformal_projection" ||
    value.archive_sha256 !== request.archive.sha256 || !Array.isArray(value.sample_ids) ||
    !Array.isArray(value.target_names) || !orderedEqual(value.sample_ids, request.input.sample_ids) ||
    !orderedEqual(value.target_names, request.input.expected_target_names) ||
    typeof value.presentation_fingerprint !== "string" || !SHA256.test(value.presentation_fingerprint)) {
    throw new TypeError("Invalid native conformal projection reference");
  }
  return value as unknown as ArchiveV2ConformalProjectionReference;
}

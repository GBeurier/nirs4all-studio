export type RuntimeDiagnosticTone = "error" | "warning" | "info";

/**
 * One normalized runtime diagnostic. Mirrors the rt_error.v1 wire envelope
 * (`nirs4all-ecosystem/docs/contracts/runtime/rt_error.v1.schema.json`):
 * `verb` / `cause` / `message` / `mitigation` / `unsupported_capability` are
 * carried; `portable_level` is opaque (CAP-002) and never interpreted here.
 */
export interface RuntimeDiagnosticItem {
  id: string;
  verb: string | null;
  cause: string | null;
  message: string;
  mitigation: string | null;
  unsupportedCapability: string | null;
  tone: RuntimeDiagnosticTone;
}

export type RuntimeEngineTone = "default" | "success" | "warning" | "muted";

export interface RuntimeEngineStatusView {
  engine: string | null;
  engineLabel: string | null;
  requestedEngine: string | null;
  requestedEngineLabel: string | null;
  badgeLabel: string;
  detailLabel: string | null;
  isFallback: boolean;
  tone: RuntimeEngineTone;
  diagnostics: RuntimeDiagnosticItem[];
}

export interface RuntimeNativeResultsAffordanceInput {
  hasNativeResults?: boolean | null;
  artifactCount?: number | null;
  nativeArtifactCount?: number | null;
  hasRefit?: boolean | null;
  exportLabel?: string | null;
  exportDescription?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
}

export interface RuntimeNativeResultsAffordanceView {
  hasNativeResults: boolean;
  artifactCount: number | null;
  nativeResultsLabel: string;
  exportLabel: string;
  exportDescription: string | null;
  disabled: boolean;
  disabledReason: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readStringField(source: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!source) return null;

  for (const key of keys) {
    const value = source[key];
    if (typeof value !== "string") continue;

    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }

  return null;
}

function readRecordField(source: Record<string, unknown> | null, keys: readonly string[]): Record<string, unknown> | null {
  if (!source) return null;

  for (const key of keys) {
    const record = asRecord(source[key]);
    if (record) return record;
  }

  return null;
}

function readArrayField(source: Record<string, unknown> | null, keys: readonly string[]): unknown[] | null {
  if (!source) return null;

  for (const key of keys) {
    const value = source[key];
    if (Array.isArray(value)) return value;
  }

  return null;
}

function uniqueRecords(records: readonly (Record<string, unknown> | null)[]): Record<string, unknown>[] {
  const seen = new Set<Record<string, unknown>>();
  const result: Record<string, unknown>[] = [];

  for (const record of records) {
    if (!record || seen.has(record)) continue;
    seen.add(record);
    result.push(record);
  }

  return result;
}

function runtimeRecordCandidates(source: unknown): Record<string, unknown>[] {
  const root = asRecord(source);
  if (!root) return [];

  const metadata = readRecordField(root, ["execution_metadata", "executionMetadata", "metadata"]);
  const runtime = readRecordField(root, ["rt_result", "rtResult", "runtime_result", "runtimeResult", "runtime"]);
  const result = readRecordField(runtime, ["result"]);

  return uniqueRecords([root, metadata, runtime, result]);
}

function runtimeManifestCandidates(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return uniqueRecords(records.map(record => readRecordField(record, ["manifest"])));
}

function runtimeConfigCandidates(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return uniqueRecords(records.map(record => readRecordField(record, ["config"])));
}

function runtimeFallbackPolicyCandidates(records: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return uniqueRecords(records.map(record => readRecordField(record, ["fallback_policy", "fallbackPolicy"])));
}

function readStringFromCandidates(
  candidates: readonly Record<string, unknown>[],
  keys: readonly string[],
): string | null {
  for (const candidate of candidates) {
    const value = readStringField(candidate, keys);
    if (value) return value;
  }

  return null;
}

function normalizeDiagnosticMessage(raw: unknown, record: Record<string, unknown> | null): string | null {
  if (typeof raw === "string") return raw.trim() || null;

  const message = readStringField(record, ["message", "detail", "error", "reason"]);
  if (message) return message;

  const cause = readStringField(record, ["cause", "code"]);
  return cause ? formatRuntimeTokenLabel(cause) : null;
}

function resolveDiagnosticTone(record: Record<string, unknown> | null): RuntimeDiagnosticTone {
  const level = readStringField(record, ["severity", "level"])?.toLowerCase();
  if (level === "error" || level === "fatal") return "error";
  if (level === "warning" || level === "warn") return "warning";

  const cause = readStringField(record, ["cause", "code"])?.toLowerCase() ?? "";
  if (
    cause.includes("unsupported")
    || cause.includes("unavailable")
    || cause.includes("fallback")
  ) {
    return "warning";
  }

  return "info";
}

function normalizeRuntimeDiagnostic(raw: unknown, index: number): RuntimeDiagnosticItem | null {
  const record = asRecord(raw);
  const message = normalizeDiagnosticMessage(raw, record);
  if (!message) return null;

  const cause = readStringField(record, ["cause", "code"]);
  const verb = readStringField(record, ["verb", "operation"]);
  const mitigation = readStringField(record, ["mitigation", "hint", "suggestion"]);
  const unsupportedCapability = readStringField(record, ["unsupported_capability", "unsupportedCapability"]);

  return {
    id: `${index}-${cause ?? "diagnostic"}-${message.slice(0, 32)}`,
    verb,
    cause,
    message,
    mitigation,
    unsupportedCapability,
    tone: resolveDiagnosticTone(record),
  };
}

function collectRuntimeDiagnostics(source: unknown): unknown[] {
  if (Array.isArray(source)) return source;

  const candidates = runtimeRecordCandidates(source);
  for (const candidate of candidates) {
    const diagnostics = readArrayField(candidate, [
      "engine_diagnostics",
      "engineDiagnostics",
      "diagnostics",
      "rt_errors",
      "rtErrors",
    ]);
    if (diagnostics && diagnostics.length > 0) return diagnostics;

    const singleDiagnostic = readRecordField(candidate, ["rt_error", "rtError", "diagnostic"]);
    if (singleDiagnostic) return [singleDiagnostic];
  }

  return [];
}

export function normalizeRuntimeDiagnostics(source: unknown): RuntimeDiagnosticItem[] {
  return collectRuntimeDiagnostics(source)
    .map(normalizeRuntimeDiagnostic)
    .filter((item): item is RuntimeDiagnosticItem => item != null);
}

export function formatRuntimeTokenLabel(value: string | null | undefined): string {
  if (!value) return "";

  const normalized = value.trim();
  const lower = normalized.toLowerCase();
  if (lower === "dag-ml" || lower === "dag_ml" || lower === "dagml") return "DAG-ML";
  if (lower === "wasm" || lower === "wasm-local" || lower === "wasm_local") return lower.includes("local") ? "Local WASM" : "WASM";
  if (lower === "n4a") return "N4A";

  return normalized
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => {
      const partLower = part.toLowerCase();
      if (partLower === "ml") return "ML";
      if (partLower === "api") return "API";
      if (partLower === "gpu") return "GPU";
      if (partLower === "cpu") return "CPU";
      return partLower.charAt(0).toUpperCase() + partLower.slice(1);
    })
    .join(" ");
}

/**
 * Format a runtime refusal (an rt_error.v1 envelope normalized to a
 * `RuntimeDiagnosticItem`) as the shared multi-line message hosts show when a
 * strict-mode run is refused (banner, execution log, toast):
 *
 *   `<Verb> refused: <Cause>`
 *   `<message>`
 *   `Mitigation: <mitigation>`              (when present)
 *   `Missing capability: <Capability>`      (when present)
 */
export function formatRuntimeRefusalText(
  item: Pick<RuntimeDiagnosticItem, "verb" | "cause" | "message" | "mitigation" | "unsupportedCapability">,
): string {
  const lines = [
    `${formatRuntimeTokenLabel(item.verb)} refused: ${formatRuntimeTokenLabel(item.cause)}`,
    item.message,
  ];
  if (item.mitigation) lines.push(`Mitigation: ${item.mitigation}`);
  if (item.unsupportedCapability) lines.push(`Missing capability: ${formatRuntimeTokenLabel(item.unsupportedCapability)}`);
  return lines.join("\n");
}

function resolveRuntimeEngineTone(engine: string | null, isFallback: boolean): RuntimeEngineTone {
  if (isFallback) return "warning";
  if (!engine) return "default";

  const normalized = engine.toLowerCase();
  if (normalized === "dag-ml" || normalized === "dag_ml" || normalized === "dagml") return "success";
  if (normalized === "legacy") return "muted";
  return "default";
}

function normalizeRuntimeEngineToken(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, "-");
}

export function buildRuntimeEngineStatus(source: unknown): RuntimeEngineStatusView | null {
  const candidates = runtimeRecordCandidates(source);
  if (candidates.length === 0) return null;

  const manifests = runtimeManifestCandidates(candidates);
  const configs = runtimeConfigCandidates(candidates);
  const fallbackPolicies = runtimeFallbackPolicyCandidates([...candidates, ...configs]);
  const actualEngine = readStringFromCandidates(candidates, [
    "engine_actual",
    "actual_engine",
    "engineActual",
    "actualEngine",
  ]);
  const envelopeEngine = readStringFromCandidates(manifests, ["engine"])
    ?? readStringFromCandidates(candidates.slice(1), ["engine"]);
  const directEngine = readStringFromCandidates(candidates, ["engine"]);
  const requestedEngine = readStringFromCandidates(candidates, [
    "engine_requested",
    "requested_engine",
    "engineRequested",
    "requestedEngine",
  ]) ?? readStringFromCandidates(configs, [
    "engine_requested",
    "requested_engine",
    "engineRequested",
    "requestedEngine",
    "engine",
  ]) ?? readStringFromCandidates(fallbackPolicies, [
    "engine_requested",
    "requested_engine",
    "engineRequested",
    "requestedEngine",
  ]);
  const engine = actualEngine ?? envelopeEngine ?? directEngine;

  if (!engine && !requestedEngine) return null;

  const diagnostics = normalizeRuntimeDiagnostics(source);
  const isFallback = Boolean(
    engine
    && requestedEngine
    && normalizeRuntimeEngineToken(engine) !== normalizeRuntimeEngineToken(requestedEngine),
  );
  const engineLabel = engine ? formatRuntimeTokenLabel(engine) : null;
  const requestedEngineLabel = requestedEngine ? formatRuntimeTokenLabel(requestedEngine) : null;
  const badgeLabel = isFallback
    ? `${engineLabel} fallback`
    : engineLabel ?? `Requested ${requestedEngineLabel}`;
  const detailLabel = isFallback
    ? `Requested ${requestedEngineLabel}`
    : requestedEngineLabel && requestedEngine !== engine
      ? `Requested ${requestedEngineLabel}`
      : null;

  return {
    engine,
    engineLabel,
    requestedEngine,
    requestedEngineLabel,
    badgeLabel,
    detailLabel,
    isFallback,
    tone: resolveRuntimeEngineTone(engine, isFallback),
    diagnostics,
  };
}

function formatNativeArtifactCount(count: number | null): string {
  if (count == null) return "Native results";
  return `${count} native ${count === 1 ? "artifact" : "artifacts"}`;
}

export function buildRuntimeNativeResultsAffordance(
  input: RuntimeNativeResultsAffordanceInput = {},
): RuntimeNativeResultsAffordanceView {
  const rawCount = input.nativeArtifactCount ?? input.artifactCount ?? null;
  const artifactCount = typeof rawCount === "number" && Number.isFinite(rawCount)
    ? Math.max(0, Math.floor(rawCount))
    : null;
  const hasNativeResults = input.hasNativeResults === true || (artifactCount != null && artifactCount > 0);
  const exportLabel = input.exportLabel
    ?? (input.hasRefit ? "Export Final Model (.n4a)" : "Export Model (.n4a)");
  const exportDescription = input.exportDescription
    ?? (input.hasRefit ? "Exports the refit model trained on the full dataset" : null);
  const disabledReason = input.disabledReason
    ?? (hasNativeResults ? null : "Native result artifacts are not attached for this run.");

  return {
    hasNativeResults,
    artifactCount,
    nativeResultsLabel: hasNativeResults
      ? formatNativeArtifactCount(artifactCount)
      : "Native results not attached",
    exportLabel,
    exportDescription,
    disabled: input.disabled === true || !hasNativeResults || disabledReason != null,
    disabledReason,
  };
}

export const TUNING_ORDERED_SEARCH_SPACE_FORMAT = "nirs4all.tuning.ordered_search_space" as const;
export const TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION = 1 as const;
export const TUNING_ORDERED_SEARCH_SPACE_SCHEMA_ID = "https://nirs4all.org/schemas/tuning-ordered-search-space/v1" as const;

export type JsonNativeValue =
  | null
  | boolean
  | number
  | string
  | JsonNativeValue[]
  | { [key: string]: JsonNativeValue };

export interface TuningSearchSpaceParameter {
  index: number;
  path: string;
  segments: string[];
  spec: JsonNativeValue;
}

export interface TuningParameterPatch {
  path: string;
  segments: string[];
  value: JsonNativeValue;
}

export interface OrderedTuningSearchSpaceArtifact {
  fingerprint: string;
  force_params: TuningParameterPatch[];
  format: typeof TUNING_ORDERED_SEARCH_SPACE_FORMAT;
  parameters: TuningSearchSpaceParameter[];
  schema_version: typeof TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION;
  tuning_fingerprint: string;
}

export interface TuningSearchSpaceParameterRow {
  forced: boolean;
  forcedValue: JsonNativeValue | null;
  forcedValueLabel: string | null;
  index: number;
  path: string;
  segments: string[];
  spec: JsonNativeValue;
  specLabel: string;
}

export interface TuningSearchSpacePreview {
  fingerprint: string;
  forceParamCount: number;
  forceParams: TuningParameterPatch[];
  format: typeof TUNING_ORDERED_SEARCH_SPACE_FORMAT;
  parameterCount: number;
  parameters: TuningSearchSpaceParameterRow[];
  schemaId: typeof TUNING_ORDERED_SEARCH_SPACE_SCHEMA_ID;
  schemaVersion: typeof TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION;
  tuningFingerprint: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isFingerprint(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export function isJsonNativeValue(value: unknown): value is JsonNativeValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonNativeValue);
  if (!isRecord(value)) return false;
  return Object.values(value).every(isJsonNativeValue);
}

function isSegmentsForPath(segments: unknown, path: string): segments is string[] {
  return (
    Array.isArray(segments)
    && segments.length > 0
    && segments.every(isNonEmptyString)
    && segments.join(".") === path
  );
}

export function isTuningSearchSpaceParameter(value: unknown): value is TuningSearchSpaceParameter {
  return (
    isRecord(value)
    && Number.isInteger(value.index)
    && typeof value.index === "number"
    && value.index >= 0
    && isNonEmptyString(value.path)
    && isSegmentsForPath(value.segments, value.path)
    && isJsonNativeValue(value.spec)
  );
}

export function isTuningParameterPatch(value: unknown): value is TuningParameterPatch {
  return (
    isRecord(value)
    && isNonEmptyString(value.path)
    && isSegmentsForPath(value.segments, value.path)
    && isJsonNativeValue(value.value)
  );
}

function hasUniquePaths(values: ReadonlyArray<{ path: string }>): boolean {
  const paths = values.map((value) => value.path);
  return paths.length === new Set(paths).size;
}

function hasOrderedIndexes(parameters: readonly TuningSearchSpaceParameter[]): boolean {
  return parameters.every((parameter, position) => parameter.index === position);
}

function forceParamsAreSubset(
  parameters: readonly TuningSearchSpaceParameter[],
  forceParams: readonly TuningParameterPatch[],
): boolean {
  const parameterPaths = new Set(parameters.map((parameter) => parameter.path));
  return forceParams.every((patch) => parameterPaths.has(patch.path));
}

export function isOrderedTuningSearchSpaceArtifact(value: unknown): value is OrderedTuningSearchSpaceArtifact {
  if (
    !isRecord(value)
    || value.format !== TUNING_ORDERED_SEARCH_SPACE_FORMAT
    || value.schema_version !== TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION
    || !isFingerprint(value.fingerprint)
    || !isFingerprint(value.tuning_fingerprint)
    || !Array.isArray(value.parameters)
    || !Array.isArray(value.force_params)
    || !value.parameters.every(isTuningSearchSpaceParameter)
    || !value.force_params.every(isTuningParameterPatch)
  ) {
    return false;
  }

  return (
    hasOrderedIndexes(value.parameters)
    && hasUniquePaths(value.parameters)
    && hasUniquePaths(value.force_params)
    && forceParamsAreSubset(value.parameters, value.force_params)
  );
}

export function parseOrderedTuningSearchSpaceArtifact(value: unknown): OrderedTuningSearchSpaceArtifact {
  if (isOrderedTuningSearchSpaceArtifact(value)) return value;

  throw new TypeError("Expected a nirs4all.tuning.ordered_search_space payload.");
}

export function formatTuningSearchSpaceValue(value: JsonNativeValue): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

export function createTuningSearchSpacePreview(
  artifact: OrderedTuningSearchSpaceArtifact,
): TuningSearchSpacePreview {
  const forcedValues = new Map(artifact.force_params.map((patch) => [patch.path, patch.value]));
  const parameters = artifact.parameters.map((parameter) => {
    const forced = forcedValues.has(parameter.path);
    const forcedValue = forced ? forcedValues.get(parameter.path) as JsonNativeValue : null;

    return {
      forced,
      forcedValue,
      forcedValueLabel: forced ? formatTuningSearchSpaceValue(forcedValue) : null,
      index: parameter.index,
      path: parameter.path,
      segments: parameter.segments,
      spec: parameter.spec,
      specLabel: formatTuningSearchSpaceValue(parameter.spec),
    };
  });

  return {
    fingerprint: artifact.fingerprint,
    forceParamCount: artifact.force_params.length,
    forceParams: artifact.force_params,
    format: artifact.format,
    parameterCount: artifact.parameters.length,
    parameters,
    schemaId: TUNING_ORDERED_SEARCH_SPACE_SCHEMA_ID,
    schemaVersion: artifact.schema_version,
    tuningFingerprint: artifact.tuning_fingerprint,
  };
}

import {
  TUNING_ORDERED_SEARCH_SPACE_FORMAT,
  TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION,
  createTuningSearchSpacePreview,
  isJsonNativeValue,
  parseOrderedTuningSearchSpaceArtifact,
  type JsonNativeValue,
  type OrderedTuningSearchSpaceArtifact,
  type TuningParameterPatch,
  type TuningSearchSpaceParameter,
  type TuningSearchSpacePreview,
} from "@/ui/tuning";
import { serializeFinetuneParamConfig } from "@/utils/pipelineFinetuneParams";
import type { FinetuneConfig, FinetuneParamConfig } from "../types";

export const STUDIO_TUNING_SPACE_PREVIEW_FINGERPRINT_KIND =
  "studio_preview_non_tcv1" as const;

export type StudioTuningSpacePreviewIssueCode =
  | "duplicate_parameter_path"
  | "empty_search_space"
  | "finetune_disabled"
  | "invalid_force_param_path"
  | "invalid_force_param_value"
  | "invalid_parameter_name"
  | "invalid_parameter_spec"
  | "invalid_preview_artifact";

export interface StudioTuningSpacePreviewIssue {
  code: StudioTuningSpacePreviewIssueCode;
  message: string;
  path?: string;
}

export interface BuildStudioTuningSpacePreviewOptions {
  /**
   * Backwards-compatible alias for `modelParameterPrefix`.
   *
   * Studio stores model-local parameter names in `FinetuneConfig.model_params`.
   * The preview exposes them as native ordered search-space paths, e.g.
   * `model.n_components`.
   */
  parameterPrefix?: string | readonly string[];
  /**
   * Canonical path prefix used for `FinetuneConfig.model_params`.
   */
  modelParameterPrefix?: string | readonly string[];
  /**
   * Canonical path prefix used for `FinetuneConfig.train_params`.
   */
  trainParameterPrefix?: string | readonly string[];
  /**
   * Optional preview-only force params. Keys may be canonical paths such as
   * `model.n_components` / `train.batch_size` or unambiguous bare names such
   * as `n_components`.
   */
  forceParams?: Record<string, unknown>;
}

export interface StudioTuningSpacePreviewResult {
  artifact: OrderedTuningSearchSpaceArtifact | null;
  enabled: boolean;
  fingerprintKind: typeof STUDIO_TUNING_SPACE_PREVIEW_FINGERPRINT_KIND;
  issues: StudioTuningSpacePreviewIssue[];
  preview: TuningSearchSpacePreview | null;
}

function normalizePrefixSegments(prefix: string | readonly string[] | undefined): string[] {
  if (Array.isArray(prefix)) {
    return prefix.map((segment) => segment.trim()).filter(Boolean);
  }

  const normalizedPrefix = prefix ?? "model";
  return normalizedPrefix
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function pathSegmentsForName(
  name: string,
  prefixSegments: readonly string[],
): string[] | null {
  const nameSegments = name
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (nameSegments.length === 0) {
    return null;
  }

  return [...prefixSegments, ...nameSegments];
}

function normalizeForceParamPath(
  rawPath: string,
  pathAliases: ReadonlyMap<string, string>,
): string | null {
  const trimmedPath = rawPath.trim();
  if (trimmedPath.length === 0) {
    return null;
  }
  return pathAliases.get(trimmedPath) ?? trimmedPath;
}

function stableStringifyJson(value: JsonNativeValue): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyJson).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringifyJson(value[key])}`)
    .join(",")}}`;
}

function hash32Hex(input: string, seed: number): string {
  let hash = (0x811c9dc5 ^ seed) >>> 0;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function previewFingerprint(label: string, payload: JsonNativeValue): string {
  const input = `${label}\0${stableStringifyJson(payload)}`;
  return Array.from({ length: 8 }, (_unused, index) =>
    hash32Hex(`${input}\0${index}`, index)
  ).join("");
}

function serializedParamSpec(param: FinetuneParamConfig): JsonNativeValue | null {
  const spec = serializeFinetuneParamConfig(param);
  return isJsonNativeValue(spec) ? spec : null;
}

function buildForceParams(
  forceParams: Record<string, unknown> | undefined,
  pathAliases: ReadonlyMap<string, string>,
  parameterPaths: ReadonlySet<string>,
  issues: StudioTuningSpacePreviewIssue[],
): TuningParameterPatch[] {
  if (!forceParams) {
    return [];
  }

  const patches: TuningParameterPatch[] = [];
  const seenPaths = new Set<string>();

  for (const [rawPath, value] of Object.entries(forceParams)) {
    const path = normalizeForceParamPath(rawPath, pathAliases);
    if (!path) {
      issues.push({
        code: "invalid_force_param_path",
        message: `Force param "${rawPath}" does not map to a native tuning path.`,
        path: rawPath,
      });
      continue;
    }
    if (!parameterPaths.has(path)) {
      issues.push({
        code: "invalid_force_param_path",
        message: `Force param "${path}" is not part of the current search space.`,
        path,
      });
      continue;
    }
    if (seenPaths.has(path)) {
      issues.push({
        code: "invalid_force_param_path",
        message: `Force param "${path}" is declared more than once.`,
        path,
      });
      continue;
    }
    if (!isJsonNativeValue(value)) {
      issues.push({
        code: "invalid_force_param_value",
        message: `Force param "${path}" is not a JSON-native value.`,
        path,
      });
      continue;
    }

    seenPaths.add(path);
    patches.push({
      path,
      segments: path.split("."),
      value,
    });
  }

  return patches;
}

function registerPathAliases(
  pathAliases: Map<string, string>,
  path: string,
  name: string,
): void {
  pathAliases.set(path, path);
  if (!pathAliases.has(name)) {
    pathAliases.set(name, path);
    return;
  }
  if (pathAliases.get(name) !== path) {
    pathAliases.delete(name);
  }
}

function appendFinetuneParameters(
  params: readonly FinetuneParamConfig[],
  prefixSegments: readonly string[],
  parameters: TuningSearchSpaceParameter[],
  seenPaths: Set<string>,
  pathAliases: Map<string, string>,
  issues: StudioTuningSpacePreviewIssue[],
): void {
  for (const param of params) {
    const segments = pathSegmentsForName(param.name, prefixSegments);
    if (!segments) {
      issues.push({
        code: "invalid_parameter_name",
        message: "A finetuning parameter has an empty native path.",
      });
      continue;
    }

    const path = segments.join(".");
    if (seenPaths.has(path)) {
      issues.push({
        code: "duplicate_parameter_path",
        message: `Parameter "${path}" is declared more than once.`,
        path,
      });
      continue;
    }

    const spec = serializedParamSpec(param);
    if (spec === null) {
      issues.push({
        code: "invalid_parameter_spec",
        message: `Parameter "${path}" is not JSON-native and cannot be previewed.`,
        path,
      });
      continue;
    }

    seenPaths.add(path);
    registerPathAliases(pathAliases, path, param.name);
    parameters.push({
      index: parameters.length,
      path,
      segments,
      spec,
    });
  }
}

export function buildStudioTuningSpacePreview(
  config: FinetuneConfig,
  options: BuildStudioTuningSpacePreviewOptions = {},
): StudioTuningSpacePreviewResult {
  const issues: StudioTuningSpacePreviewIssue[] = [];
  const resultBase = {
    enabled: config.enabled,
    fingerprintKind: STUDIO_TUNING_SPACE_PREVIEW_FINGERPRINT_KIND,
    issues,
  };

  if (!config.enabled) {
    issues.push({
      code: "finetune_disabled",
      message: "Finetuning is disabled; no ordered search-space preview is available.",
    });
    return { ...resultBase, artifact: null, preview: null };
  }

  const modelPrefixSegments = normalizePrefixSegments(
    options.modelParameterPrefix ?? options.parameterPrefix,
  );
  const trainPrefixSegments = normalizePrefixSegments(options.trainParameterPrefix ?? "train");
  const parameters: TuningSearchSpaceParameter[] = [];
  const seenPaths = new Set<string>();
  const pathAliases = new Map<string, string>();

  appendFinetuneParameters(
    config.model_params,
    modelPrefixSegments,
    parameters,
    seenPaths,
    pathAliases,
    issues,
  );
  appendFinetuneParameters(
    config.train_params ?? [],
    trainPrefixSegments,
    parameters,
    seenPaths,
    pathAliases,
    issues,
  );

  if (parameters.length === 0) {
    issues.push({
      code: "empty_search_space",
      message: "The finetuning model search space is empty.",
    });
    return { ...resultBase, artifact: null, preview: null };
  }

  const parameterPaths = new Set(parameters.map((parameter) => parameter.path));
  const forceParams = buildForceParams(
    options.forceParams,
    pathAliases,
    parameterPaths,
    issues,
  );

  if (issues.some((issue) => issue.code !== "finetune_disabled")) {
    return { ...resultBase, artifact: null, preview: null };
  }

  const fingerprintPayload: JsonNativeValue = {
    force_params: forceParams,
    parameters,
    source: "nirs4all-studio",
  };
  const tuningFingerprintPayload: JsonNativeValue = {
    approach: config.approach,
    eval_mode: config.eval_mode,
    n_trials: config.n_trials,
    sample: config.sample ?? null,
    source: "nirs4all-studio",
    storage: config.storage ?? null,
    study_name: config.study_name ?? null,
    timeout: config.timeout ?? null,
  };

  try {
    const artifact = parseOrderedTuningSearchSpaceArtifact({
      fingerprint: previewFingerprint("studio.search_space", fingerprintPayload),
      force_params: forceParams,
      format: TUNING_ORDERED_SEARCH_SPACE_FORMAT,
      parameters,
      schema_version: TUNING_ORDERED_SEARCH_SPACE_SCHEMA_VERSION,
      tuning_fingerprint: previewFingerprint("studio.tuning", tuningFingerprintPayload),
    });
    return {
      ...resultBase,
      artifact,
      preview: createTuningSearchSpacePreview(artifact),
    };
  } catch (error) {
    issues.push({
      code: "invalid_preview_artifact",
      message:
        error instanceof Error
          ? error.message
          : "Studio could not build a valid ordered search-space preview artifact.",
    });
    return { ...resultBase, artifact: null, preview: null };
  }
}

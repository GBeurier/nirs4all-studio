import type { PipelineRun, RunMetrics } from "@/types/runs";

export type DisplayMetrics = Partial<RunMetrics>;

const CLASS_PATH_PATTERN = /^(?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*$/;
const SERIALIZED_CLASS_TOKEN_PATTERN = /\{\s*['"]class['"]\s*:\s*['"]([^'"]+)['"](?:\s*,\s*['"]params['"]\s*:\s*\{([^{}]*)\})?[^{}]*\}|['"]((?:[A-Za-z_][\w]*\.)+[A-Za-z_][\w]*)['"]/g;
const KEY_VALUE_PATTERN = /['"]?([A-Za-z_][\w-]*)['"]?\s*:\s*([^,{}]+)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function extractClassName(classPath: string): string {
  const trimmed = classPath.trim().replace(/^['"]|['"]$/g, "");
  const segments = trimmed.split(".");
  return segments[segments.length - 1] || trimmed;
}

function formatScalarValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
  if (CLASS_PATH_PATTERN.test(unquoted)) {
    return extractClassName(unquoted);
  }

  const serializedValue = formatSerializedDisplayValue(trimmed);
  if (serializedValue && serializedValue !== trimmed) {
    return serializedValue;
  }

  return unquoted;
}

function formatParamsSource(paramsSource: string | undefined): string {
  if (!paramsSource) return "";

  const parts: string[] = [];
  for (const match of paramsSource.matchAll(KEY_VALUE_PATTERN)) {
    parts.push(`${match[1]}:${formatScalarValue(match[2])}`);
  }

  return parts.join(", ");
}

function formatParamsObject(params: Record<string, unknown>): string {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}:${formatUnknownValue(value)}`)
    .join(", ");
}

function formatClassSpec(classPath: string, paramsSource?: string): string {
  const className = extractClassName(classPath);
  const paramsText = formatParamsSource(paramsSource);
  return paramsText ? `${className}(${paramsText})` : className;
}

function formatObjectValue(record: Record<string, unknown>): string {
  const classPath =
    typeof record.class === "string"
      ? record.class
      : typeof record.name === "string"
        ? record.name
        : null;

  if (classPath) {
    const params = isRecord(record.params) ? formatParamsObject(record.params) : "";
    const className = formatScalarValue(classPath);
    return params ? `${className}(${params})` : className;
  }

  return Object.entries(record)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}: ${formatUnknownValue(value)}`)
    .join(", ");
}

export function formatUnknownValue(value: unknown): string {
  if (value === undefined || value === null) return "";

  if (typeof value === "string") {
    return formatSerializedDisplayValue(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatUnknownValue(item))
      .filter(Boolean)
      .join(", ");
  }

  if (isRecord(value)) {
    return formatObjectValue(value);
  }

  return String(value);
}

export function formatSerializedDisplayValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  const unquoted = trimmed.replace(/^['"]|['"]$/g, "");
  if (CLASS_PATH_PATTERN.test(unquoted)) {
    return extractClassName(unquoted);
  }

  const serializedParts: string[] = [];
  for (const match of trimmed.matchAll(SERIALIZED_CLASS_TOKEN_PATTERN)) {
    if (match[1]) {
      serializedParts.push(formatClassSpec(match[1], match[2]));
      continue;
    }
    if (match[3]) {
      serializedParts.push(extractClassName(match[3]));
    }
  }

  if (serializedParts.length > 0) {
    return serializedParts.join(", ");
  }

  if (trimmed.includes("->") || trimmed.includes("→")) {
    return trimmed
      .split(/\s*(?:->|→)\s*/)
      .map((segment) => formatScalarValue(segment))
      .filter(Boolean)
      .join(" → ");
  }

  return unquoted;
}

export function formatPipelineVariantLabel(
  variantChoices: Record<string, unknown> | null | undefined,
  variantDescription: string | null | undefined
): string | null {
  const choiceEntries = Object.entries(variantChoices ?? {}).filter(
    ([, value]) => value !== undefined && value !== null && value !== ""
  );

  if (choiceEntries.length > 0) {
    const parts = choiceEntries
      .map(([key, value]) => {
        const formatted = formatUnknownValue(value);
        if (!formatted) return null;

        const omitKey = Array.isArray(value) || (isRecord(value) && ("class" in value || "name" in value));
        return omitKey ? formatted : `${key}: ${formatted}`;
      })
      .filter((part): part is string => Boolean(part));

    if (parts.length > 0) {
      return parts.join(" | ");
    }
  }

  const formattedDescription = variantDescription ? formatSerializedDisplayValue(variantDescription) : "";
  return formattedDescription || null;
}

export function formatPipelineChainLabel(
  preprocessing: string | null | undefined,
  pipelineName: string | null | undefined,
  model: string | null | undefined
): string {
  const preprocessingLabel = preprocessing ? formatSerializedDisplayValue(preprocessing) : "";
  if (preprocessingLabel && preprocessingLabel !== "None") {
    return preprocessingLabel;
  }

  const pipelineLabel = pipelineName ? formatSerializedDisplayValue(pipelineName) : "";
  if (pipelineLabel && pipelineLabel !== model) {
    return pipelineLabel;
  }

  return "";
}

export function getPipelineFitCount(
  pipeline: Pick<PipelineRun, "total_model_count" | "model_count_breakdown" | "fold_count" | "branch_count" | "tested_variants" | "estimated_variants">
): number | null {
  if (typeof pipeline.total_model_count === "number") {
    return pipeline.total_model_count;
  }

  const breakdownMatch = pipeline.model_count_breakdown?.match(/=\s*(\d+)\s+models?/i);
  if (breakdownMatch) {
    return Number.parseInt(breakdownMatch[1], 10);
  }

  if (
    pipeline.fold_count != null ||
    pipeline.branch_count != null ||
    pipeline.tested_variants != null ||
    pipeline.estimated_variants != null
  ) {
    const foldCount = pipeline.fold_count ?? 1;
    const branchCount = pipeline.branch_count ?? 1;
    const variantCount = pipeline.tested_variants ?? pipeline.estimated_variants ?? 1;
    return foldCount * branchCount * variantCount;
  }

  return null;
}

export function getPipelineFoldCount(
  pipeline: Pick<PipelineRun, "fold_count" | "model_count_breakdown">
): number | null {
  if (typeof pipeline.fold_count === "number") {
    return pipeline.fold_count;
  }

  const breakdownMatch = pipeline.model_count_breakdown?.match(/(\d+)\s+folds?/i);
  return breakdownMatch ? Number.parseInt(breakdownMatch[1], 10) : null;
}

export function getPipelineDisplayMetrics(
  pipeline: Pick<PipelineRun, "metrics" | "fold_metrics">
): DisplayMetrics | undefined {
  if (pipeline.metrics) {
    return pipeline.metrics;
  }

  const folds = Object.values(pipeline.fold_metrics ?? {});
  if (folds.length === 0) {
    return undefined;
  }

  const keys: Array<keyof RunMetrics> = ["r2", "rmse", "mae", "rpd", "nrmse"];
  const result: DisplayMetrics = {};

  for (const key of keys) {
    const values = folds
      .map((metrics) => metrics[key])
      .filter((value): value is number => typeof value === "number");

    if (values.length > 0) {
      result[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

export function buildPipelinePrimarySummary(
  pipelineIndex: number | null | undefined,
  totalPipelines: number | null | undefined,
  pipeline: Pick<PipelineRun, "total_model_count" | "model_count_breakdown" | "fold_count" | "branch_count" | "tested_variants" | "estimated_variants">
): string {
  const parts: string[] = [];

  if (pipelineIndex != null && totalPipelines != null && totalPipelines > 0) {
    parts.push(`${pipelineIndex}/${totalPipelines}`);
  }

  const fitCount = getPipelineFitCount(pipeline);
  if (fitCount != null) {
    parts.push(`${fitCount} fits`);
  }

  return parts.join(" · ");
}

export function buildPipelineCompactSummary(
  pipeline: Pick<PipelineRun, "fold_count" | "model_count_breakdown" | "model" | "preprocessing" | "pipeline_name">
): string {
  const parts: string[] = [];
  const foldCount = getPipelineFoldCount(pipeline);
  if (foldCount != null) {
    parts.push(`${foldCount} folds`);
  }

  if (pipeline.model) {
    parts.push(formatSerializedDisplayValue(pipeline.model));
  }

  const chainLabel = formatPipelineChainLabel(pipeline.preprocessing, pipeline.pipeline_name, pipeline.model);
  if (chainLabel) {
    parts.push(chainLabel);
  }

  return parts.join(" · ");
}
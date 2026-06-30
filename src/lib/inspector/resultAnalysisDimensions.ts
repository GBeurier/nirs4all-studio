import type { InspectorChainSummary } from "@/types/inspector";

export type ResultAnalysisMatrixAxisField =
  | "dataset_name"
  | "model_class"
  | "preprocessings"
  | "pipeline_id"
  | "pipeline_name"
  | "metric"
  | "run_id";

export type ResultAnalysisGroupField =
  | ResultAnalysisMatrixAxisField
  | "task_type"
  | "target_name"
  | "backend"
  | "content_address";

export interface ResultAnalysisMetadata {
  target_name?: unknown;
  backend?: unknown;
  content_address?: unknown;
  dimensions?: unknown;
}

export function normalizedResultAnalysisString(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

export function getResultAnalysisMetadata(chain: InspectorChainSummary): ResultAnalysisMetadata {
  const variantParams = chain.variant_params;
  if (!variantParams || typeof variantParams !== "object" || Array.isArray(variantParams)) {
    return {};
  }

  const metadata = (variantParams as Record<string, unknown>).result_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }
  return metadata as ResultAnalysisMetadata;
}

export function getResultAnalysisMetadataDimension(
  metadata: ResultAnalysisMetadata,
  key: string,
): unknown {
  if (!metadata.dimensions || typeof metadata.dimensions !== "object" || Array.isArray(metadata.dimensions)) {
    return undefined;
  }
  return (metadata.dimensions as Record<string, unknown>)[key];
}

export function matchesResultAnalysisDimensions(
  metadata: ResultAnalysisMetadata,
  dimensions: Record<string, readonly unknown[]> | undefined,
): boolean {
  if (!dimensions) return true;

  return Object.entries(dimensions).every(([key, allowedValues]) => {
    if (allowedValues.length === 0) return true;
    const actual = normalizedResultAnalysisString(getResultAnalysisMetadataDimension(metadata, key));
    return new Set(allowedValues.map(normalizedResultAnalysisString)).has(actual);
  });
}

export function matchesResultAnalysisMetadataFields(
  metadata: ResultAnalysisMetadata,
  fields: Record<string, readonly unknown[]> | undefined,
): boolean {
  if (!fields) return true;

  return Object.entries(fields).every(([key, allowedValues]) => {
    if (allowedValues.length === 0) return true;
    const actual = normalizedResultAnalysisString((metadata as Record<string, unknown>)[key]);
    return new Set(allowedValues.map(normalizedResultAnalysisString)).has(actual);
  });
}

export function getResultAnalysisAxisLabel(
  chain: InspectorChainSummary,
  field: ResultAnalysisMatrixAxisField,
): string {
  if (field === "pipeline_name") {
    return normalizedResultAnalysisString(chain.pipeline_name)
      || normalizedResultAnalysisString(chain.pipeline_id)
      || "(empty)";
  }
  return normalizedResultAnalysisString(chain[field]) || "(empty)";
}

export function getResultAnalysisGroupLabel(
  chain: InspectorChainSummary,
  field: ResultAnalysisGroupField,
): string {
  const metadata = getResultAnalysisMetadata(chain);
  switch (field) {
    case "target_name":
      return normalizedResultAnalysisString(metadata.target_name) || "(empty)";
    case "backend":
      return normalizedResultAnalysisString(metadata.backend) || "(empty)";
    case "content_address":
      return normalizedResultAnalysisString(metadata.content_address) || "(empty)";
    case "task_type":
      return normalizedResultAnalysisString(chain.task_type) || "(empty)";
    default:
      return getResultAnalysisAxisLabel(chain, field);
  }
}

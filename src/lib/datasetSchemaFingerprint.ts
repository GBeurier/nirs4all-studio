import type { DatasetSchemaTaskType } from "./datasetSchema";
import type { DatasetAggregationRef } from "./datasetSchemaAggregation";

export interface DatasetSchemaFingerprintInput {
  datasetId: string;
  hash?: string;
  sampleCount: number | null;
  featureCount: number | null;
  sourceCount: number | null;
  targetColumns: string[];
  defaultTargetColumn: string | null;
  metadataColumns: string[];
  repetitionColumn: string | null;
  aggregation: DatasetAggregationRef;
  taskType: DatasetSchemaTaskType;
}

export function stableDatasetSchemaStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableDatasetSchemaStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableDatasetSchemaStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

export function stableDatasetSchemaHash(value: unknown): string {
  const serialized = stableDatasetSchemaStringify(value);
  let hash = 0;
  for (let index = 0; index < serialized.length; index += 1) {
    hash = (hash * 31 + serialized.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

export function buildDatasetSchemaFingerprint(input: DatasetSchemaFingerprintInput): string {
  if (input.hash) return `dataset:${input.hash}`;
  return `legacy:${stableDatasetSchemaHash(input)}`;
}

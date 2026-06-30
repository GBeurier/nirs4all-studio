import type { DatasetSchemaRef } from "@/lib/datasetSchema";

export interface PlaygroundDatasetSelectOption {
  value: string;
  label: string;
}

export function buildDatasetSourceOptions(
  sourceCount: number | null | undefined,
): PlaygroundDatasetSelectOption[] {
  return Array.from(
    { length: Math.max(sourceCount ?? 1, 1) },
    (_, index) => ({
      value: String(index),
      label: `Source ${index + 1}`,
    }),
  );
}

export function buildDatasetTargetOptions(
  schemaRef: Pick<DatasetSchemaRef, "targetRefs" | "targetColumns"> | null | undefined,
): PlaygroundDatasetSelectOption[] {
  if (!schemaRef) {
    return [];
  }

  if (schemaRef.targetRefs.length > 0) {
    return schemaRef.targetRefs.map((target, index) => ({
      value: String(index),
      label: target.label || target.column || `Target ${index + 1}`,
    }));
  }

  return schemaRef.targetColumns.map((column, index) => ({
    value: String(index),
    label: column || `Target ${index + 1}`,
  }));
}

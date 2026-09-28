/** Presentation-only projection of a saved, typed multimodal cohort. */
export interface MultimodalSourceSummary {
  name: string;
  representation: string;
  shape: number[];
  present: number;
  missing: number;
  ragged: boolean;
}

export interface MultimodalDatasetSummary {
  samples: number;
  alignment: string;
  task: string | null;
  targets: string[];
  partitions: Record<string, number>;
  sources: MultimodalSourceSummary[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value as string[]
    : null;
}

function shape(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item >= 0)
    ? value as number[]
    : null;
}

/** Keep a recognized typed descriptor out of legacy flat preview paths. */
export function isStudioMultimodalDatasetDocument(document: unknown): boolean {
  return record(document)?.schema === "nirs4all.studio-multimodal-dataset.v1";
}

/** Read only declared identities, shapes and presence flags; never interpret array values. */
export function getMultimodalDatasetSummary(document: unknown): MultimodalDatasetSummary | null {
  const outer = record(document);
  const cohort = record(outer?.cohort);
  if (outer?.schema !== "nirs4all.studio-multimodal-dataset.v1"
      || cohort?.schema !== "nirs4all.multimodal-dataset"
      || cohort.schema_version !== 1) return null;
  const ids = strings(cohort.sample_ids);
  const sources = cohort.sources;
  if (!ids || !Array.isArray(sources) || sources.length === 0) return null;
  const sampleCount = ids.length;
  const cohortIds = new Set(ids);
  if (cohortIds.size !== sampleCount) return null;
  const alignment = cohort.source_alignment ?? "strict";
  if (alignment !== "strict" && alignment !== "left") return null;
  const projected: MultimodalSourceSummary[] = [];
  for (const value of sources) {
    const source = record(value);
    const name = source?.name;
    const representation = source?.representation_id;
    const array = record(source?.array);
    const dimensions = shape(array?.shape);
    if (typeof name !== "string" || !name || typeof representation !== "string" || !dimensions) return null;
    const sourceIds = strings(source?.sample_ids);
    if (!sourceIds || new Set(sourceIds).size !== sourceIds.length
        || sourceIds.some((id) => !cohortIds.has(id))
        || (alignment === "strict" && sourceIds.length !== sampleCount)) return null;
    const mask = source?.presence_mask == null ? null : record(source.presence_mask);
    if (source?.presence_mask != null && mask === null) return null;
    let present = sourceIds.length;
    if (mask !== null) {
      const flags = mask.values;
      if (!Array.isArray(flags) || flags.length !== sourceIds.length
          || !flags.every((item) => typeof item === "boolean")) return null;
      present = flags.filter(Boolean).length;
    }
    projected.push({ name, representation, shape: dimensions, present,
      missing: sampleCount - present, ragged: source?.source_kind === "ragged_series" });
  }
  const targetShape = shape(record(cohort.y)?.shape);
  const defaultTargets = targetShape ? (targetShape.length === 1 ? ["y"]
    : targetShape.length === 2 ? Array.from({ length: targetShape[1] }, (_, index) => `y${index}`) : []) : [];
  const labels = strings(cohort.target_names) ?? defaultTargets;
  const partitionRecord = record(cohort.partitions);
  const partitionValues = strings(partitionRecord?.values);
  if (!partitionValues || partitionValues.length !== sampleCount
      || partitionValues.some((value) => !["train", "test", "predict"].includes(value))) return null;
  const partitions: Record<string, number> = {};
  for (const partition of partitionValues) partitions[partition] = (partitions[partition] ?? 0) + 1;
  return {
    samples: sampleCount,
    alignment,
    task: typeof cohort.task_type === "string" ? cohort.task_type : null,
    targets: labels,
    partitions,
    sources: projected,
  };
}

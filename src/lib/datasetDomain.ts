import type {
  Dataset,
  DatasetConfig,
  DatasetGroup,
  DatasetListResponse,
  TargetConfig,
} from "@/types/datasets";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function basenameFromPath(path: string): string | undefined {
  return path.split(/[\\/]/).filter(Boolean).pop();
}

function normalizeGroupIds(rawGroupIds: unknown, groupId: unknown): string[] | undefined {
  const ids = Array.isArray(rawGroupIds)
    ? rawGroupIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
  const singleGroupId = stringValue(groupId);
  if (singleGroupId && !ids.includes(singleGroupId)) {
    ids.push(singleGroupId);
  }
  return ids.length > 0 ? ids : undefined;
}

function normalizeTargets(rawTargets: unknown): TargetConfig[] | undefined {
  return Array.isArray(rawTargets)
    ? (rawTargets.filter(isRecord) as unknown as TargetConfig[])
    : undefined;
}

export function normalizeDataset(raw: unknown, index = 0): Dataset {
  const source = isRecord(raw) ? raw : {};
  const path = stringValue(source.path) ?? "";
  const id = stringValue(source.id) ?? (path || `temp-${index}`);
  const name = stringValue(source.name) ?? basenameFromPath(path) ?? `Dataset ${index + 1}`;
  const linkedAt = stringValue(source.linked_at) ?? stringValue(source.created_at) ?? "";
  const targets = normalizeTargets(source.targets);
  const targetCount = numberValue(source.targets);
  const numSamples = numberValue(source.num_samples) ?? numberValue(source.samples);
  const numFeatures = numberValue(source.num_features) ?? numberValue(source.features);
  const groupIds = normalizeGroupIds(source.group_ids, source.group_id);
  const config = isRecord(source.config) ? (source.config as unknown as DatasetConfig) : undefined;
  const hasTargetDefinitions =
    (targets?.length ?? 0) > 0 ||
    (config?.targets?.length ?? 0) > 0 ||
    stringValue(source.default_target) !== undefined;

  const normalized: Dataset = {
    ...(source as unknown as Dataset),
    id,
    name,
    path,
    linked_at: linkedAt,
    ...(numSamples !== undefined ? { num_samples: numSamples } : {}),
    ...(numFeatures !== undefined ? { num_features: numFeatures } : {}),
    ...(targetCount !== undefined
      ? { has_targets: targetCount > 0 }
      : hasTargetDefinitions
        ? { has_targets: true }
        : {}),
  };

  if (config !== undefined) {
    normalized.config = config;
  } else if (source.config !== undefined) {
    delete normalized.config;
  }

  if (groupIds !== undefined) {
    normalized.group_ids = groupIds;
  } else if (source.group_ids !== undefined || source.group_id !== undefined) {
    delete normalized.group_ids;
  }

  if (targets !== undefined) {
    normalized.targets = targets;
  } else if (source.targets !== undefined) {
    delete normalized.targets;
  }

  return normalized;
}

export function normalizeDatasetListResponse(
  response: unknown,
): DatasetListResponse {
  const source = isRecord(response) ? response : {};
  const rawDatasets = Array.isArray(source.datasets) ? source.datasets : [];
  const datasets = rawDatasets.map((dataset, index) => normalizeDataset(dataset, index));

  return {
    datasets,
    groups: Array.isArray(source.groups) ? source.groups as DatasetGroup[] : [],
    total: numberValue(source.total) ?? datasets.length,
  };
}

export function getDatasetSourceCount(dataset: Pick<Dataset, "n_sources" | "is_multi_source" | "config">): number {
  if (dataset.n_sources != null && dataset.n_sources > 0) return dataset.n_sources;
  const sourceIds = new Set<number>();
  for (const file of dataset.config?.files ?? []) {
    if (typeof file.source === "number") sourceIds.add(file.source);
  }
  if (sourceIds.size > 0) return sourceIds.size;
  return dataset.is_multi_source ? 2 : 1;
}

export function getDatasetTargetColumns(dataset: Pick<Dataset, "targets" | "config" | "default_target">): string[] {
  const columns = new Set<string>();
  for (const target of dataset.targets ?? []) {
    if (target.column) columns.add(target.column);
  }
  for (const target of dataset.config?.targets ?? []) {
    if (target.column) columns.add(target.column);
  }
  if (dataset.default_target) columns.add(dataset.default_target);
  return [...columns];
}

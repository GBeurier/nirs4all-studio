export type PipelineExecutionMetricValue = number | string | boolean | null;

export interface PipelineExecutionInlinePipeline {
  name: string;
  steps: unknown[];
}

export interface PipelineExecutionTargetSelection {
  selectedTargets: string[];
  defaultTarget?: string;
  taskByTarget: Record<string, string>;
}

export interface PipelineExecutionConfig {
  pipelineId: string;
  /** Legacy single-dataset entry point kept for the current `/execute` API. */
  datasetId?: string;
  /** Future campaign-ready dataset set. The current adapter projects the first entry. */
  datasetIds?: string[];
  verbose?: number;
  exportModel?: boolean;
  modelName?: string;
  splitGroupByByDataset?: Record<string, string | null>;
  inlinePipeline?: PipelineExecutionInlinePipeline;
  targetSelection?: PipelineExecutionTargetSelection;
  executionBackend?: "local-python" | "cluster" | "wasm-local";
  runtimeEngine?: string | null;
  allowFallback?: boolean;
  robustness?: PipelineExecutionRobustnessLaunchPayload;
  campaignId?: string;
}

export interface PipelineExecutionRobustnessLaunchPayload {
  mode?: "clean_frozen";
  scenarios: Array<Record<string, unknown>>;
  slice_by?: string[];
  publish_evidence?: PipelineExecutionRobustnessEvidencePublicationPayload;
}

export interface PipelineExecutionRobustnessSpectralReplayEvidencePayload {
  X: "dataset_partition";
  predictor_bundle: "exported_model_bundle";
  destination: "result_metadata.robustness_evidence";
  fail_closed: boolean;
}

export interface PipelineExecutionRobustnessEvidencePublicationPayload {
  spectral_replay?: PipelineExecutionRobustnessSpectralReplayEvidencePayload;
}

export interface PipelineExecutionArtifact {
  kind: string;
  label?: string;
  path?: string;
  uri?: string;
  metadata?: Record<string, unknown>;
}

export interface PipelineExecutionMetricObservation {
  key: string;
  label: string;
  value: PipelineExecutionMetricValue;
  target?: string;
  partition?: string;
  aggregation?: string;
  dataset?: string;
  datasetId?: string;
  source?: string;
  dimensions?: Record<string, PipelineExecutionMetricValue>;
}

export type PipelineExecutionMetrics = Record<string, PipelineExecutionMetricValue> & {
  rmse?: number;
  r2?: number;
  mae?: number;
  score?: number;
};

export interface PipelineExecutionTopResult {
  rank: number;
  config?: string;
  metrics?: PipelineExecutionMetrics;
  rmse?: number;
  r2?: number;
}

export interface PipelineExecutionResult {
  success: boolean;
  metrics?: PipelineExecutionMetrics;
  metricObservations?: PipelineExecutionMetricObservation[];
  topResults?: PipelineExecutionTopResult[];
  variantsTested?: number;
  artifacts?: PipelineExecutionArtifact[];
  modelPath?: string;
  error?: string;
  traceback?: string;
}

export interface LegacyPipelineExecutePayload {
  dataset_id: string;
  verbose: number;
  export_model: boolean;
  model_name?: string;
  split_group_by_by_dataset: Record<string, string | null>;
  inline_pipeline: PipelineExecutionInlinePipeline | null;
  engine?: string;
  allow_fallback?: boolean;
  robustness?: PipelineExecutionRobustnessLaunchPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPipelineExecutionMetricValue(value: unknown): value is PipelineExecutionMetricValue {
  return value === null
    || typeof value === "number"
    || typeof value === "string"
    || typeof value === "boolean";
}

function getOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizePipelineExecutionMetricDimensions(value: unknown): Record<string, PipelineExecutionMetricValue> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const dimensions = Object.entries(value).reduce<Record<string, PipelineExecutionMetricValue>>((normalized, [key, dimensionValue]) => {
    if (isPipelineExecutionMetricValue(dimensionValue)) {
      normalized[key] = dimensionValue;
    }
    return normalized;
  }, {});

  return Object.keys(dimensions).length > 0 ? dimensions : undefined;
}

function normalizePipelineExecutionMetricObservation(value: unknown): PipelineExecutionMetricObservation | null {
  if (!isRecord(value) || typeof value.key !== "string" || value.key.trim().length === 0 || !isPipelineExecutionMetricValue(value.value)) {
    return null;
  }

  const observation: PipelineExecutionMetricObservation = {
    key: value.key,
    label: getOptionalString(value.label) ?? formatPipelineExecutionMetricLabel(value.key),
    value: value.value,
  };

  const target = getOptionalString(value.target);
  const partition = getOptionalString(value.partition);
  const aggregation = getOptionalString(value.aggregation);
  const dataset = getOptionalString(value.dataset);
  const datasetId = getOptionalString(value.datasetId);
  const source = getOptionalString(value.source);
  const dimensions = normalizePipelineExecutionMetricDimensions(value.dimensions);

  if (target !== undefined) observation.target = target;
  if (partition !== undefined) observation.partition = partition;
  if (aggregation !== undefined) observation.aggregation = aggregation;
  if (dataset !== undefined) observation.dataset = dataset;
  if (datasetId !== undefined) observation.datasetId = datasetId;
  if (source !== undefined) observation.source = source;
  if (dimensions !== undefined) observation.dimensions = dimensions;

  return observation;
}

function getExecutionDatasetIds(config: PipelineExecutionConfig): string[] {
  const ids = [
    ...(config.datasetIds ?? []),
    ...(config.datasetId ? [config.datasetId] : []),
  ];
  return Array.from(new Set(ids.filter((id) => id.trim().length > 0)));
}

export function normalizePipelineExecutionConfig(config: PipelineExecutionConfig): PipelineExecutionConfig & { datasetIds: string[] } {
  const datasetIds = getExecutionDatasetIds(config);
  if (datasetIds.length === 0) {
    throw new Error("Pipeline execution requires at least one dataset");
  }
  return {
    ...config,
    datasetId: config.datasetId ?? datasetIds[0],
    datasetIds,
  };
}

export function toLegacyPipelineExecutePayload(config: PipelineExecutionConfig): LegacyPipelineExecutePayload {
  const normalized = normalizePipelineExecutionConfig(config);
  const runtimeEngine = normalized.runtimeEngine?.trim();
  return {
    dataset_id: normalized.datasetIds[0],
    verbose: normalized.verbose ?? 1,
    export_model: normalized.exportModel ?? true,
    model_name: normalized.modelName,
    split_group_by_by_dataset: normalized.splitGroupByByDataset ?? {},
    inline_pipeline: normalized.inlinePipeline ?? null,
    ...(runtimeEngine ? { engine: runtimeEngine } : {}),
    ...(normalized.allowFallback !== undefined ? { allow_fallback: normalized.allowFallback } : {}),
    ...(normalized.robustness ? { robustness: normalized.robustness } : {}),
  };
}

export function normalizePipelineExecutionResult(value: unknown): PipelineExecutionResult {
  if (!isRecord(value)) {
    return { success: false, error: "Invalid execution result" };
  }

  const metrics = isRecord(value.metrics)
    ? value.metrics as PipelineExecutionMetrics
    : undefined;
  const metricObservations = getPipelineExecutionMetricObservations({
    metrics,
    metricObservations: Array.isArray(value.metricObservations)
      ? value.metricObservations as PipelineExecutionMetricObservation[]
      : undefined,
  });
  const { metrics: _metrics, metricObservations: _metricObservations, ...rest } = value;

  return {
    ...(rest as unknown as PipelineExecutionResult),
    success: value.success !== false,
    ...(metrics ? { metrics } : {}),
    ...(metricObservations.length > 0 || Array.isArray(value.metricObservations) || metrics ? { metricObservations } : {}),
  };
}

export function buildPipelineExecutionMetricObservations(
  metrics: PipelineExecutionMetrics,
): PipelineExecutionMetricObservation[] {
  return Object.entries(metrics)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      label: formatPipelineExecutionMetricLabel(key),
      value,
    }));
}

export function getPipelineExecutionMetricObservations(
  result: Pick<PipelineExecutionResult, "metrics" | "metricObservations">,
): PipelineExecutionMetricObservation[] {
  const explicitObservations = Array.isArray(result.metricObservations)
    ? result.metricObservations
      .map((observation) => normalizePipelineExecutionMetricObservation(observation))
      .filter((observation): observation is PipelineExecutionMetricObservation => observation !== null)
    : [];
  const legacyObservations = result.metrics
    ? buildPipelineExecutionMetricObservations(result.metrics)
    : [];

  if (explicitObservations.length === 0) {
    return legacyObservations;
  }

  const explicitKeys = new Set(explicitObservations.map((observation) => observation.key));
  return [
    ...explicitObservations,
    ...legacyObservations.filter((observation) => !explicitKeys.has(observation.key)),
  ];
}

export function getPrimaryPipelineExecutionMetrics(
  result: Pick<PipelineExecutionResult, "metrics" | "metricObservations" | "variantsTested">,
  limit = 3,
): PipelineExecutionMetricObservation[] {
  const observations = getPipelineExecutionMetricObservations(result);

  const preferred = ["rmse", "r2", "mae", "score"];
  const ranked = [...observations].sort((left, right) => {
    const leftRank = preferred.indexOf(left.key);
    const rightRank = preferred.indexOf(right.key);
    const normalizedLeft = leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank;
    const normalizedRight = rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank;
    return normalizedLeft - normalizedRight || left.label.localeCompare(right.label);
  });

  if (result.variantsTested !== undefined) {
    ranked.push({
      key: "variantsTested",
      label: "Variants",
      value: result.variantsTested,
    });
  }

  return ranked.slice(0, limit);
}

export function formatPipelineExecutionMetricLabel(key: string): string {
  if (key === "r2") return "R²";
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatPipelineExecutionMetricValue(
  observation: PipelineExecutionMetricObservation,
): string {
  const { key, value } = observation;
  if (typeof value === "number") {
    if (key === "r2") return `${(value * 100).toFixed(2)}%`;
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(4);
  }
  return String(value);
}

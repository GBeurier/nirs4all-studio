import { foldIdBase, foldLabel } from "@/lib/fold-utils";
import type { PredictionArraysResponse } from "@/types/aggregated-predictions";
import type { PredictionRecord } from "@/types/linked-workspaces";
import type { AvailableModel } from "@/types/predict";
import type { ChainSummary } from "@/types/aggregated-predictions";
import type { PipelineRun } from "@/types/runs";

export type ResultArtifactKind =
  | "model"
  | "pipeline_config"
  | "metric_table"
  | "execution_log"
  | "prediction_arrays"
  | "benchmark_metrics"
  | "shap_explanation"
  | "optuna_study"
  | "repository_entry";

export type ResultArtifactSource =
  | "pipeline-run"
  | "model-inventory"
  | "legacy-fold-artifacts"
  | "prediction-record"
  | "prediction-arrays"
  | "benchmark-export"
  | "result-repository"
  | "cluster-run"
  | "generated";

export type ResultArtifactScope =
  | "run"
  | "pipeline"
  | "model"
  | "chain"
  | "fold"
  | "prediction"
  | "dataset"
  | "campaign";

export type ResultArtifactStatus = "available" | "virtual" | "planned" | "missing";

export const resultArtifactKindOrder = [
  "model",
  "pipeline_config",
  "metric_table",
  "execution_log",
  "prediction_arrays",
  "benchmark_metrics",
  "shap_explanation",
  "optuna_study",
  "repository_entry",
] as const satisfies readonly ResultArtifactKind[];

export const resultArtifactStatusOrder = [
  "available",
  "virtual",
  "planned",
  "missing",
] as const satisfies readonly ResultArtifactStatus[];

export const resultArtifactSourceOrder = [
  "pipeline-run",
  "model-inventory",
  "legacy-fold-artifacts",
  "prediction-record",
  "prediction-arrays",
  "benchmark-export",
  "result-repository",
  "cluster-run",
  "generated",
] as const satisfies readonly ResultArtifactSource[];

export const resultArtifactScopeOrder = [
  "run",
  "pipeline",
  "model",
  "chain",
  "fold",
  "prediction",
  "dataset",
  "campaign",
] as const satisfies readonly ResultArtifactScope[];

export interface ResultArtifactRef {
  id: string;
  kind: ResultArtifactKind;
  role: string;
  label: string;
  source: ResultArtifactSource;
  scope: ResultArtifactScope;
  status: ResultArtifactStatus;
  artifactId?: string;
  bundlePath?: string | null;
  runId?: string;
  pipelineId?: string;
  chainId?: string | null;
  predictionId?: string;
  foldId?: string;
  partition?: string;
  datasetName?: string | null;
  metric?: string | null;
  format?: string;
  contentAddress?: string;
  metadata?: Record<string, unknown>;
}

export interface ResultArtifactContext {
  runId?: string;
  pipelineId?: string;
  chainId?: string | null;
  predictionId?: string;
  datasetName?: string | null;
  metric?: string | null;
}

export interface ResultArtifactSourceScopeFilter {
  sources?: readonly ResultArtifactSource[];
  scopes?: readonly ResultArtifactScope[];
}

export interface ResultArtifactFilter extends ResultArtifactSourceScopeFilter {
  kinds?: readonly ResultArtifactKind[];
  statuses?: readonly ResultArtifactStatus[];
}

export interface ResultArtifactSourceScopeGroup {
  id: string;
  source: ResultArtifactSource;
  scope: ResultArtifactScope;
  refs: ResultArtifactRef[];
}

export interface ResultArtifactSourceScopeGroupItem extends ResultArtifactSourceScopeGroup {
  label: string;
  sourceLabel: string;
  scopeLabel: string;
  artifactCount: number;
  artifactCountLabel: string;
}

export interface ResultArtifactSourceScopeReadModel {
  refs: ResultArtifactRef[];
  groups: ResultArtifactSourceScopeGroup[];
  bySource: Partial<Record<ResultArtifactSource, ResultArtifactRef[]>>;
  byScope: Partial<Record<ResultArtifactScope, ResultArtifactRef[]>>;
}

export type ResultArtifactPresentationDimension = "kind" | "status" | "source" | "scope";

export interface ResultArtifactDimensionCountItem<TValue extends string = string> {
  id: string;
  dimension: ResultArtifactPresentationDimension;
  value: TValue;
  label: string;
  refs: ResultArtifactRef[];
  artifactCount: number;
  artifactCountLabel: string;
}

export interface ResultArtifactPresentationReadModel {
  refs: ResultArtifactRef[];
  totalArtifactCount: number;
  totalArtifactCountLabel: string;
  byKind: Partial<Record<ResultArtifactKind, ResultArtifactRef[]>>;
  byStatus: Partial<Record<ResultArtifactStatus, ResultArtifactRef[]>>;
  bySource: Partial<Record<ResultArtifactSource, ResultArtifactRef[]>>;
  byScope: Partial<Record<ResultArtifactScope, ResultArtifactRef[]>>;
  kindItems: ResultArtifactDimensionCountItem<ResultArtifactKind>[];
  statusItems: ResultArtifactDimensionCountItem<ResultArtifactStatus>[];
  sourceItems: ResultArtifactDimensionCountItem<ResultArtifactSource>[];
  scopeItems: ResultArtifactDimensionCountItem<ResultArtifactScope>[];
}

export interface ResultArtifactRepositoryProvenanceItem {
  id: string;
  refId: string;
  label: string;
  sourceLabel: string;
  contentAddress: string | null;
  contentAddressLabel: string | null;
  detailLabels: string[];
}

export interface ResultArtifactAuditItem {
  id: string;
  refId: string;
  label: string;
  detailLabels: string[];
}

export function buildResultArtifactRefId(parts: readonly unknown[]): string {
  return parts
    .filter(part => part != null && String(part).length > 0)
    .map(part => encodeURIComponent(String(part)))
    .join(":");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(record: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function readNullableStringField(record: Record<string, unknown> | undefined, keys: readonly string[]): string | null | undefined {
  if (!record) return undefined;
  for (const key of keys) {
    const value = record[key];
    if (value === null) return null;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

function enumValue<TValue extends string>(value: unknown, allowedValues: readonly TValue[]): TValue | undefined {
  return typeof value === "string" && (allowedValues as readonly string[]).includes(value)
    ? value as TValue
    : undefined;
}

function optionalStringSet<T extends string>(values: readonly T[] | undefined): ReadonlySet<T> | null {
  return values && values.length > 0 ? new Set(values) : null;
}

function appendIndexedArtifactRef<T extends string>(
  index: Partial<Record<T, ResultArtifactRef[]>>,
  key: T,
  ref: ResultArtifactRef,
): void {
  const refs = index[key];
  if (refs) {
    refs.push(ref);
    return;
  }
  index[key] = [ref];
}

function buildIndexedArtifactRefs<T extends string>(
  refs: readonly ResultArtifactRef[],
  valueForRef: (ref: ResultArtifactRef) => T,
): Partial<Record<T, ResultArtifactRef[]>> {
  const index: Partial<Record<T, ResultArtifactRef[]>> = {};
  for (const ref of refs) appendIndexedArtifactRef(index, valueForRef(ref), ref);
  return index;
}

function definedMetadata(metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function dedupeResultArtifactRefs(refs: readonly ResultArtifactRef[]): ResultArtifactRef[] {
  const seen = new Set<string>();
  return refs.filter(ref => {
    if (seen.has(ref.id)) return false;
    seen.add(ref.id);
    return true;
  });
}

export function filterResultArtifactRefs(
  refs: readonly ResultArtifactRef[],
  filter: ResultArtifactFilter = {},
): ResultArtifactRef[] {
  const kinds = optionalStringSet(filter.kinds);
  const statuses = optionalStringSet(filter.statuses);
  const sources = optionalStringSet(filter.sources);
  const scopes = optionalStringSet(filter.scopes);

  return refs.filter(ref => (
    (!kinds || kinds.has(ref.kind)) &&
    (!statuses || statuses.has(ref.status)) &&
    (!sources || sources.has(ref.source)) &&
    (!scopes || scopes.has(ref.scope))
  ));
}

export function filterResultArtifactRefsBySourceScope(
  refs: readonly ResultArtifactRef[],
  filter: ResultArtifactSourceScopeFilter = {},
): ResultArtifactRef[] {
  return filterResultArtifactRefs(refs, filter);
}

const resultArtifactKindLabels: Record<ResultArtifactKind, string> = {
  model: "Model",
  pipeline_config: "Pipeline configuration",
  metric_table: "Metric table",
  execution_log: "Execution log",
  prediction_arrays: "Prediction arrays",
  benchmark_metrics: "Benchmark metrics",
  shap_explanation: "SHAP explanation",
  optuna_study: "Optuna study",
  repository_entry: "Repository entry",
};

const resultArtifactStatusLabels: Record<ResultArtifactStatus, string> = {
  available: "Available",
  virtual: "Virtual",
  planned: "Planned",
  missing: "Missing",
};

const resultArtifactSourceLabels: Record<ResultArtifactSource, string> = {
  "pipeline-run": "Pipeline run",
  "model-inventory": "Model inventory",
  "legacy-fold-artifacts": "Legacy fold artifacts",
  "prediction-record": "Prediction record",
  "prediction-arrays": "Prediction arrays",
  "benchmark-export": "Benchmark export",
  "result-repository": "Result repository",
  "cluster-run": "Cluster run",
  generated: "Generated",
};

const resultArtifactScopeLabels: Record<ResultArtifactScope, string> = {
  run: "Run",
  pipeline: "Pipeline",
  model: "Model",
  chain: "Chain",
  fold: "Fold",
  prediction: "Prediction",
  dataset: "Dataset",
  campaign: "Campaign",
};

export function getResultArtifactKindLabel(kind: ResultArtifactKind): string {
  return resultArtifactKindLabels[kind];
}

export function getResultArtifactStatusLabel(status: ResultArtifactStatus): string {
  return resultArtifactStatusLabels[status];
}

export function getResultArtifactSourceLabel(source: ResultArtifactSource): string {
  return resultArtifactSourceLabels[source];
}

export function getResultArtifactScopeLabel(scope: ResultArtifactScope): string {
  return resultArtifactScopeLabels[scope];
}

export function formatResultArtifactCountLabel(count: number): string {
  return `${count} ${count === 1 ? "artifact" : "artifacts"}`;
}

function buildResultArtifactDimensionCountItems<TValue extends string>(
  dimension: ResultArtifactPresentationDimension,
  values: readonly TValue[],
  refsByValue: Partial<Record<TValue, ResultArtifactRef[]>>,
  labelForValue: (value: TValue) => string,
): ResultArtifactDimensionCountItem<TValue>[] {
  return values.flatMap(value => {
    const refs = refsByValue[value];
    if (!refs || refs.length === 0) return [];

    const artifactCount = refs.length;
    return [{
      id: buildResultArtifactRefId([dimension, value]),
      dimension,
      value,
      label: labelForValue(value),
      refs,
      artifactCount,
      artifactCountLabel: formatResultArtifactCountLabel(artifactCount),
    }];
  });
}

export function buildResultArtifactPresentationReadModel(
  refs: readonly ResultArtifactRef[],
  filter: ResultArtifactFilter = {},
): ResultArtifactPresentationReadModel {
  const filteredRefs = filterResultArtifactRefs(refs, filter);
  const byKind = buildIndexedArtifactRefs(filteredRefs, ref => ref.kind);
  const byStatus = buildIndexedArtifactRefs(filteredRefs, ref => ref.status);
  const bySource = buildIndexedArtifactRefs(filteredRefs, ref => ref.source);
  const byScope = buildIndexedArtifactRefs(filteredRefs, ref => ref.scope);
  const totalArtifactCount = filteredRefs.length;

  return {
    refs: filteredRefs,
    totalArtifactCount,
    totalArtifactCountLabel: formatResultArtifactCountLabel(totalArtifactCount),
    byKind,
    byStatus,
    bySource,
    byScope,
    kindItems: buildResultArtifactDimensionCountItems("kind", resultArtifactKindOrder, byKind, getResultArtifactKindLabel),
    statusItems: buildResultArtifactDimensionCountItems("status", resultArtifactStatusOrder, byStatus, getResultArtifactStatusLabel),
    sourceItems: buildResultArtifactDimensionCountItems("source", resultArtifactSourceOrder, bySource, getResultArtifactSourceLabel),
    scopeItems: buildResultArtifactDimensionCountItems("scope", resultArtifactScopeOrder, byScope, getResultArtifactScopeLabel),
  };
}

export function buildResultArtifactSourceScopeGroupItems(
  groups: readonly ResultArtifactSourceScopeGroup[],
): ResultArtifactSourceScopeGroupItem[] {
  return groups.map(group => {
    const sourceLabel = getResultArtifactSourceLabel(group.source);
    const scopeLabel = getResultArtifactScopeLabel(group.scope);
    const artifactCount = group.refs.length;

    return {
      ...group,
      label: `${sourceLabel} / ${scopeLabel}`,
      sourceLabel,
      scopeLabel,
      artifactCount,
      artifactCountLabel: formatResultArtifactCountLabel(artifactCount),
    };
  });
}

export function buildResultArtifactSourceScopeReadModel(
  refs: readonly ResultArtifactRef[],
  filter: ResultArtifactSourceScopeFilter = {},
): ResultArtifactSourceScopeReadModel {
  const filteredRefs = filterResultArtifactRefsBySourceScope(refs, filter);
  const groupsByKey = new Map<string, ResultArtifactSourceScopeGroup>();
  const bySource: ResultArtifactSourceScopeReadModel["bySource"] = {};
  const byScope: ResultArtifactSourceScopeReadModel["byScope"] = {};

  for (const ref of filteredRefs) {
    const groupKey = `${ref.source}:${ref.scope}`;
    let group = groupsByKey.get(groupKey);
    if (!group) {
      group = {
        id: buildResultArtifactRefId(["source-scope", ref.source, ref.scope]),
        source: ref.source,
        scope: ref.scope,
        refs: [],
      };
      groupsByKey.set(groupKey, group);
    }
    group.refs.push(ref);
    appendIndexedArtifactRef(bySource, ref.source, ref);
    appendIndexedArtifactRef(byScope, ref.scope, ref);
  }

  return {
    refs: filteredRefs,
    groups: [...groupsByKey.values()],
    bySource,
    byScope,
  };
}

function resolveResultArtifactContentAddress(ref: ResultArtifactRef): string | null {
  return ref.contentAddress
    ?? readStringField(ref.metadata, ["contentAddress", "content_address"])
    ?? null;
}

function buildResultArtifactRepositoryDetailLabels(ref: ResultArtifactRef, contentAddressLabel: string | null): string[] {
  const repositoryId = readStringField(ref.metadata, ["repositoryId", "repository_id", "repository"]);
  const sourceRef = readStringField(ref.metadata, ["sourceRef", "source_ref"]);

  return [
    contentAddressLabel ? `Content ${contentAddressLabel}` : null,
    repositoryId ? `Repository ${repositoryId}` : null,
    sourceRef ? `Source ${sourceRef}` : null,
  ].filter((label): label is string => label != null);
}

export function formatResultArtifactContentAddressLabel(contentAddress: string | null | undefined): string | null {
  if (!contentAddress) return null;
  const trimmed = contentAddress.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= 32) return trimmed;

  const separatorIndex = trimmed.indexOf(":");
  if (separatorIndex > 0 && separatorIndex < trimmed.length - 1) {
    const prefix = trimmed.slice(0, separatorIndex);
    const digest = trimmed.slice(separatorIndex + 1);
    if (digest.length > 20) return `${prefix}:${digest.slice(0, 12)}...${digest.slice(-6)}`;
  }
  return `${trimmed.slice(0, 18)}...${trimmed.slice(-6)}`;
}

export function buildResultArtifactRepositoryProvenanceItems(
  refs: readonly ResultArtifactRef[],
): ResultArtifactRepositoryProvenanceItem[] {
  return refs.flatMap(ref => {
    const contentAddress = resolveResultArtifactContentAddress(ref);
    const isRepositoryRef = ref.source === "result-repository" || ref.kind === "repository_entry" || contentAddress != null;
    if (!isRepositoryRef) return [];

    const contentAddressLabel = formatResultArtifactContentAddressLabel(contentAddress);
    return [{
      id: buildResultArtifactRefId(["repository-provenance", ref.id]),
      refId: ref.id,
      label: ref.label,
      sourceLabel: getResultArtifactSourceLabel(ref.source),
      contentAddress,
      contentAddressLabel,
      detailLabels: buildResultArtifactRepositoryDetailLabels(ref, contentAddressLabel),
    }];
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
}

function formatAuditContext(context: Record<string, unknown> | undefined): string | null {
  if (!context) return null;
  const parts = [
    readStringField(context, ["run_id", "runId"]) ? `run ${readStringField(context, ["run_id", "runId"])}` : null,
    readStringField(context, ["pipeline_id", "pipelineId"]) ? `pipeline ${readStringField(context, ["pipeline_id", "pipelineId"])}` : null,
    readStringField(context, ["chain_id", "chainId"]) ? `chain ${readStringField(context, ["chain_id", "chainId"])}` : null,
    readStringField(context, ["partition"]) ? `partition ${readStringField(context, ["partition"])}` : null,
    readStringField(context, ["fold_id", "foldId"]) ? `fold ${readStringField(context, ["fold_id", "foldId"])}` : null,
  ].filter((part): part is string => part != null);
  return parts.length > 0 ? `Context ${parts.join(" · ")}` : null;
}

function buildRobustnessAuditDetailLabels(ref: ResultArtifactRef, audit: Record<string, unknown>): string[] {
  const requested = isRecord(audit.requested_robustness) ? audit.requested_robustness : undefined;
  const context = isRecord(audit.stored_prediction_context) ? audit.stored_prediction_context : undefined;
  const scenarioKinds = stringArray(audit.requested_scenario_kinds);
  const seed = audit.requested_seed;
  const predictionId = readStringField(audit, ["prediction_id", "predictionId"])
    ?? readStringField(context, ["prediction_id", "predictionId"])
    ?? ref.predictionId;
  const mode = readStringField(requested, ["mode"]);

  return [
    mode ? `Mode ${mode}` : null,
    scenarioKinds.length > 0 ? `Scenarios ${scenarioKinds.join(", ")}` : null,
    typeof seed === "number" ? `Seed ${seed}` : seed === null ? "Seed none" : null,
    predictionId ? `Prediction ${predictionId}` : null,
    formatAuditContext(context),
  ].filter((label): label is string => label != null);
}

export function buildResultArtifactAuditItems(refs: readonly ResultArtifactRef[]): ResultArtifactAuditItem[] {
  return refs.flatMap((ref) => {
    const audit = isRecord(ref.metadata?.audit_metadata) ? ref.metadata.audit_metadata : null;
    if (!audit) return [];
    const detailLabels = buildRobustnessAuditDetailLabels(ref, audit);
    if (detailLabels.length === 0) return [];
    return [{
      id: buildResultArtifactRefId(["artifact-audit", ref.id]),
      refId: ref.id,
      label: `${ref.label} audit`,
      detailLabels,
    }];
  });
}

function foldIdFromArtifactKey(key: string): string {
  if (key === "fold_final" || key === "final") return "final";
  if (key.startsWith("fold_")) return key.slice("fold_".length);
  return key;
}

function foldArtifactSortKey(key: string): string {
  const foldId = foldIdFromArtifactKey(key);
  const base = foldIdBase(foldId);
  if (base === "final") return "000-final";
  const numeric = Number(base);
  if (Number.isFinite(numeric)) return `100-${String(numeric).padStart(6, "0")}`;
  if (base === "avg") return "900-avg";
  if (base === "w_avg") return "901-wavg";
  return `999-${base}`;
}

function foldModelRole(foldId: string): string {
  return foldId === "final" ? "refit-model" : "fold-model";
}

export function buildFoldModelArtifactRefs(
  foldArtifacts: Record<string, string> | null | undefined,
  context: ResultArtifactContext = {},
): ResultArtifactRef[] {
  if (!foldArtifacts) return [];

  return Object.entries(foldArtifacts)
    .filter(([, artifactId]) => typeof artifactId === "string" && artifactId.length > 0)
    .sort(([a], [b]) => foldArtifactSortKey(a).localeCompare(foldArtifactSortKey(b)))
    .map(([key, artifactId]) => {
      const foldId = foldIdFromArtifactKey(key);
      const role = foldModelRole(foldId);
      const anchorId = context.chainId ?? context.pipelineId ?? context.runId ?? "unknown";
      return {
        id: buildResultArtifactRefId(["legacy-fold-artifacts", anchorId, key, artifactId]),
        kind: "model",
        role,
        label: `${foldLabel(foldId)} model`,
        source: "legacy-fold-artifacts",
        scope: "fold",
        status: "available",
        artifactId,
        runId: context.runId,
        pipelineId: context.pipelineId,
        chainId: context.chainId,
        foldId,
        datasetName: context.datasetName,
        metric: context.metric,
        metadata: definedMetadata({ foldArtifactKey: key }),
      };
    });
}

export function buildPredictionRecordModelArtifactRefs(prediction: PredictionRecord): ResultArtifactRef[] {
  const artifactId = prediction.model_artifact_id;
  if (!artifactId) return [];

  const foldId = prediction.fold_id ?? "unknown";
  const chainId = prediction.trace_id ?? prediction.predict_chain_id ?? prediction.pipeline_uid ?? prediction.id;
  return [{
    id: buildResultArtifactRefId(["prediction-record", chainId, foldId, artifactId]),
    kind: "model",
    role: foldModelRole(foldId),
    label: `${foldLabel(foldId)} model`,
    source: "prediction-record",
    scope: "fold",
    status: "available",
    artifactId,
    pipelineId: prediction.pipeline_uid,
    chainId,
    predictionId: prediction.id,
    foldId,
    partition: prediction.partition,
    datasetName: prediction.source_dataset || prediction.dataset_name,
    metric: prediction.metric ?? null,
  }];
}

function refitArtifactIdFromAvailableModel(model: Pick<AvailableModel, "fold_artifacts">): string | undefined {
  const foldArtifacts = model.fold_artifacts;
  if (!foldArtifacts) return undefined;
  return foldArtifacts.fold_final ?? foldArtifacts.final;
}

export function buildAvailableModelArtifactRef(model: AvailableModel): ResultArtifactRef {
  const refitArtifactId = refitArtifactIdFromAvailableModel(model);
  const bundlePath = model.source === "bundle" ? model.bundle_path ?? model.id : null;
  const artifactId = model.source === "bundle" ? bundlePath ?? undefined : refitArtifactId;
  const role = model.source === "bundle"
    ? "bundle-model"
    : model.has_refit
      ? "refit-model"
      : "workspace-chain-model";

  return {
    id: buildResultArtifactRefId(["available-model", model.source, model.id, artifactId ?? "virtual"]),
    kind: "model",
    role,
    label: model.name || model.id,
    source: "model-inventory",
    scope: model.source === "bundle" ? "model" : "chain",
    status: artifactId || model.source === "chain" ? "available" : "virtual",
    artifactId,
    bundlePath,
    chainId: model.source === "chain" ? model.id : null,
    datasetName: model.dataset_name,
    metric: model.prediction_metric ?? model.metric,
    format: model.source === "bundle" ? "n4a" : undefined,
    metadata: definedMetadata({
      modelSource: model.source,
      modelClass: model.model_class || undefined,
      preprocessing: model.preprocessing ?? undefined,
      hasRefit: model.has_refit,
      foldArtifactKeys: model.fold_artifacts ? Object.keys(model.fold_artifacts).sort() : undefined,
      bestScore: model.best_score ?? undefined,
      predictionScore: model.prediction_score ?? undefined,
      fileSize: model.file_size ?? undefined,
      createdAt: model.created_at ?? undefined,
    }),
  };
}

function pipelineMetricKeys(pipeline: PipelineRun): string[] {
  const keys = new Set<string>();
  if (pipeline.score_metric) keys.add(pipeline.score_metric);
  if (pipeline.metrics) {
    for (const key of Object.keys(pipeline.metrics)) keys.add(key);
  }
  return [...keys].sort();
}

interface PipelineRunArtifactRefsCarrier {
  artifactRefs?: unknown;
  artifact_refs?: unknown;
}

function attachedArtifactPayloads(source: PipelineRunArtifactRefsCarrier): unknown[] {
  const carrier = source;
  const artifactRefs = Array.isArray(carrier.artifactRefs) ? carrier.artifactRefs : [];
  const artifactRefsSnakeCase = Array.isArray(carrier.artifact_refs) ? carrier.artifact_refs : [];
  return [...artifactRefs, ...artifactRefsSnakeCase];
}

function normalizeAttachedArtifactRef(
  rawRef: unknown,
  index: number,
  context: ResultArtifactContext,
  fallbackId: string,
): ResultArtifactRef | null {
  if (!isRecord(rawRef)) return null;

  const metadata = isRecord(rawRef.metadata) ? { ...rawRef.metadata } : undefined;
  const source = enumValue(rawRef.source, resultArtifactSourceOrder);
  const kind = enumValue(rawRef.kind, resultArtifactKindOrder);
  if (!source || !kind) return null;

  const scope = enumValue(rawRef.scope, resultArtifactScopeOrder) ?? "run";
  const status = enumValue(rawRef.status, resultArtifactStatusOrder) ?? "available";
  const artifactId = readStringField(rawRef, ["artifactId", "artifact_id"]);
  const contentAddress = readStringField(rawRef, ["contentAddress", "content_address"])
    ?? readStringField(metadata, ["contentAddress", "content_address"]);
  const role = readStringField(rawRef, ["role"]) ?? kind;
  const id = readStringField(rawRef, ["id"]) ?? buildResultArtifactRefId([
    "attached-artifact",
    fallbackId,
    source,
    scope,
    kind,
    artifactId ?? contentAddress ?? index,
  ]);

  return {
    id,
    kind,
    role,
    label: readStringField(rawRef, ["label"]) ?? getResultArtifactKindLabel(kind),
    source,
    scope,
    status,
    artifactId,
    bundlePath: readNullableStringField(rawRef, ["bundlePath", "bundle_path"]),
    runId: readStringField(rawRef, ["runId", "run_id"]) ?? context.runId,
    pipelineId: readStringField(rawRef, ["pipelineId", "pipeline_id"]) ?? context.pipelineId,
    chainId: readNullableStringField(rawRef, ["chainId", "chain_id"]) ?? context.chainId,
    predictionId: readStringField(rawRef, ["predictionId", "prediction_id"]),
    foldId: readStringField(rawRef, ["foldId", "fold_id"]),
    partition: readStringField(rawRef, ["partition"]),
    datasetName: readNullableStringField(rawRef, ["datasetName", "dataset_name"]) ?? context.datasetName,
    metric: readNullableStringField(rawRef, ["metric"]) ?? context.metric,
    format: readStringField(rawRef, ["format"]),
    contentAddress,
    metadata,
  };
}

function buildAttachedPipelineRunArtifactRefs(pipeline: PipelineRun): ResultArtifactRef[] {
  return attachedArtifactPayloads(pipeline as PipelineRun & PipelineRunArtifactRefsCarrier)
    .map((rawRef, index) => normalizeAttachedArtifactRef(rawRef, index, {
      runId: pipeline.id,
      pipelineId: pipeline.pipeline_id,
      metric: pipeline.score_metric ?? pipeline.metrics?.score_metric ?? null,
    }, pipeline.id))
    .filter((ref): ref is ResultArtifactRef => ref != null);
}

export function buildAttachedChainSummaryArtifactRefs(summary: ChainSummary): ResultArtifactRef[] {
  return attachedArtifactPayloads(summary as ChainSummary & PipelineRunArtifactRefsCarrier)
    .map((rawRef, index) => normalizeAttachedArtifactRef(rawRef, index, {
      runId: summary.run_id,
      pipelineId: summary.pipeline_id,
      chainId: summary.chain_id,
      datasetName: summary.dataset_name,
      metric: summary.metric,
    }, summary.chain_id))
    .filter((ref): ref is ResultArtifactRef => ref != null);
}

export function buildPipelineRunArtifactRefs(pipeline: PipelineRun): ResultArtifactRef[] {
  const context = {
    runId: pipeline.id,
    pipelineId: pipeline.pipeline_id,
    metric: pipeline.score_metric ?? pipeline.metrics?.score_metric ?? null,
  };
  const refs: ResultArtifactRef[] = [];

  if (pipeline.refit_model_id) {
    refs.push({
      id: buildResultArtifactRefId(["pipeline-run", pipeline.id, "refit-model", pipeline.refit_model_id]),
      kind: "model",
      role: "refit-model",
      label: "Refit model",
      source: "pipeline-run",
      scope: "pipeline",
      status: "available",
      artifactId: pipeline.refit_model_id,
      ...context,
    });
  }

  if (pipeline.config && Object.keys(pipeline.config).length > 0) {
    refs.push({
      id: buildResultArtifactRefId(["pipeline-run", pipeline.id, "pipeline-config"]),
      kind: "pipeline_config",
      role: "pipeline-definition",
      label: "Pipeline configuration",
      source: "pipeline-run",
      scope: "pipeline",
      status: "virtual",
      ...context,
      format: "json",
      metadata: definedMetadata({ keys: Object.keys(pipeline.config).sort() }),
    });
  }

  if (pipeline.metrics || pipeline.score != null || pipeline.val_score != null || pipeline.test_score != null) {
    refs.push({
      id: buildResultArtifactRefId(["pipeline-run", pipeline.id, "metrics"]),
      kind: "metric_table",
      role: "primary-metrics",
      label: "Primary metrics",
      source: "pipeline-run",
      scope: "pipeline",
      status: "virtual",
      ...context,
      format: "json",
      metadata: definedMetadata({
        metricKeys: pipelineMetricKeys(pipeline),
        hasCvScore: pipeline.val_score != null,
        hasTestScore: pipeline.test_score != null,
      }),
    });
  }

  if (pipeline.logs && pipeline.logs.length > 0) {
    refs.push({
      id: buildResultArtifactRefId(["pipeline-run", pipeline.id, "execution-log"]),
      kind: "execution_log",
      role: "execution-log",
      label: "Execution log",
      source: "pipeline-run",
      scope: "pipeline",
      status: "virtual",
      ...context,
      format: "text",
      metadata: definedMetadata({ lineCount: pipeline.logs.length }),
    });
  }

  refs.push(...buildAttachedPipelineRunArtifactRefs(pipeline));

  return dedupeResultArtifactRefs(refs);
}

export function buildPredictionArraysArtifactRef(
  arrays: PredictionArraysResponse,
  context: Omit<ResultArtifactContext, "predictionId"> = {},
): ResultArtifactRef {
  const vectorNames = [
    arrays.y_true ? "y_true" : null,
    arrays.y_pred ? "y_pred" : null,
    arrays.y_proba ? "y_proba" : null,
    arrays.sample_indices ? "sample_indices" : null,
    arrays.weights ? "weights" : null,
    arrays.sample_metadata ? "sample_metadata" : null,
  ].filter((name): name is string => name != null);

  return {
    id: buildResultArtifactRefId(["prediction-arrays", arrays.prediction_id]),
    kind: "prediction_arrays",
    role: "prediction-vectors",
    label: "Prediction arrays",
    source: "prediction-arrays",
    scope: "prediction",
    status: "available",
    predictionId: arrays.prediction_id,
    runId: context.runId,
    pipelineId: context.pipelineId,
    chainId: context.chainId,
    datasetName: context.datasetName,
    metric: context.metric,
    format: "array",
    metadata: definedMetadata({
      nSamples: arrays.n_samples,
      vectors: vectorNames,
      branchPath: arrays.branch_path,
      sourceIndex: arrays.source_index,
      sourceName: arrays.source_name,
      targetIndex: arrays.target_index,
      targetName: arrays.target_name,
      resultMetadata: arrays.result_metadata,
    }),
  };
}

import {
  chooseCandlestickField,
  chooseHeatmapAxes,
  getAvailableHyperparameters,
} from "@/lib/inspector/analytics";
import {
  INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS,
  projectInspectorChainsMetricObservations,
} from "@/lib/inspector/metricObservationProjection";
import { orderMetricKeys } from "@/lib/scores";
import type {
  InspectorChainSummary,
  ScoreColumn,
  ScoreRef,
  ScoreRefAggregation,
  ScoreRefPartition,
  ScoreRefProtocol,
} from "@/types/inspector";

export type InspectorHeatmapAxisField = "dataset_name" | "model_class" | "preprocessings";

export type InspectorChainField =
  | "model_class"
  | "model_name"
  | "preprocessings"
  | "dataset_name"
  | "run_id"
  | "task_type"
  | "pipeline_id";

export interface InspectorHeatmapAxes {
  xVariable: InspectorHeatmapAxisField;
  yVariable: InspectorHeatmapAxisField;
}

export interface InspectorChartInputSelection {
  heatmapXAxis: InspectorHeatmapAxisField | null;
  heatmapYAxis: InspectorHeatmapAxisField | null;
  selectedHyperParam: string;
}

export interface InspectorChartInputs {
  heatmapAxes: InspectorHeatmapAxes;
  candlestickField: InspectorChainField;
  availableHyperParams: string[];
  activeHyperParam: string;
}

export const INSPECTOR_HEATMAP_AXIS_OPTIONS: readonly InspectorHeatmapAxisField[] = [
  "dataset_name",
  "model_class",
  "preprocessings",
] as const;

function isInspectorHeatmapAxisField(value: unknown): value is InspectorHeatmapAxisField {
  return INSPECTOR_HEATMAP_AXIS_OPTIONS.includes(value as InspectorHeatmapAxisField);
}

function coerceHeatmapAxis(value: unknown, fallback: InspectorHeatmapAxisField): InspectorHeatmapAxisField {
  return isInspectorHeatmapAxisField(value) ? value : fallback;
}

export function resolveInspectorHeatmapAxes(
  chains: readonly InspectorChainSummary[],
  requestedXAxis: InspectorHeatmapAxisField | null,
  requestedYAxis: InspectorHeatmapAxisField | null,
): InspectorHeatmapAxes {
  const auto = chooseHeatmapAxes(chains);
  const xVariable = requestedXAxis ?? coerceHeatmapAxis(auto.xVariable, "dataset_name");
  let yVariable = requestedYAxis ?? coerceHeatmapAxis(auto.yVariable, "model_class");

  if (yVariable === xVariable) {
    yVariable = INSPECTOR_HEATMAP_AXIS_OPTIONS.find((option) => option !== xVariable) ?? yVariable;
  }

  return { xVariable, yVariable };
}

export function resolveInspectorHyperparameter(
  availableHyperParams: readonly string[],
  selectedHyperParam: string,
): string {
  if (selectedHyperParam && availableHyperParams.includes(selectedHyperParam)) {
    return selectedHyperParam;
  }
  return availableHyperParams[0] ?? "";
}

export function buildInspectorChartInputs(
  chains: readonly InspectorChainSummary[],
  selection: InspectorChartInputSelection,
): InspectorChartInputs {
  const availableHyperParams = getAvailableHyperparameters(chains);
  return {
    heatmapAxes: resolveInspectorHeatmapAxes(chains, selection.heatmapXAxis, selection.heatmapYAxis),
    candlestickField: chooseCandlestickField(chains),
    availableHyperParams,
    activeHyperParam: resolveInspectorHyperparameter(availableHyperParams, selection.selectedHyperParam),
  };
}

/**
 * A score-ref shape that chart inputs were able to map onto a concrete metric
 * observation (and therefore a legacy score column), with an observation count.
 */
export interface InspectorScoreRefAvailability {
  key: string;
  metric: string | null;
  protocol: ScoreRefProtocol;
  partition: ScoreRefPartition;
  aggregation: ScoreRefAggregation;
  legacyScoreColumn: ScoreColumn | null;
  targetIndex?: number | null;
  targetName?: string | null;
  sourceIndex?: number | null;
  sourceName?: string | null;
  observationCount: number;
}

/**
 * A score-ref retained under `variant_params.result_metadata.score_refs` because
 * it could not be mapped to a legacy score column. Fields are kept loose so future
 * protocol/partition/aggregation strings survive without a schema change.
 */
export interface InspectorUnmappedScoreRef {
  key: string | null;
  metric: string | null;
  protocol: string | null;
  partition: string | null;
  aggregation: string | null;
  legacyScoreColumn: string | null;
  targetIndex?: number | null;
  targetName?: string | null;
  sourceIndex?: number | null;
  sourceName?: string | null;
  occurrences: number;
}

/**
 * Capability-driven read model that exposes which metric observations and
 * score-ref shapes are available across the visible chains. Pure and additive —
 * it does not change the legacy chart inputs returned by buildInspectorChartInputs.
 */
export interface InspectorMetricObservationReadModel {
  hasObservations: boolean;
  metricKeys: string[];
  scoreRefs: InspectorScoreRefAvailability[];
  unmappedScoreRefs: InspectorUnmappedScoreRef[];
}

export interface InspectorScoreColumnAvailability {
  scoreColumn: ScoreColumn;
  observationCount: number;
  hasMetricObservations: boolean;
}

export interface InspectorResolvedScoreRefSelection {
  scoreColumn: ScoreColumn;
  scoreRef: ScoreRef | null;
  selectedScoreRefKey: string | null;
  isExplicit: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeScoreRefString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeScoreRefNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeScoreMapPhaseProtocol(phase: string): string {
  if (phase === "cv") return "cross_validation";
  if (phase === "final") return "final";
  return phase;
}

function normalizeScoreMapPhaseAggregation(phase: string): string {
  if (phase === "cv") return "fold_mean";
  if (phase === "final") return "final_model";
  return "score_map";
}

function scoreMapTargetKey({
  metric,
  protocol,
  aggregation,
  targetIndex,
  targetName,
  sourceIndex,
}: {
  metric: string | null;
  protocol: string;
  aggregation: string;
  targetIndex: number | null;
  targetName: string | null;
  sourceIndex: number | null;
}): string {
  return [
    `metric=${metric ?? "unknown"}`,
    `protocol=${protocol}`,
    "partition=target",
    `aggregation=${aggregation}`,
    targetIndex != null ? `target_index=${targetIndex}` : `target_name=${targetName ?? "unknown"}`,
    sourceIndex != null ? `source_index=${sourceIndex}` : null,
  ].filter((part): part is string => part != null).join("|");
}

function extractRetainedScoreRefs(chain: InspectorChainSummary): Record<string, unknown>[] {
  const variantParams = chain.variant_params;
  if (!isRecord(variantParams)) return [];
  const metadata = variantParams.result_metadata;
  if (!isRecord(metadata)) return [];
  const scoreRefs = metadata.score_refs;
  if (!Array.isArray(scoreRefs)) return [];
  return scoreRefs.filter(isRecord);
}

function extractScoreMaps(chain: InspectorChainSummary): Record<string, unknown>[] {
  const variantParams = chain.variant_params;
  if (isRecord(variantParams)) {
    const predictionMetadata = variantParams.prediction_metadata;
    if (isRecord(predictionMetadata) && isRecord(predictionMetadata.score_maps)) {
      return [predictionMetadata.score_maps];
    }
  }
  return isRecord(chain.score_maps) ? [chain.score_maps] : [];
}

function extractScoreMapUnmappedScoreRefs(chain: InspectorChainSummary): InspectorUnmappedScoreRef[] {
  const refs: InspectorUnmappedScoreRef[] = [];
  for (const scoreMaps of extractScoreMaps(chain)) {
    for (const [phase, phasePayload] of Object.entries(scoreMaps)) {
      if (!isRecord(phasePayload)) continue;
      const targets = phasePayload.targets;
      if (!isRecord(targets)) continue;
      const protocol = normalizeScoreMapPhaseProtocol(phase);
      const aggregation = normalizeScoreMapPhaseAggregation(phase);
      for (const [targetKey, targetPayload] of Object.entries(targets)) {
        if (!isRecord(targetPayload)) continue;
        const targetName = normalizeScoreRefString(targetKey);
        const targetIndex = normalizeScoreRefNumber(targetPayload.target_index);
        const sourceIndex = normalizeScoreRefNumber(targetPayload.source_index) ?? chain.source_index;
        const sourceName = normalizeScoreRefString(targetPayload.source_name);
        for (const [metricKey, score] of Object.entries(targetPayload)) {
          if (metricKey === "target_index" || metricKey === "source_index" || metricKey === "source_name") continue;
          if (normalizeScoreRefNumber(score) == null) continue;
          const metric = normalizeScoreRefString(metricKey);
          refs.push({
            key: scoreMapTargetKey({
              metric,
              protocol,
              aggregation,
              targetIndex,
              targetName,
              sourceIndex,
            }),
            metric,
            protocol,
            partition: "target",
            aggregation,
            legacyScoreColumn: null,
            ...(targetIndex != null ? { targetIndex } : {}),
            ...(targetName != null ? { targetName } : {}),
            ...(sourceIndex != null ? { sourceIndex } : {}),
            ...(sourceName != null ? { sourceName } : {}),
            occurrences: 1,
          });
        }
      }
    }
  }
  return refs;
}

function unmappedScoreRefDedupeKey(scoreRef: InspectorUnmappedScoreRef): string {
  return scoreRef.key ?? [
    `metric=${scoreRef.metric ?? ""}`,
    `protocol=${scoreRef.protocol ?? ""}`,
    `partition=${scoreRef.partition ?? ""}`,
    `aggregation=${scoreRef.aggregation ?? ""}`,
    `targetIndex=${scoreRef.targetIndex ?? ""}`,
    `targetName=${scoreRef.targetName ?? ""}`,
    `sourceIndex=${scoreRef.sourceIndex ?? ""}`,
  ].join("|");
}

export function buildInspectorMetricObservationReadModel(
  chains: readonly InspectorChainSummary[],
): InspectorMetricObservationReadModel {
  const observations = projectInspectorChainsMetricObservations(chains);

  const scoreRefs = new Map<string, InspectorScoreRefAvailability>();
  for (const observation of observations) {
    const { ref } = observation;
    const existing = scoreRefs.get(ref.key);
    if (existing) {
      existing.observationCount += 1;
      continue;
    }
    scoreRefs.set(ref.key, {
      key: ref.key,
      metric: ref.metric,
      protocol: ref.protocol,
      partition: ref.partition,
      aggregation: ref.aggregation,
      legacyScoreColumn: ref.legacyScoreColumn ?? null,
      ...(ref.targetIndex != null ? { targetIndex: ref.targetIndex } : {}),
      ...(ref.targetName != null ? { targetName: ref.targetName } : {}),
      ...(ref.sourceIndex != null ? { sourceIndex: ref.sourceIndex } : {}),
      ...(ref.sourceName != null ? { sourceName: ref.sourceName } : {}),
      observationCount: 1,
    });
  }

  const unmappedScoreRefs = new Map<string, InspectorUnmappedScoreRef>();
  for (const chain of chains) {
    for (const raw of extractRetainedScoreRefs(chain)) {
      const scoreRef: InspectorUnmappedScoreRef = {
        key: normalizeScoreRefString(raw.key),
        metric: normalizeScoreRefString(raw.metric),
        protocol: normalizeScoreRefString(raw.protocol),
        partition: normalizeScoreRefString(raw.partition),
        aggregation: normalizeScoreRefString(raw.aggregation),
        legacyScoreColumn: normalizeScoreRefString(raw.legacy_score_column),
        ...(normalizeScoreRefNumber(raw.target_index) != null ? { targetIndex: normalizeScoreRefNumber(raw.target_index) } : {}),
        ...(normalizeScoreRefString(raw.target_name) != null ? { targetName: normalizeScoreRefString(raw.target_name) } : {}),
        ...(normalizeScoreRefNumber(raw.source_index) != null ? { sourceIndex: normalizeScoreRefNumber(raw.source_index) } : {}),
        ...(normalizeScoreRefString(raw.source_name) != null ? { sourceName: normalizeScoreRefString(raw.source_name) } : {}),
        occurrences: 1,
      };
      const dedupeKey = unmappedScoreRefDedupeKey(scoreRef);
      const existing = unmappedScoreRefs.get(dedupeKey);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      unmappedScoreRefs.set(dedupeKey, scoreRef);
    }
    for (const scoreRef of extractScoreMapUnmappedScoreRefs(chain)) {
      const dedupeKey = unmappedScoreRefDedupeKey(scoreRef);
      const existing = unmappedScoreRefs.get(dedupeKey);
      if (existing) {
        existing.occurrences += 1;
        continue;
      }
      unmappedScoreRefs.set(dedupeKey, scoreRef);
    }
  }

  const metricKeys = orderMetricKeys([
    ...[...scoreRefs.values()].map((scoreRef) => scoreRef.metric),
    ...[...unmappedScoreRefs.values()].map((scoreRef) => scoreRef.metric),
  ].filter((metric): metric is string => metric != null && metric.length > 0));

  return {
    hasObservations: observations.length > 0,
    metricKeys,
    scoreRefs: [...scoreRefs.values()],
    unmappedScoreRefs: [...unmappedScoreRefs.values()],
  };
}

type MappedScoreRefAvailability = InspectorScoreRefAvailability & {
  legacyScoreColumn: ScoreColumn;
};

function isObservedMappedScoreRef(
  scoreRef: InspectorScoreRefAvailability,
): scoreRef is MappedScoreRefAvailability {
  return scoreRef.legacyScoreColumn != null && scoreRef.observationCount > 0;
}

function buildInspectorScoreColumnObservationCounts(
  readModel: InspectorMetricObservationReadModel,
): Map<ScoreColumn, number> {
  const counts = new Map<ScoreColumn, number>();
  for (const scoreRef of readModel.scoreRefs) {
    if (!isObservedMappedScoreRef(scoreRef)) continue;
    counts.set(
      scoreRef.legacyScoreColumn,
      (counts.get(scoreRef.legacyScoreColumn) ?? 0) + scoreRef.observationCount,
    );
  }
  return counts;
}

export function buildInspectorScoreColumnAvailability(
  readModel: InspectorMetricObservationReadModel,
  scoreColumns: readonly ScoreColumn[] = INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS,
): InspectorScoreColumnAvailability[] {
  const counts = buildInspectorScoreColumnObservationCounts(readModel);
  return scoreColumns.map((scoreColumn) => {
    const observationCount = counts.get(scoreColumn) ?? 0;
    return {
      scoreColumn,
      observationCount,
      hasMetricObservations: observationCount > 0,
    };
  });
}

function scoreRefAvailabilityToScoreRef(scoreRef: MappedScoreRefAvailability): ScoreRef {
  return {
    key: scoreRef.key,
    metric: scoreRef.metric,
    protocol: scoreRef.protocol,
    partition: scoreRef.partition,
    aggregation: scoreRef.aggregation,
    legacyScoreColumn: scoreRef.legacyScoreColumn,
    ...(scoreRef.targetIndex != null ? { targetIndex: scoreRef.targetIndex } : {}),
    ...(scoreRef.targetName != null ? { targetName: scoreRef.targetName } : {}),
    ...(scoreRef.sourceIndex != null ? { sourceIndex: scoreRef.sourceIndex } : {}),
    ...(scoreRef.sourceName != null ? { sourceName: scoreRef.sourceName } : {}),
  };
}

function selectBestObservedMappedScoreRefForColumn(
  scoreColumn: ScoreColumn,
  readModel: InspectorMetricObservationReadModel,
): MappedScoreRefAvailability | null {
  const candidates = readModel.scoreRefs
    .filter(isObservedMappedScoreRef)
    .filter((scoreRef) => scoreRef.legacyScoreColumn === scoreColumn);
  if (candidates.length === 0) {
    return null;
  }

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.observationCount > best.observationCount) {
      best = candidate;
    }
  }
  return best;
}

export function resolveInspectorObservedScoreColumn(
  requestedScoreColumn: ScoreColumn,
  readModel: InspectorMetricObservationReadModel,
  scoreColumns: readonly ScoreColumn[] = INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS,
): ScoreColumn {
  const observed = buildInspectorScoreColumnAvailability(readModel, scoreColumns)
    .filter((entry) => entry.hasMetricObservations);
  if (observed.length === 0) {
    return requestedScoreColumn;
  }
  if (observed.some((entry) => entry.scoreColumn === requestedScoreColumn)) {
    return requestedScoreColumn;
  }

  let best = observed[0];
  for (const entry of observed) {
    if (entry.observationCount > best.observationCount) {
      best = entry;
    }
  }
  return best.scoreColumn;
}

export function resolveInspectorObservedScoreRef(
  requestedScoreColumn: ScoreColumn,
  readModel: InspectorMetricObservationReadModel,
): ScoreRef | null {
  const effectiveScoreColumn = resolveInspectorObservedScoreColumn(requestedScoreColumn, readModel);
  const best = selectBestObservedMappedScoreRefForColumn(effectiveScoreColumn, readModel);
  return best ? scoreRefAvailabilityToScoreRef(best) : null;
}

export function resolveInspectorSelectedScoreRef(
  requestedScoreColumn: ScoreColumn,
  selectedScoreRefKey: string | null | undefined,
  readModel: InspectorMetricObservationReadModel,
): InspectorResolvedScoreRefSelection {
  const selected = selectedScoreRefKey
    ? readModel.scoreRefs
      .filter(isObservedMappedScoreRef)
      .find((scoreRef) => scoreRef.key === selectedScoreRefKey) ?? null
    : null;

  if (selected) {
    return {
      scoreColumn: selected.legacyScoreColumn,
      scoreRef: scoreRefAvailabilityToScoreRef(selected),
      selectedScoreRefKey: selected.key,
      isExplicit: true,
    };
  }

  const scoreColumn = resolveInspectorObservedScoreColumn(requestedScoreColumn, readModel);
  const best = selectBestObservedMappedScoreRefForColumn(scoreColumn, readModel);
  return {
    scoreColumn,
    scoreRef: best ? scoreRefAvailabilityToScoreRef(best) : null,
    selectedScoreRefKey: null,
    isExplicit: false,
  };
}

/**
 * Picks the legacy score column the score histogram should render, using the
 * metric-observation read model to verify the requested column actually has
 * observations across the visible chains.
 *
 * Legacy behavior is preserved: the requested column is kept whenever it is
 * observed, and also whenever the read model carries no mapped availability to
 * reason about (so callers that pre-date the read model behave exactly as
 * before). A substitution only happens when the requested column has no
 * observations but another column does — in which case the most-observed
 * available column wins, with ties resolved by the read model's score-ref
 * order.
 */
export function resolveScoreHistogramScoreColumn(
  requestedScoreColumn: ScoreColumn,
  readModel: InspectorMetricObservationReadModel,
): ScoreColumn {
  return resolveInspectorObservedScoreColumn(requestedScoreColumn, readModel);
}

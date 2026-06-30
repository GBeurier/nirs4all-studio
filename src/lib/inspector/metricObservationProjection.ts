import { getInspectorFiniteScore } from "@/lib/inspector/scoreAccess";
import type {
  InspectorChainSummary,
  MetricObservation,
  ScoreAggregation,
  ScoreColumn,
  ScoreEvaluationProtocol,
  ScorePartition,
  ScoreRef,
} from "@/types/inspector";

export interface ScoreColumnDescriptor {
  protocol: ScoreEvaluationProtocol;
  partition: ScorePartition;
  aggregation: ScoreAggregation;
}

export interface ScoreRefLike {
  protocol?: ScoreRef["protocol"] | null;
  partition?: ScoreRef["partition"] | null;
  aggregation?: ScoreRef["aggregation"] | null;
  legacyScoreColumn?: ScoreColumn | string | null;
  targetIndex?: number | null;
  targetName?: string | null;
  sourceIndex?: number | null;
  sourceName?: string | null;
}

export const INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS: readonly ScoreColumn[] = [
  "cv_val_score",
  "cv_test_score",
  "cv_train_score",
  "final_test_score",
  "final_train_score",
] as const;

const SCORE_COLUMN_DESCRIPTORS: Record<ScoreColumn, ScoreColumnDescriptor> = {
  cv_val_score: {
    protocol: "cross_validation",
    partition: "validation",
    aggregation: "fold_mean",
  },
  cv_test_score: {
    protocol: "cross_validation",
    partition: "test",
    aggregation: "fold_mean",
  },
  cv_train_score: {
    protocol: "cross_validation",
    partition: "train",
    aggregation: "fold_mean",
  },
  final_test_score: {
    protocol: "final",
    partition: "test",
    aggregation: "final_model",
  },
  final_train_score: {
    protocol: "final",
    partition: "train",
    aggregation: "final_model",
  },
};

function isInspectorScoreColumn(value: unknown): value is ScoreColumn {
  return typeof value === "string" && INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS.includes(value as ScoreColumn);
}

function isScoreColumnDescriptorMatch(
  descriptor: ScoreColumnDescriptor,
  ref: ScoreRefLike,
): boolean {
  return (
    descriptor.protocol === ref.protocol &&
    descriptor.partition === ref.partition &&
    descriptor.aggregation === ref.aggregation
  );
}

export function getInspectorScoreColumnDescriptor(scoreColumn: ScoreColumn): ScoreColumnDescriptor {
  return SCORE_COLUMN_DESCRIPTORS[scoreColumn];
}

export function resolveInspectorScoreColumnFromScoreRef(ref: ScoreRefLike | null | undefined): ScoreColumn | null {
  if (!ref) return null;
  if (
    ref.targetIndex != null
    || ref.targetName != null
    || ref.sourceIndex != null
    || ref.sourceName != null
  ) {
    return null;
  }

  if (isInspectorScoreColumn(ref.legacyScoreColumn)) {
    const descriptor = getInspectorScoreColumnDescriptor(ref.legacyScoreColumn);
    if (isScoreColumnDescriptorMatch(descriptor, ref)) return ref.legacyScoreColumn;
  }

  return INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS.find(scoreColumn => (
    isScoreColumnDescriptorMatch(getInspectorScoreColumnDescriptor(scoreColumn), ref)
  )) ?? null;
}

function normalizeMetricKey(metric: string | null | undefined): string {
  const normalized = metric?.trim();
  return normalized && normalized.length > 0 ? normalized : "unknown";
}

export function buildInspectorScoreRefKey(
  metric: string | null | undefined,
  scoreColumn: ScoreColumn,
): string {
  const descriptor = getInspectorScoreColumnDescriptor(scoreColumn);
  return [
    `metric=${normalizeMetricKey(metric)}`,
    `protocol=${descriptor.protocol}`,
    `partition=${descriptor.partition}`,
    `aggregation=${descriptor.aggregation}`,
  ].join("|");
}

export function projectInspectorScoreRef(
  chain: Pick<InspectorChainSummary, "metric">,
  scoreColumn: ScoreColumn,
): ScoreRef {
  const descriptor = getInspectorScoreColumnDescriptor(scoreColumn);
  const metric = chain.metric?.trim() || null;

  return {
    key: buildInspectorScoreRefKey(metric, scoreColumn),
    metric,
    protocol: descriptor.protocol,
    partition: descriptor.partition,
    aggregation: descriptor.aggregation,
    legacyScoreColumn: scoreColumn,
  };
}

export function projectInspectorMetricObservation(
  chain: InspectorChainSummary,
  scoreColumn: ScoreColumn,
): MetricObservation | null {
  const value = getInspectorFiniteScore(chain, scoreColumn);
  if (value == null) return null;

  const ref = projectInspectorScoreRef(chain, scoreColumn);

  return {
    id: `${chain.chain_id}:${ref.key}`,
    chainId: chain.chain_id,
    runId: chain.run_id,
    pipelineId: chain.pipeline_id,
    datasetName: chain.dataset_name,
    taskType: chain.task_type,
    ref,
    value,
  };
}

export function projectInspectorChainMetricObservations(
  chain: InspectorChainSummary,
  scoreColumns: readonly ScoreColumn[] = INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS,
): MetricObservation[] {
  return scoreColumns
    .map(scoreColumn => projectInspectorMetricObservation(chain, scoreColumn))
    .filter((observation): observation is MetricObservation => observation != null);
}

export function projectInspectorChainsMetricObservations(
  chains: readonly InspectorChainSummary[],
  scoreColumns: readonly ScoreColumn[] = INSPECTOR_METRIC_OBSERVATION_SCORE_COLUMNS,
): MetricObservation[] {
  return chains.flatMap(chain => projectInspectorChainMetricObservations(chain, scoreColumns));
}

import { resolveInspectorScoreColumnFromScoreRef } from "@/lib/inspector/metricObservationProjection";
import {
  normalizeFiniteScore,
  normalizeFoldCount,
  normalizeKeyPart,
  normalizeRecord,
  normalizeScoreSlot,
  normalizeText,
} from "@/lib/inspector/resultAnalysisStoreNormalization";
import type {
  ResultAnalysisChainEntry,
  ResultAnalysisEntryDefaults,
  ResultAnalysisMetricRecord,
} from "@/lib/inspector/resultAnalysisStore";
import type { ScoreColumn, ScoreRef } from "@/types/inspector";

interface MetricRecordAccumulator {
  entry: ResultAnalysisChainEntry;
  sourceIndexes: number[];
}

function resolveMetricRecordBaseId(
  record: ResultAnalysisMetricRecord,
  defaults: ResultAnalysisEntryDefaults | undefined,
  index: number,
): string {
  return normalizeText(record.chainId)
    ?? normalizeText(record.resultId)
    ?? [
      record.runId ?? defaults?.runId,
      record.pipelineId ?? defaults?.pipelineId,
      record.datasetName ?? defaults?.datasetName,
      record.modelClass ?? defaults?.modelClass,
      record.modelName ?? defaults?.modelName,
      record.preprocessings ?? defaults?.preprocessings,
      record.branchPath,
      record.targetName,
      record.metricVersion,
      record.foldIndex,
      record.randomSeed,
      record.refit,
      record.backend,
      index + 1,
    ].map(normalizeKeyPart).filter(Boolean).join("__");
}

function buildMetricRecordChainId(
  record: ResultAnalysisMetricRecord,
  defaults: ResultAnalysisEntryDefaults | undefined,
  index: number,
): string {
  const baseId = resolveMetricRecordBaseId(record, defaults, index);
  const metric = resolveMetricRecordMetric(record, defaults) ?? "metric";
  return `${baseId}::${metric}`;
}

function resolveMetricRecordScoreRef(record: ResultAnalysisMetricRecord): ScoreRef | undefined {
  return record.scoreRef ?? record.ref;
}

function resolveMetricRecordMetric(
  record: ResultAnalysisMetricRecord,
  defaults: ResultAnalysisEntryDefaults | undefined,
): string | null {
  const scoreRef = resolveMetricRecordScoreRef(record);
  return normalizeText(scoreRef?.metric) ?? normalizeText(record.metric) ?? normalizeText(defaults?.metric);
}

function resolveMetricRecordScoreColumn(record: ResultAnalysisMetricRecord): ScoreColumn | null {
  const scoreRef = resolveMetricRecordScoreRef(record);
  const scoreRefScoreColumn = resolveInspectorScoreColumnFromScoreRef(scoreRef);
  if (scoreRefScoreColumn != null) return scoreRefScoreColumn;
  return record.scoreColumn != null ? normalizeScoreSlot(record.scoreColumn) : null;
}

function normalizeMetadataText(value: unknown): string | null {
  return typeof value === "string" ? normalizeText(value) : null;
}

function appendMetadataText(metadata: Record<string, unknown>, key: string, value: unknown): void {
  const normalized = normalizeMetadataText(value);
  if (normalized != null) metadata[key] = normalized;
}

function normalizeMetadataNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function appendMetadataNumber(metadata: Record<string, unknown>, key: string, value: unknown): void {
  const normalized = normalizeMetadataNumber(value);
  if (normalized != null) metadata[key] = normalized;
}

function normalizeExistingScoreRefs(value: unknown): unknown[] {
  if (Array.isArray(value)) return [...value];
  return value == null ? [] : [value];
}

function buildRetainedScoreRefMetadata(
  record: ResultAnalysisMetricRecord,
  scoreColumn: ScoreColumn | null,
): Record<string, unknown> | null {
  if (scoreColumn != null) return null;

  const scoreRef = resolveMetricRecordScoreRef(record);
  if (!scoreRef) return null;

  const scoreRefRecord = scoreRef as unknown as Record<string, unknown>;
  const metadata: Record<string, unknown> = {};

  appendMetadataText(metadata, "key", scoreRefRecord.key);
  appendMetadataText(metadata, "metric", normalizeMetadataText(scoreRefRecord.metric) ?? record.metric);
  appendMetadataText(metadata, "protocol", scoreRefRecord.protocol);
  appendMetadataText(metadata, "partition", scoreRefRecord.partition);
  appendMetadataText(metadata, "aggregation", scoreRefRecord.aggregation);
  appendMetadataText(metadata, "legacy_score_column", scoreRefRecord.legacyScoreColumn);
  appendMetadataNumber(metadata, "target_index", scoreRefRecord.targetIndex);
  appendMetadataText(metadata, "target_name", scoreRefRecord.targetName);
  appendMetadataNumber(metadata, "source_index", scoreRefRecord.sourceIndex);
  appendMetadataText(metadata, "source_name", scoreRefRecord.sourceName);

  const score = normalizeFiniteScore(record.score);
  if (score != null) metadata.score = score;

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function appendRetainedScoreRefMetadata(
  variantParams: Record<string, unknown> | null | undefined,
  retainedScoreRefMetadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (retainedScoreRefMetadata == null) {
    return variantParams ? { ...variantParams } : null;
  }

  const baseParams = variantParams ?? {};
  const existingMetadata = normalizeRecord(baseParams.result_metadata) ?? {};

  return {
    ...baseParams,
    result_metadata: {
      ...existingMetadata,
      score_refs: [
        ...normalizeExistingScoreRefs(existingMetadata.score_refs),
        retainedScoreRefMetadata,
      ],
    },
  };
}

function buildMetricRecordVariantParams(
  record: ResultAnalysisMetricRecord,
  retainedScoreRefMetadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const metadata: Record<string, unknown> = {};
  const baseParams = record.variantParams ?? {};
  const existingMetadata = normalizeRecord(baseParams.result_metadata) ?? {};

  if (record.metricVersion != null) metadata.metric_version = record.metricVersion;
  if (record.targetName != null) metadata.target_name = record.targetName;
  if (record.split != null) metadata.split = record.split;
  if (record.foldIndex != null) metadata.fold_index = record.foldIndex;
  if (record.randomSeed != null) metadata.random_seed = record.randomSeed;
  if (record.refit != null) metadata.refit = record.refit;
  if (record.backend != null) metadata.backend = record.backend;
  if (record.contentAddress != null) metadata.content_address = record.contentAddress;
  if (record.sourceRef != null) metadata.source_ref = record.sourceRef;
  if (record.dimensions) metadata.dimensions = record.dimensions;
  if (retainedScoreRefMetadata != null) {
    metadata.score_refs = [
      ...normalizeExistingScoreRefs(existingMetadata.score_refs),
      retainedScoreRefMetadata,
    ];
  }

  if (Object.keys(metadata).length === 0) {
    return Object.keys(baseParams).length > 0 ? { ...baseParams } : null;
  }
  return {
    ...baseParams,
    result_metadata: {
      ...existingMetadata,
      ...metadata,
    },
  };
}

export function buildResultAnalysisEntriesFromMetricRecords(
  records: readonly ResultAnalysisMetricRecord[],
  defaults?: ResultAnalysisEntryDefaults,
): ResultAnalysisChainEntry[] {
  const accumulators = new Map<string, MetricRecordAccumulator>();

  records.forEach((record, index) => {
    const scoreColumn = resolveMetricRecordScoreColumn(record);
    const retainedScoreRefMetadata = buildRetainedScoreRefMetadata(record, scoreColumn);
    if (scoreColumn == null && retainedScoreRefMetadata == null) return;

    const metric = resolveMetricRecordMetric(record, defaults);
    const chainId = buildMetricRecordChainId(record, defaults, index);
    const existing = accumulators.get(chainId);
    if (existing) {
      if (scoreColumn != null) {
        existing.entry.scores = {
          ...existing.entry.scores,
          [scoreColumn]: normalizeFiniteScore(record.score),
        };
      }
      existing.entry.variantParams = appendRetainedScoreRefMetadata(existing.entry.variantParams, retainedScoreRefMetadata);
      existing.sourceIndexes.push(index);
      existing.entry.cvFoldCount = Math.max(
        normalizeFoldCount(existing.entry.cvFoldCount),
        normalizeFoldCount(record.cvFoldCount ?? (record.foldIndex != null ? record.foldIndex + 1 : undefined)),
      );
      return;
    }

    accumulators.set(chainId, {
      entry: {
        chainId,
        runId: record.runId,
        pipelineId: record.pipelineId,
        pipelineName: record.pipelineName,
        modelClass: record.modelClass,
        modelName: record.modelName,
        preprocessings: record.preprocessings,
        preprocessingSteps: record.preprocessingSteps,
        branchPath: record.branchPath,
        sourceIndex: record.sourceIndex ?? index,
        metric,
        taskType: record.taskType,
        datasetName: record.datasetName,
        bestParams: record.bestParams,
        variantParams: buildMetricRecordVariantParams(record, retainedScoreRefMetadata),
        scores: scoreColumn != null ? { [scoreColumn]: normalizeFiniteScore(record.score) } : undefined,
        cvFoldCount: record.cvFoldCount ?? (record.foldIndex != null ? record.foldIndex + 1 : undefined),
        pipelineStatus: record.pipelineStatus,
      },
      sourceIndexes: [index],
    });
  });

  return [...accumulators.values()].map(({ entry, sourceIndexes }) => ({
    ...entry,
    variantParams: {
      ...(entry.variantParams ?? {}),
      result_source_indexes: sourceIndexes,
    },
  }));
}

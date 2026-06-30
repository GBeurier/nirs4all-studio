import {
  getResultAnalysisMetadata,
  normalizedResultAnalysisString,
} from "@/lib/inspector/resultAnalysisDimensions";
import type { InspectorChainSummary } from "@/types/inspector";

export type ResultAnalysisMetadataFacetKind = "metadata" | "dimension";

export interface ResultAnalysisMetadataFacetValue {
  value: string;
  count: number;
}

export interface ResultAnalysisMetadataFacet {
  kind: ResultAnalysisMetadataFacetKind;
  key: string;
  values: ResultAnalysisMetadataFacetValue[];
}

export interface ResultAnalysisMetadataFacetSummary {
  kind: ResultAnalysisMetadataFacetKind;
  key: string;
  label: string;
  valueCount: number;
  totalValueCount: number;
}

export type ResultAnalysisMetadataFacetCounterSource =
  | ResultAnalysisMetadataFacetKind
  | "summary";

export interface ResultAnalysisMetadataFacetCounter {
  id: string;
  source: ResultAnalysisMetadataFacetCounterSource;
  label: string;
  value: number;
  formattedValue: string;
}

export interface BuildResultAnalysisMetadataFacetsOptions {
  includeMetadataFields?: boolean;
  includeDimensions?: boolean;
}

export interface BuildResultAnalysisMetadataFacetCountersOptions {
  maxFacetCounters?: number;
}

interface ResultAnalysisMetadataFacetBucket {
  kind: ResultAnalysisMetadataFacetKind;
  key: string;
  values: Map<string, number>;
}

function isResultAnalysisFacetScalar(value: unknown): boolean {
  return typeof value === "string"
    || typeof value === "boolean"
    || (typeof value === "number" && Number.isFinite(value));
}

function normalizedFacetValue(value: unknown): string | null {
  if (!isResultAnalysisFacetScalar(value)) return null;

  const normalized = normalizedResultAnalysisString(value);
  return normalized.length > 0 ? normalized : null;
}

function getFacetBucket(
  buckets: Map<string, ResultAnalysisMetadataFacetBucket>,
  kind: ResultAnalysisMetadataFacetKind,
  key: string,
): ResultAnalysisMetadataFacetBucket {
  const bucketKey = `${kind}:${key}`;
  const existing = buckets.get(bucketKey);
  if (existing) return existing;

  const bucket = {
    kind,
    key,
    values: new Map<string, number>(),
  };
  buckets.set(bucketKey, bucket);
  return bucket;
}

function addFacetValue(
  buckets: Map<string, ResultAnalysisMetadataFacetBucket>,
  kind: ResultAnalysisMetadataFacetKind,
  key: string,
  value: unknown,
): void {
  const normalized = normalizedFacetValue(value);
  if (normalized == null) return;

  const bucket = getFacetBucket(buckets, kind, key);
  bucket.values.set(normalized, (bucket.values.get(normalized) ?? 0) + 1);
}

function isMetadataDimensionsRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function formatResultAnalysisMetadataFacetKeyLabel(key: string): string {
  const label = key
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return label || key;
}

export function summarizeResultAnalysisMetadataFacet(
  facet: ResultAnalysisMetadataFacet,
): ResultAnalysisMetadataFacetSummary {
  return {
    kind: facet.kind,
    key: facet.key,
    label: formatResultAnalysisMetadataFacetKeyLabel(facet.key),
    valueCount: facet.values.length,
    totalValueCount: facet.values.reduce((sum, value) => sum + value.count, 0),
  };
}

export function summarizeResultAnalysisMetadataFacets(
  facets: readonly ResultAnalysisMetadataFacet[],
): ResultAnalysisMetadataFacetSummary[] {
  return facets.map(summarizeResultAnalysisMetadataFacet);
}

function formatResultAnalysisMetadataFacetValueCount(value: number): string {
  return `${value} ${value === 1 ? "value" : "values"}`;
}

function buildResultAnalysisMetadataFacetCounter(
  id: string,
  source: ResultAnalysisMetadataFacetCounterSource,
  label: string,
  value: number,
  formattedValue = String(value),
): ResultAnalysisMetadataFacetCounter {
  return {
    id,
    source,
    label,
    value,
    formattedValue,
  };
}

export function buildResultAnalysisMetadataFacetCounters(
  facets: readonly ResultAnalysisMetadataFacet[],
  options: BuildResultAnalysisMetadataFacetCountersOptions = {},
): ResultAnalysisMetadataFacetCounter[] {
  const maxFacetCounters = Math.max(0, Math.floor(options.maxFacetCounters ?? 3));
  const summaries = summarizeResultAnalysisMetadataFacets(facets);
  const metadataFacetCount = summaries.filter(summary => summary.kind === "metadata").length;
  const dimensionFacetCount = summaries.filter(summary => summary.kind === "dimension").length;
  const uniqueValueCount = summaries.reduce((sum, summary) => sum + summary.valueCount, 0);
  const counters: ResultAnalysisMetadataFacetCounter[] = [];

  if (metadataFacetCount > 0) {
    counters.push(buildResultAnalysisMetadataFacetCounter(
      "metadata.facets",
      "metadata",
      "Metadata facets",
      metadataFacetCount,
    ));
  }

  if (dimensionFacetCount > 0) {
    counters.push(buildResultAnalysisMetadataFacetCounter(
      "dimension.facets",
      "dimension",
      "Dimension facets",
      dimensionFacetCount,
    ));
  }

  if (uniqueValueCount > 0) {
    counters.push(buildResultAnalysisMetadataFacetCounter(
      "summary.uniqueValues",
      "summary",
      "Facet values",
      uniqueValueCount,
    ));
  }

  counters.push(
    ...[...summaries]
      .sort((left, right) => (
        right.valueCount - left.valueCount
        || right.totalValueCount - left.totalValueCount
        || left.label.localeCompare(right.label)
        || left.kind.localeCompare(right.kind)
        || left.key.localeCompare(right.key)
      ))
      .slice(0, maxFacetCounters)
      .map(summary => buildResultAnalysisMetadataFacetCounter(
        `${summary.kind}:${summary.key}.values`,
        summary.kind,
        summary.label,
        summary.valueCount,
        formatResultAnalysisMetadataFacetValueCount(summary.valueCount),
      )),
  );

  return counters;
}

export function buildResultAnalysisMetadataFacets(
  chains: readonly InspectorChainSummary[],
  options: BuildResultAnalysisMetadataFacetsOptions = {},
): ResultAnalysisMetadataFacet[] {
  const includeMetadataFields = options.includeMetadataFields ?? true;
  const includeDimensions = options.includeDimensions ?? true;
  const buckets = new Map<string, ResultAnalysisMetadataFacetBucket>();

  chains.forEach((chain) => {
    const metadata = getResultAnalysisMetadata(chain);

    if (includeMetadataFields) {
      Object.entries(metadata as Record<string, unknown>).forEach(([key, value]) => {
        if (key === "dimensions") return;
        addFacetValue(buckets, "metadata", key, value);
      });
    }

    if (includeDimensions && isMetadataDimensionsRecord(metadata.dimensions)) {
      Object.entries(metadata.dimensions).forEach(([key, value]) => {
        addFacetValue(buckets, "dimension", key, value);
      });
    }
  });

  const kindOrder: Record<ResultAnalysisMetadataFacetKind, number> = {
    metadata: 0,
    dimension: 1,
  };

  return [...buckets.values()]
    .map((bucket) => ({
      kind: bucket.kind,
      key: bucket.key,
      values: [...bucket.values.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((left, right) => left.value.localeCompare(right.value)),
    }))
    .sort((left, right) => (
      kindOrder[left.kind] - kindOrder[right.kind]
      || left.key.localeCompare(right.key)
    ));
}

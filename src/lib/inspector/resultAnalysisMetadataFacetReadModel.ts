import {
  buildResultAnalysisMetadataFacetCounters,
  buildResultAnalysisMetadataFacets,
  formatResultAnalysisMetadataFacetKeyLabel,
  summarizeResultAnalysisMetadataFacet,
  type BuildResultAnalysisMetadataFacetCountersOptions,
  type BuildResultAnalysisMetadataFacetsOptions,
  type ResultAnalysisMetadataFacet,
  type ResultAnalysisMetadataFacetCounter,
} from "@/lib/inspector/resultAnalysisMetadataFacets";
import type { ResultAnalysisQuery } from "@/lib/inspector/resultAnalysisQuery";
import type { InspectorChainSummary } from "@/types/inspector";

export interface ResultAnalysisMetadataFacetValueItem {
  id: string;
  label: string;
  count: number;
}

export interface ResultAnalysisMetadataFacetItem {
  id: string;
  kind: ResultAnalysisMetadataFacet["kind"];
  key: string;
  label: string;
  valueCount: number;
  totalCount: number;
  values: ResultAnalysisMetadataFacetValueItem[];
  hiddenValueCount: number;
}

export interface ResultAnalysisMetadataFacetSelection {
  kind: ResultAnalysisMetadataFacet["kind"];
  key: string;
  values: readonly string[];
}

export type ResultAnalysisMetadataFacetQuery = Pick<ResultAnalysisQuery, "dimensions" | "resultMetadata">;

export interface BuildResultAnalysisMetadataFacetItemsOptions {
  valueLimit?: number;
}

export interface BuildResultAnalysisMetadataFacetReadModelOptions {
  facetOptions?: BuildResultAnalysisMetadataFacetsOptions;
  itemOptions?: BuildResultAnalysisMetadataFacetItemsOptions;
  counterOptions?: BuildResultAnalysisMetadataFacetCountersOptions;
  selections?: readonly ResultAnalysisMetadataFacetSelection[];
}

export interface ResultAnalysisMetadataFacetReadModel {
  facets: ResultAnalysisMetadataFacet[];
  items: ResultAnalysisMetadataFacetItem[];
  query: ResultAnalysisMetadataFacetQuery;
  counters: ResultAnalysisMetadataFacetCounter[];
}

export function buildResultAnalysisMetadataFacetItems(
  facets: readonly ResultAnalysisMetadataFacet[],
  options: BuildResultAnalysisMetadataFacetItemsOptions = {},
): ResultAnalysisMetadataFacetItem[] {
  const valueLimit = Math.max(0, Math.floor(options.valueLimit ?? 5));

  return facets.map((facet) => {
    const summary = summarizeResultAnalysisMetadataFacet(facet);
    const orderedValues = [...facet.values].sort((left, right) => (
      right.count - left.count ||
      left.value.localeCompare(right.value)
    ));
    const visibleValues = orderedValues.slice(0, valueLimit);

    return {
      id: `${facet.kind}:${facet.key}`,
      kind: facet.kind,
      key: facet.key,
      label: formatResultAnalysisMetadataFacetKeyLabel(facet.key),
      valueCount: summary.valueCount,
      totalCount: summary.totalValueCount,
      values: visibleValues.map(value => ({
        id: `${facet.kind}:${facet.key}:${value.value}`,
        label: value.value,
        count: value.count,
      })),
      hiddenValueCount: Math.max(0, orderedValues.length - visibleValues.length),
    };
  });
}

function addSelectionValues(
  target: Record<string, string[]>,
  key: string,
  values: readonly string[],
): void {
  const normalizedValues = values
    .map(value => value.trim())
    .filter(Boolean);

  if (normalizedValues.length === 0) return;

  const current = target[key] ?? [];
  target[key] = [...new Set([...current, ...normalizedValues])];
}

export function buildResultAnalysisMetadataFacetQuery(
  selections: readonly ResultAnalysisMetadataFacetSelection[],
): ResultAnalysisMetadataFacetQuery {
  const resultMetadata: Record<string, string[]> = {};
  const dimensions: Record<string, string[]> = {};

  for (const selection of selections) {
    if (selection.kind === "metadata") {
      addSelectionValues(resultMetadata, selection.key, selection.values);
    } else {
      addSelectionValues(dimensions, selection.key, selection.values);
    }
  }

  return {
    ...(Object.keys(resultMetadata).length > 0 ? { resultMetadata } : {}),
    ...(Object.keys(dimensions).length > 0 ? { dimensions } : {}),
  };
}

export function buildResultAnalysisMetadataFacetReadModel(
  chains: readonly InspectorChainSummary[],
  options: BuildResultAnalysisMetadataFacetReadModelOptions = {},
): ResultAnalysisMetadataFacetReadModel {
  const facets = buildResultAnalysisMetadataFacets(chains, options.facetOptions);

  return {
    facets,
    items: buildResultAnalysisMetadataFacetItems(facets, options.itemOptions),
    query: buildResultAnalysisMetadataFacetQuery(options.selections ?? []),
    counters: buildResultAnalysisMetadataFacetCounters(facets, options.counterOptions),
  };
}

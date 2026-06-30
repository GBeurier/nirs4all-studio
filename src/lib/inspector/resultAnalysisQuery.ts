import {
  getResultAnalysisChains,
  type ResultAnalysisStore,
  type ResultAnalysisStoreSource,
} from "@/lib/inspector/resultAnalysisStore";
import {
  buildResultAnalysisComplementarityViewModel as buildResultAnalysisComplementarityAggregationViewModel,
  buildResultAnalysisRobustnessViewModel as buildResultAnalysisRobustnessAggregationViewModel,
  type ResultAnalysisComplementarityEntry,
  type ResultAnalysisComplementarityPair,
  type ResultAnalysisComplementarityViewModel as ResultAnalysisComplementarityAggregationViewModel,
  type ResultAnalysisComplementarityViewModelOptions,
  type ResultAnalysisRobustnessGroup,
  type ResultAnalysisRobustnessViewModel as ResultAnalysisRobustnessAggregationViewModel,
  type ResultAnalysisRobustnessViewModelOptions,
} from "@/lib/inspector/resultAnalysisAggregations";
import {
  buildResultAnalysisLeaderboardViewModel as buildResultAnalysisLeaderboardProjectionViewModel,
  buildResultAnalysisMatrixViewModel as buildResultAnalysisMatrixProjectionViewModel,
  type ResultAnalysisLeaderboardRow,
  type ResultAnalysisLeaderboardViewModel as ResultAnalysisLeaderboardProjectionViewModel,
  type ResultAnalysisMatrixCell,
  type ResultAnalysisMatrixViewModel as ResultAnalysisMatrixProjectionViewModel,
  type ResultAnalysisMatrixViewModelOptions,
} from "@/lib/inspector/resultAnalysisViewModels";
import {
  getInspectorFiniteScore,
  sortInspectorChainsByScore,
} from "@/lib/inspector/scoreAccess";
import {
  getResultAnalysisMetadata,
  matchesResultAnalysisDimensions,
  matchesResultAnalysisMetadataFields,
  normalizedResultAnalysisString,
} from "@/lib/inspector/resultAnalysisDimensions";
import {
  buildResultAnalysisMetadataFacets,
  type BuildResultAnalysisMetadataFacetsOptions,
  type ResultAnalysisMetadataFacet,
} from "@/lib/inspector/resultAnalysisMetadataFacets";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export type {
  ResultAnalysisGroupField,
  ResultAnalysisMatrixAxisField,
} from "@/lib/inspector/resultAnalysisDimensions";

export type ResultAnalysisSortDirection = "asc" | "desc" | "best" | "worst";

export type ResultAnalysisSort =
  | {
      by: "score";
      scoreColumn: ScoreColumn;
      direction?: ResultAnalysisSortDirection;
      lowerBetter?: boolean;
      metric?: string | null;
    }
  | {
      by: "chain_id" | "run_id" | "pipeline_id" | "dataset_name" | "model_class" | "metric";
      direction?: "asc" | "desc";
    };

export interface ResultAnalysisScoreQuery {
  column: ScoreColumn;
  min?: number;
  max?: number;
  requireFinite?: boolean;
}

export interface ResultAnalysisQuery {
  chainIds?: readonly string[];
  runIds?: readonly string[];
  pipelineIds?: readonly string[];
  datasetNames?: readonly string[];
  modelClasses?: readonly string[];
  metrics?: readonly string[];
  taskTypes?: readonly string[];
  pipelineStatuses?: readonly string[];
  preprocessings?: readonly string[];
  targetNames?: readonly string[];
  backends?: readonly string[];
  contentAddresses?: readonly string[];
  dimensions?: Record<string, readonly unknown[]>;
  resultMetadata?: Record<string, readonly unknown[]>;
  score?: ResultAnalysisScoreQuery;
  sort?: ResultAnalysisSort;
  limit?: number;
}

export interface ResultAnalysisQueryResult {
  source: ResultAnalysisStoreSource;
  chains: readonly InspectorChainSummary[];
  chainIds: readonly string[];
  matchedCount: number;
  displayedCount: number;
  truncated: boolean;
}

export interface ResultAnalysisFacetedQueryResult extends ResultAnalysisQueryResult {
  metadataFacets: readonly ResultAnalysisMetadataFacet[];
}

export type ResultAnalysisViewKind =
  | "table"
  | "leaderboard"
  | "matrix"
  | "robustness"
  | "complementarity";

export interface ResultAnalysisViewSpec {
  id?: string;
  kind: ResultAnalysisViewKind;
  title?: string;
  query?: ResultAnalysisQuery;
  scoreColumn?: ScoreColumn;
  limit?: number;
  sort?: ResultAnalysisSort;
}

export interface ResultAnalysisView {
  id: string;
  kind: ResultAnalysisViewKind;
  title?: string;
  source: ResultAnalysisStoreSource;
  scoreColumn?: ScoreColumn;
  chains: readonly InspectorChainSummary[];
  chainIds: readonly string[];
  matchedCount: number;
  displayedCount: number;
  truncated: boolean;
}

export type {
  ResultAnalysisComplementarityEntry,
  ResultAnalysisComplementarityPair,
  ResultAnalysisLeaderboardRow,
  ResultAnalysisMatrixCell,
  ResultAnalysisRobustnessGroup,
};

export type ResultAnalysisLeaderboardViewModel = ResultAnalysisLeaderboardProjectionViewModel<ResultAnalysisView>;

export type ResultAnalysisMatrixViewModel = ResultAnalysisMatrixProjectionViewModel<ResultAnalysisView>;

export type ResultAnalysisRobustnessViewModel = ResultAnalysisRobustnessAggregationViewModel<ResultAnalysisView>;

export type ResultAnalysisComplementarityViewModel = ResultAnalysisComplementarityAggregationViewModel<ResultAnalysisView>;

function normalizedSet(values: readonly string[] | undefined): Set<string> | null {
  if (!values || values.length === 0) return null;
  return new Set(values.map(value => value.trim()).filter(Boolean));
}

function matchesSet(value: unknown, allowed: Set<string> | null): boolean {
  return !allowed || allowed.has(normalizedResultAnalysisString(value));
}

function matchesScore(chain: InspectorChainSummary, score: ResultAnalysisScoreQuery | undefined): boolean {
  if (!score) return true;

  const value = getInspectorFiniteScore(chain, score.column);
  if (value == null) return score.requireFinite !== true && score.min == null && score.max == null;
  if (score.min != null && value < score.min) return false;
  if (score.max != null && value > score.max) return false;
  return true;
}

function compareNullableText(left: unknown, right: unknown): number {
  return normalizedResultAnalysisString(left).localeCompare(normalizedResultAnalysisString(right));
}

function sortByText(
  chains: readonly InspectorChainSummary[],
  key: ResultAnalysisSort & { by: "chain_id" | "run_id" | "pipeline_id" | "dataset_name" | "model_class" | "metric" },
): InspectorChainSummary[] {
  const direction = key.direction ?? "asc";
  return [...chains].sort((left, right) => {
    const comparison = compareNullableText(left[key.by], right[key.by]);
    if (comparison !== 0) return direction === "asc" ? comparison : -comparison;
    return left.chain_id.localeCompare(right.chain_id);
  });
}

function sortByScore(
  chains: readonly InspectorChainSummary[],
  sort: ResultAnalysisSort & { by: "score" },
): InspectorChainSummary[] {
  const direction = sort.direction ?? "best";
  if (direction === "best" || direction === "worst") {
    const sorted = sortInspectorChainsByScore(chains, sort.scoreColumn, {
      lowerBetter: sort.lowerBetter,
      metric: sort.metric,
      tieBreaker: "chain_id",
    });
    return direction === "best" ? sorted : sorted.reverse();
  }

  const lowerBetter = direction === "asc";
  return sortInspectorChainsByScore(chains, sort.scoreColumn, {
    lowerBetter,
    tieBreaker: "chain_id",
  });
}

export function filterResultAnalysisStoreByQuery(
  store: Pick<ResultAnalysisStore, "chains">,
  query: ResultAnalysisQuery = {},
): InspectorChainSummary[] {
  const chainIds = normalizedSet(query.chainIds);
  const runIds = normalizedSet(query.runIds);
  const pipelineIds = normalizedSet(query.pipelineIds);
  const datasetNames = normalizedSet(query.datasetNames);
  const modelClasses = normalizedSet(query.modelClasses);
  const metrics = normalizedSet(query.metrics);
  const taskTypes = normalizedSet(query.taskTypes);
  const pipelineStatuses = normalizedSet(query.pipelineStatuses);
  const preprocessings = normalizedSet(query.preprocessings);
  const targetNames = normalizedSet(query.targetNames);
  const backends = normalizedSet(query.backends);
  const contentAddresses = normalizedSet(query.contentAddresses);

  return getResultAnalysisChains(store).filter(chain => {
    const metadata = getResultAnalysisMetadata(chain);
    return matchesSet(chain.chain_id, chainIds)
      && matchesSet(chain.run_id, runIds)
      && matchesSet(chain.pipeline_id, pipelineIds)
      && matchesSet(chain.dataset_name, datasetNames)
      && matchesSet(chain.model_class, modelClasses)
      && matchesSet(chain.metric, metrics)
      && matchesSet(chain.task_type, taskTypes)
      && matchesSet(chain.pipeline_status, pipelineStatuses)
      && matchesSet(chain.preprocessings, preprocessings)
      && matchesSet(metadata.target_name, targetNames)
      && matchesSet(metadata.backend, backends)
      && matchesSet(metadata.content_address, contentAddresses)
      && matchesResultAnalysisDimensions(metadata, query.dimensions)
      && matchesResultAnalysisMetadataFields(metadata, query.resultMetadata)
      && matchesScore(chain, query.score);
  });
}

export function sortResultAnalysisChains(
  chains: readonly InspectorChainSummary[],
  sort: ResultAnalysisSort | undefined,
): InspectorChainSummary[] {
  if (!sort) return [...chains];
  return sort.by === "score" ? sortByScore(chains, sort) : sortByText(chains, sort);
}

export function queryResultAnalysisStore(
  store: Pick<ResultAnalysisStore, "chains" | "source">,
  query: ResultAnalysisQuery = {},
): ResultAnalysisQueryResult {
  const matched = sortResultAnalysisChains(
    filterResultAnalysisStoreByQuery(store, query),
    query.sort,
  );
  const limit = query.limit != null && query.limit >= 0 ? Math.floor(query.limit) : null;
  const chains = limit == null ? matched : matched.slice(0, limit);

  return {
    source: store.source,
    chains,
    chainIds: chains.map(chain => chain.chain_id),
    matchedCount: matched.length,
    displayedCount: chains.length,
    truncated: limit != null && matched.length > limit,
  };
}

export function queryResultAnalysisStoreWithMetadataFacets(
  store: Pick<ResultAnalysisStore, "chains" | "source">,
  query: ResultAnalysisQuery = {},
  facetOptions?: BuildResultAnalysisMetadataFacetsOptions,
): ResultAnalysisFacetedQueryResult {
  const result = queryResultAnalysisStore(store, query);

  return {
    ...result,
    metadataFacets: buildResultAnalysisMetadataFacets(result.chains, facetOptions),
  };
}

export function buildResultAnalysisView(
  store: Pick<ResultAnalysisStore, "chains" | "source">,
  spec: ResultAnalysisViewSpec,
): ResultAnalysisView {
  const scoreColumn = spec.scoreColumn ?? (spec.sort?.by === "score" ? spec.sort.scoreColumn : undefined);
  const query = {
    ...(spec.query ?? {}),
    limit: spec.limit ?? spec.query?.limit,
    sort: spec.sort ?? spec.query?.sort ?? (
      scoreColumn ? { by: "score" as const, scoreColumn, direction: "best" as const } : undefined
    ),
  };
  const result = queryResultAnalysisStore(store, query);

  return {
    id: spec.id ?? `${store.source.id}-${spec.kind}`,
    kind: spec.kind,
    title: spec.title,
    source: result.source,
    scoreColumn,
    chains: result.chains,
    chainIds: result.chainIds,
    matchedCount: result.matchedCount,
    displayedCount: result.displayedCount,
    truncated: result.truncated,
  };
}

export function buildResultAnalysisLeaderboardViewModel(
  view: ResultAnalysisView,
  scoreColumn = view.scoreColumn,
): ResultAnalysisLeaderboardViewModel {
  return buildResultAnalysisLeaderboardProjectionViewModel(view, scoreColumn);
}

export function buildResultAnalysisMatrixViewModel(
  view: ResultAnalysisView,
  options: ResultAnalysisMatrixViewModelOptions,
): ResultAnalysisMatrixViewModel {
  return buildResultAnalysisMatrixProjectionViewModel(view, options);
}

export function buildResultAnalysisRobustnessViewModel(
  view: ResultAnalysisView,
  options: ResultAnalysisRobustnessViewModelOptions,
): ResultAnalysisRobustnessViewModel {
  return buildResultAnalysisRobustnessAggregationViewModel(view, options);
}

export function buildResultAnalysisComplementarityViewModel(
  view: ResultAnalysisView,
  options: ResultAnalysisComplementarityViewModelOptions,
): ResultAnalysisComplementarityViewModel {
  return buildResultAnalysisComplementarityAggregationViewModel(view, options);
}

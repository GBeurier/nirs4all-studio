import {
  buildResultAnalysisStore,
  buildResultAnalysisStoreFromAggregatedPredictionsResponse,
  buildResultAnalysisStoreFromChainSummaries,
  buildResultAnalysisStoreFromEntries,
  buildResultAnalysisStoreFromMetricRecords,
  buildResultAnalysisStoreFromResultListResponse,
  buildResultAnalysisStoreFromResults,
  buildResultAnalysisStoreFromShapAvailableModels,
  type ResultAnalysisChainEntry,
  type ResultAnalysisEntryDefaults,
  type ResultAnalysisMetricRecord,
  type ResultAnalysisStore,
  type ResultAnalysisStoreSource,
} from "@/lib/inspector/resultAnalysisStore";
import {
  canonicalMetricKey,
  collectPresentMetricKeys,
  extractScoreValue,
} from "@/lib/scores";
import {
  buildResultAnalysisView,
  type ResultAnalysisView,
  type ResultAnalysisViewSpec,
} from "@/lib/inspector/resultAnalysisQuery";
import type { TopChainResult } from "@/types/enriched-runs";
import type { AggregatedPredictionsResponse, ChainSummary } from "@/types/aggregated-predictions";
import type { InspectorChainSummary } from "@/types/inspector";
import type { DatasetTopChains, Result, ResultListResponse, ResultsSummaryResponse } from "@/types/runs";
import type { AvailableModelsResponse } from "@/types/shap";

export interface ResultAnalysisWorkspaceResultsResponse {
  workspace_id: string;
  results: readonly Result[];
}

export type ResultAnalysisImportSource =
  | {
      kind: "store";
      store: ResultAnalysisStore;
    }
  | {
      kind: "inspector_chains";
      chains: readonly InspectorChainSummary[];
      source?: Partial<ResultAnalysisStoreSource>;
    }
  | {
      kind: "entries";
      entries: readonly ResultAnalysisChainEntry[];
      source: ResultAnalysisStoreSource;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "metric_records";
      records: readonly ResultAnalysisMetricRecord[];
      source: ResultAnalysisStoreSource;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "results";
      results: readonly Result[];
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "result_list_response";
      response: Pick<ResultListResponse, "workspace_id" | "results">;
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "workspace_results_response";
      response: ResultAnalysisWorkspaceResultsResponse;
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "chain_summaries";
      summaries: readonly ChainSummary[];
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "aggregated_predictions_response";
      response: Pick<AggregatedPredictionsResponse, "predictions">;
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "shap_available_models_response";
      response: Pick<AvailableModelsResponse, "datasets">;
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "dataset_top_chains";
      datasets: readonly DatasetTopChains[];
      source: ResultAnalysisStoreSource;
      defaults?: ResultAnalysisEntryDefaults;
    }
  | {
      kind: "results_summary_response";
      response: Pick<ResultsSummaryResponse, "workspace_id" | "datasets">;
      source?: Partial<ResultAnalysisStoreSource>;
      defaults?: ResultAnalysisEntryDefaults;
    };

function assertNever(source: never): never {
  throw new Error(`Unsupported result analysis import source: ${JSON.stringify(source)}`);
}

function isSameMetric(left: string | null | undefined, right: string | null | undefined): boolean {
  const leftCanonical = canonicalMetricKey(left);
  const rightCanonical = canonicalMetricKey(right);
  if (leftCanonical && rightCanonical) return leftCanonical === rightCanonical;
  return (left ?? "").trim() === (right ?? "").trim();
}

function addMetricRecord(
  records: ResultAnalysisMetricRecord[],
  base: Omit<ResultAnalysisMetricRecord, "score" | "scoreColumn">,
  scoreColumn: ResultAnalysisMetricRecord["scoreColumn"],
  score: unknown,
): void {
  if (score == null) return;
  records.push({
    ...base,
    scoreColumn,
    score,
  });
}

function getSummaryMetricKeys(dataset: DatasetTopChains, chain: TopChainResult): string[] {
  const keys = new Set<string>();
  if (dataset.metric) keys.add(dataset.metric);
  for (const key of collectPresentMetricKeys(
    chain.scores?.val as Record<string, unknown> | undefined,
    chain.scores?.test as Record<string, unknown> | undefined,
    chain.final_scores as Record<string, unknown> | undefined,
    chain.final_agg_scores as Record<string, unknown> | undefined,
  )) {
    keys.add(key);
  }
  return [...keys].sort((left, right) => left.localeCompare(right));
}

function getSummaryVariantParams(
  dataset: DatasetTopChains,
  chain: TopChainResult,
): Record<string, unknown> {
  return {
    ...(chain.variant_params ?? {}),
    result_summary: {
      linked_dataset_id: dataset.linked_dataset_id,
      cv_source_chain_id: chain.cv_source_chain_id ?? null,
      final_agg_test_score: chain.final_agg_test_score ?? null,
      final_agg_train_score: chain.final_agg_train_score ?? null,
      final_scores: chain.final_scores,
      final_agg_scores: chain.final_agg_scores ?? null,
      is_refit_only: chain.is_refit_only ?? null,
      synthetic_refit: chain.synthetic_refit ?? null,
    },
  };
}

function buildMetricRecordsFromDatasetTopChains(
  datasets: readonly DatasetTopChains[],
): ResultAnalysisMetricRecord[] {
  const records: ResultAnalysisMetricRecord[] = [];

  for (const dataset of datasets) {
    for (const chain of dataset.top_chains) {
      for (const metric of getSummaryMetricKeys(dataset, chain)) {
        const isPrimaryMetric = isSameMetric(metric, dataset.metric);
        const base: Omit<ResultAnalysisMetricRecord, "score" | "scoreColumn"> = {
          resultId: chain.chain_id,
          chainId: chain.chain_id,
          runId: chain.run_id,
          pipelineId: chain.pipeline_id,
          pipelineName: chain.pipeline_name,
          datasetName: dataset.dataset_name,
          modelClass: chain.model_class,
          modelName: chain.model_name,
          preprocessings: chain.preprocessings,
          metric,
          taskType: dataset.task_type,
          bestParams: chain.best_params ?? null,
          variantParams: getSummaryVariantParams(dataset, chain),
          cvFoldCount: chain.fold_count,
          sourceRef: "results_summary",
          dimensions: {
            result_source: "results_summary",
          },
        };

        addMetricRecord(records, base, "validation", extractScoreValue(chain.scores?.val, metric, "val") ?? (isPrimaryMetric ? chain.avg_val_score : null));
        addMetricRecord(records, base, "test", extractScoreValue(chain.scores?.test, metric, "test") ?? (isPrimaryMetric ? chain.avg_test_score : null));
        addMetricRecord(records, base, "train", isPrimaryMetric ? chain.avg_train_score : null);
        addMetricRecord(records, base, "final_test", extractScoreValue(chain.final_scores, metric, "test") ?? extractScoreValue(chain.final_agg_scores ?? null, metric, "test") ?? (isPrimaryMetric ? chain.final_test_score ?? chain.final_agg_test_score : null));
        addMetricRecord(records, base, "final_train", extractScoreValue(chain.final_scores, metric, "train") ?? extractScoreValue(chain.final_agg_scores ?? null, metric, "train") ?? (isPrimaryMetric ? chain.final_train_score ?? chain.final_agg_train_score : null));
      }
    }
  }

  return records;
}

function buildResultsSummarySource(
  source: Partial<ResultAnalysisStoreSource> | undefined,
  workspaceId: string,
): ResultAnalysisStoreSource {
  return {
    id: source?.id ?? `workspace-${workspaceId}-results-summary`,
    kind: source?.kind ?? "result_repository",
    label: source?.label,
  };
}

export function buildResultAnalysisStoreFromImport(source: ResultAnalysisImportSource): ResultAnalysisStore {
  switch (source.kind) {
    case "store":
      return source.store;
    case "inspector_chains":
      return buildResultAnalysisStore({
        chains: source.chains,
        source: source.source,
      });
    case "entries":
      return buildResultAnalysisStoreFromEntries({
        entries: source.entries,
        source: source.source,
        defaults: source.defaults,
      });
    case "metric_records":
      return buildResultAnalysisStoreFromMetricRecords({
        records: source.records,
        source: source.source,
        defaults: source.defaults,
      });
    case "results":
      return buildResultAnalysisStoreFromResults({
        results: source.results,
        source: source.source,
        defaults: source.defaults,
      });
    case "result_list_response":
      return buildResultAnalysisStoreFromResultListResponse({
        response: source.response,
        source: source.source,
        defaults: source.defaults,
      });
    case "workspace_results_response":
      return buildResultAnalysisStoreFromResultListResponse({
        response: {
          workspace_id: source.response.workspace_id,
          results: [...source.response.results],
        },
        source: source.source,
        defaults: source.defaults,
      });
    case "chain_summaries":
      return buildResultAnalysisStoreFromChainSummaries({
        summaries: source.summaries,
        source: source.source,
        defaults: source.defaults,
      });
    case "aggregated_predictions_response":
      return buildResultAnalysisStoreFromAggregatedPredictionsResponse({
        response: source.response,
        source: source.source,
        defaults: source.defaults,
      });
    case "shap_available_models_response":
      return buildResultAnalysisStoreFromShapAvailableModels({
        response: source.response,
        source: source.source,
        defaults: source.defaults,
      });
    case "dataset_top_chains":
      return buildResultAnalysisStoreFromMetricRecords({
        records: buildMetricRecordsFromDatasetTopChains(source.datasets),
        source: source.source,
        defaults: source.defaults,
      });
    case "results_summary_response":
      return buildResultAnalysisStoreFromMetricRecords({
        records: buildMetricRecordsFromDatasetTopChains(source.response.datasets),
        source: buildResultsSummarySource(source.source, source.response.workspace_id),
        defaults: source.defaults,
      });
    default:
      return assertNever(source);
  }
}

export function buildResultAnalysisViewFromImport(
  source: ResultAnalysisImportSource,
  spec: ResultAnalysisViewSpec,
): ResultAnalysisView {
  return buildResultAnalysisView(buildResultAnalysisStoreFromImport(source), spec);
}

export function buildResultAnalysisViewsFromImport(
  source: ResultAnalysisImportSource,
  specs: readonly ResultAnalysisViewSpec[],
): ResultAnalysisView[] {
  const store = buildResultAnalysisStoreFromImport(source);
  return specs.map(spec => buildResultAnalysisView(store, spec));
}

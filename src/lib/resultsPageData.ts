import {
  getBestCvEntry,
  getBestFinalEntry,
} from "@/lib/scores";
import { buildResultAnalysisStoreFromImport } from "@/lib/inspector/resultAnalysisImport";
import { buildResultAnalysisMetricSelectionContext } from "@/lib/inspector/resultAnalysisMetricContext";
import type { DatasetTopChains } from "@/types/runs";
import type { EnrichedDatasetRun } from "@/types/enriched-runs";

interface ResultsMetricWorkspaceRef {
  id?: string | null;
  name?: string | null;
}

export interface ResultsDatasetView {
  filteredDatasets: DatasetTopChains[];
  metricSourceDatasets: DatasetTopChains[];
  adaptedDatasets: EnrichedDatasetRun[];
}

export function adaptDatasetTopChainsToEnrichedDataset(dataset: DatasetTopChains): EnrichedDatasetRun {
  const bestFinalChain = getBestFinalEntry(dataset.top_chains, dataset.metric);
  const bestCvChain = getBestCvEntry(dataset.top_chains, dataset.metric);

  return {
    dataset_name: dataset.dataset_name,
    best_avg_val_score: bestCvChain?.avg_val_score ?? null,
    best_avg_test_score: bestCvChain?.avg_test_score ?? null,
    best_final_score: bestFinalChain?.final_test_score ?? null,
    metric: dataset.metric,
    task_type: dataset.task_type,
    gain_from_previous_best: null,
    pipeline_count: dataset.top_chains.length,
    top_5: dataset.top_chains,
  };
}

export function filterResultsDatasets(
  datasets: DatasetTopChains[],
  searchQuery: string,
): DatasetTopChains[] {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return datasets;
  return datasets.filter((dataset) => dataset.dataset_name.toLowerCase().includes(query));
}

export function selectResultsMetricSourceDatasets(
  filteredDatasets: DatasetTopChains[],
  datasets: DatasetTopChains[],
): DatasetTopChains[] {
  return filteredDatasets.length > 0 ? filteredDatasets : datasets;
}

export function buildResultsDatasetView(
  datasets: DatasetTopChains[],
  searchQuery: string,
): ResultsDatasetView {
  const filteredDatasets = filterResultsDatasets(datasets, searchQuery);
  const metricSourceDatasets = selectResultsMetricSourceDatasets(filteredDatasets, datasets);

  return {
    filteredDatasets,
    metricSourceDatasets,
    adaptedDatasets: filteredDatasets.map(adaptDatasetTopChainsToEnrichedDataset),
  };
}

export function buildResultsMetricSelectionContext(
  datasets: DatasetTopChains[],
  workspace: ResultsMetricWorkspaceRef | null,
) {
  const resultAnalysisStore = buildResultAnalysisStoreFromImport({
    kind: "dataset_top_chains",
    datasets,
    source: {
      id: workspace?.id ? `workspace-${workspace.id}-results-summary-view` : "results-summary-view",
      kind: "result_repository",
      label: workspace?.name ?? undefined,
    },
  });

  return buildResultAnalysisMetricSelectionContext(resultAnalysisStore);
}

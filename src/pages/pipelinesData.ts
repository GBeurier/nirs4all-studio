import type { ChainSummary } from "@/types/aggregated-predictions";
import type { Pipeline, PipelinePreset, SortBy } from "@/types/pipelines";
import type { Run } from "@/types/runs";

/** Pure data helpers backing the Pipelines page: search filtering, sorting,
 * recent-run projection, and best-chain selection. No React, no side effects. */

export function matchesPipelineSearch(pipeline: Pipeline, query: string): boolean {
  if (!query) return true;
  return (
    pipeline.name.toLowerCase().includes(query) ||
    pipeline.description.toLowerCase().includes(query) ||
    pipeline.tags.some((tag) => tag.toLowerCase().includes(query))
  );
}

export function matchesPresetSearch(preset: PipelinePreset, query: string): boolean {
  if (!query) return true;
  const variants = preset.available_variants?.join(" ") ?? preset.task_type ?? "";
  return (
    preset.name.toLowerCase().includes(query) ||
    preset.description.toLowerCase().includes(query) ||
    variants.toLowerCase().includes(query)
  );
}

export function sortPipelineItems(pipelines: Pipeline[], sortBy: SortBy): Pipeline[] {
  return [...pipelines].sort((a, b) => {
    switch (sortBy) {
      case "name":
        return a.name.localeCompare(b.name);
      case "runCount":
        return (b.runCount ?? 0) - (a.runCount ?? 0);
      case "steps":
        return b.steps.length - a.steps.length;
      case "lastModified":
      default:
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    }
  });
}

export function sortPresetItems(presets: PipelinePreset[]): PipelinePreset[] {
  return [...presets].sort((a, b) => a.complexity - b.complexity);
}

export interface RecentRunEntry {
  listKey: string;
  pipelineId: string;
  pipelineName: string;
  runId: string;
  storeRunId?: string | null;
  runName: string;
  datasetName: string;
  status: string;
  createdAt: string;
  score?: number | null;
  scoreMetric?: string | null;
}

const LOWER_IS_BETTER = /rmse|mae|mse|loss|error/i;

export function scoreOf(chain: ChainSummary): number | null {
  return (
    chain.final_test_score ??
    chain.final_agg_test_score ??
    chain.cv_val_score ??
    chain.cv_test_score ??
    null
  );
}

export function pickBestChain(chains: ChainSummary[]): ChainSummary | null {
  if (!chains.length) return null;
  const scored = chains
    .map((c) => ({ chain: c, score: scoreOf(c) }))
    .filter((s): s is { chain: ChainSummary; score: number } => typeof s.score === "number");
  if (!scored.length) return chains[0];
  const metric = scored[0].chain.metric ?? "";
  const lowerIsBetter = LOWER_IS_BETTER.test(metric);
  scored.sort((a, b) => (lowerIsBetter ? a.score - b.score : b.score - a.score));
  return scored[0].chain;
}

export function extractRecentRuns(runs: Run[] | undefined, limit: number): RecentRunEntry[] {
  if (!runs?.length) return [];
  const flat: RecentRunEntry[] = [];
  const fallbackKeyCounts = new Map<string, number>();
  for (const run of runs) {
    const datasets = run.datasets ?? [];
    for (const ds of datasets) {
      for (const p of ds.pipelines ?? []) {
        const fallbackKeyBase = `${run.id}:${ds.dataset_name}:${p.pipeline_id}`;
        const fallbackKeyCount = fallbackKeyCounts.get(fallbackKeyBase) ?? 0;
        fallbackKeyCounts.set(fallbackKeyBase, fallbackKeyCount + 1);
        flat.push({
          listKey: p.id
            ? `${run.id}:${p.id}`
            : `${fallbackKeyBase}:${fallbackKeyCount}`,
          pipelineId: p.pipeline_id,
          pipelineName: p.pipeline_name || "Unknown pipeline",
          runId: run.id,
          storeRunId: run.store_run_id ?? null,
          runName: run.name,
          datasetName: ds.dataset_name,
          status: p.status,
          createdAt: run.started_at || run.created_at,
          score: p.score ?? null,
          scoreMetric: p.score_metric ?? null,
        });
      }
    }
  }
  flat.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return flat.slice(0, limit);
}

export function filterRecentRuns(runs: RecentRunEntry[], query: string): RecentRunEntry[] {
  if (!query) return runs;
  return runs.filter(
    (r) =>
      r.pipelineName.toLowerCase().includes(query) ||
      r.datasetName.toLowerCase().includes(query) ||
      r.runName.toLowerCase().includes(query)
  );
}

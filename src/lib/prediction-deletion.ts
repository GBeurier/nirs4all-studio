import type { QueryClient } from "@tanstack/react-query";

import type { PredictionDeletionReport } from "@/types/storage";

export async function invalidatePredictionRelatedQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({
    predicate: (query) => {
      const head = query.queryKey[0];
      return typeof head === "string" && (
        head === "runs" ||
        head === "enriched-runs" ||
        head === "results-summary" ||
        head === "workspaces" ||
        head === "workspace-prediction-records" ||
        head === "dataset-all-chains" ||
        head === "all-chains" ||
        head === "chain-partition-detail" ||
        head === "chain-fold-scores" ||
        head === "score-distribution" ||
        head === "available-models" ||
        head === "aggregated-predictions" ||
        head === "aggregated-predictions-leaderboard"
      );
    },
  });
}

export function formatPredictionDeletionSummary(result: PredictionDeletionReport): string {
  const parts = [`${result.deleted_predictions} prediction${result.deleted_predictions === 1 ? "" : "s"} deleted`];

  if (result.deleted_chains > 0) {
    parts.push(`${result.deleted_chains} chain${result.deleted_chains === 1 ? "" : "s"} pruned`);
  }
  if (result.deleted_pipelines > 0) {
    parts.push(`${result.deleted_pipelines} pipeline${result.deleted_pipelines === 1 ? "" : "s"} pruned`);
  }
  if (result.deleted_artifacts > 0) {
    parts.push(`${result.deleted_artifacts} artifact file${result.deleted_artifacts === 1 ? "" : "s"} removed`);
  }

  return parts.join(" · ");
}

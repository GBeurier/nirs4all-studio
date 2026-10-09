import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";

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
        head === "general-prediction-models" ||
        head === "aggregated-predictions" ||
        head === "aggregated-predictions-leaderboard"
      );
    },
  });
}

export function formatPredictionDeletionSummary(result: PredictionDeletionReport, t: TFunction): string {
  const parts = [t("results.scores.delete.summary.predictions", { count: result.deleted_predictions })];

  if (result.deleted_chains > 0) {
    parts.push(t("results.scores.delete.summary.chains", { count: result.deleted_chains }));
  }
  if (result.deleted_pipelines > 0) {
    parts.push(t("results.scores.delete.summary.pipelines", { count: result.deleted_pipelines }));
  }
  if (result.deleted_artifacts > 0) {
    parts.push(t("results.scores.delete.summary.artifacts", { count: result.deleted_artifacts }));
  }

  return parts.join(" · ");
}

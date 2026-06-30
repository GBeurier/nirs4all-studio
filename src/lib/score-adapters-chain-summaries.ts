import type { ScoreCardRow } from "@/types/score-cards";
import type { ChainSummary } from "@/types/aggregated-predictions";
import { safeNumber } from "@/lib/fold-utils";
import { buildFoldModelArtifactRefs } from "@/lib/resultArtifacts";
import { extractNestedScores } from "@/lib/score-adapters-fold-scores";
import { projectFinalScoreMaps } from "@/lib/score-adapters-score-maps";
import { scoreSourceVariantKey } from "@/lib/score-adapters-signatures";

function summarySignature(summary: Pick<ChainSummary, "model_class" | "model_name" | "preprocessings" | "best_params">): string {
  return scoreSourceVariantKey(summary, summary.best_params);
}

export function collapseStandaloneRefitSummaries(summaries: ChainSummary[]): ChainSummary[] {
  const standaloneSignatures = new Set(
    summaries
      .filter(summary => summary.is_refit_only && summary.final_test_score != null)
      .map(summary => summarySignature(summary)),
  );

  return summaries.flatMap((summary) => {
    const signature = summarySignature(summary);
    if (summary.final_test_score == null && standaloneSignatures.has(signature)) {
      return [];
    }
    if (!summary.is_refit_only) {
      return [summary];
    }
    return [{
      ...summary,
      cv_val_score: null,
      cv_test_score: null,
      cv_train_score: null,
      cv_fold_count: 0,
      cv_scores: null,
    }];
  });
}

/**
 * Maps a ChainSummary (from aggregated-predictions) into a ScoreCardRow.
 *
 * If the chain has a final score -> REFIT_CARD with a CROSSVAL child pre-attached.
 * Otherwise -> CROSSVAL_CARD. TRAIN children are loaded lazily.
 */
export function chainSummaryToRow(summary: ChainSummary): ScoreCardRow {
  const hasFinal = summary.final_test_score != null
    || summary.final_train_score != null
    || !!summary.final_scores;
  const hasCv = !summary.is_refit_only && (summary.cv_val_score != null || summary.cv_fold_count > 0);
  const cvValScores = extractNestedScores(summary.cv_scores, "val");
  const cvTestScores = extractNestedScores(summary.cv_scores, "test");
  const finalScoreSource = summary.final_scores as Record<string, unknown> | null | undefined;
  const aggregatedScoreSource = summary.final_agg_scores as Record<string, unknown> | null | undefined;
  const artifactRefs = buildFoldModelArtifactRefs(summary.fold_artifacts, {
    runId: summary.run_id,
    pipelineId: summary.pipeline_id,
    chainId: summary.chain_id,
    datasetName: summary.dataset_name,
    metric: summary.metric,
  });
  const { testScores: finalTestScores, trainScores: finalTrainScores } = projectFinalScoreMaps(
    finalScoreSource,
    cvValScores,
    cvTestScores,
    aggregatedScoreSource,
  );

  const crossvalRow: ScoreCardRow = {
    id: `cv-${summary.cv_source_chain_id ?? summary.chain_id}`,
    chainId: summary.cv_source_chain_id ?? summary.chain_id,
    runId: summary.run_id,
    pipelineId: summary.pipeline_id,
    datasetName: summary.dataset_name ?? undefined,
    modelName: summary.model_name || "",
    modelClass: summary.model_class,
    preprocessings: summary.preprocessings || null,
    bestParams: (summary.best_params as Record<string, unknown>) ?? null,
    cardType: "crossval",
    foldCount: summary.cv_fold_count,
    metric: summary.metric,
    taskType: summary.task_type,
    testScores: cvTestScores,
    valScores: cvValScores,
    trainScores: {},
    avgValScores: cvValScores,
    avgTestScores: cvTestScores,
    primaryTestScore: safeNumber(summary.cv_test_score),
    primaryValScore: safeNumber(summary.cv_val_score),
    primaryTrainScore: safeNumber(summary.cv_train_score),
    foldArtifacts: summary.fold_artifacts,
    artifactRefs,
    hasRefitArtifact: false,
  };

  if (hasFinal) {
    const { testScores: aggregatedTestScores, trainScores: aggregatedTrainScores } = projectFinalScoreMaps(
      aggregatedScoreSource,
      cvValScores,
      cvTestScores,
      finalScoreSource,
    );
    const hasAgg = aggregatedScoreSource != null || summary.final_agg_test_score != null;

    return {
      id: summary.chain_id,
      chainId: summary.chain_id,
      runId: summary.run_id,
      pipelineId: summary.pipeline_id,
      datasetName: summary.dataset_name ?? undefined,
      modelName: summary.model_name || "",
      modelClass: summary.model_class,
      preprocessings: summary.preprocessings || null,
      bestParams: (summary.best_params as Record<string, unknown>) ?? null,
      cardType: "refit",
      foldId: "final",
      foldCount: summary.is_refit_only ? 0 : summary.cv_fold_count,
      metric: summary.metric,
      taskType: summary.task_type,
      testScores: finalTestScores,
      valScores: {},
      trainScores: finalTrainScores,
      avgValScores: summary.is_refit_only ? {} : cvValScores,
      avgTestScores: summary.is_refit_only ? {} : cvTestScores,
      primaryTestScore: safeNumber(summary.final_test_score),
      primaryValScore: summary.is_refit_only ? null : safeNumber(summary.cv_val_score),
      primaryTrainScore: safeNumber(summary.final_train_score),
      foldArtifacts: summary.fold_artifacts,
      artifactRefs,
      hasRefitArtifact: !summary.synthetic_refit,
      aggregatedTestScores: hasAgg ? aggregatedTestScores : undefined,
      aggregatedTrainScores: hasAgg ? aggregatedTrainScores : undefined,
      primaryAggTestScore: hasAgg ? safeNumber(summary.final_agg_test_score) : undefined,
      primaryAggTrainScore: hasAgg ? safeNumber(summary.final_agg_train_score) : undefined,
      children: hasCv ? [crossvalRow] : [],
    };
  }

  return crossvalRow;
}

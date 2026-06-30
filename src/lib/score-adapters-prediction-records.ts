import type { ScoreCardRow } from "@/types/score-cards";
import type { PredictionRecord } from "@/types/linked-workspaces";
import { safeNumber, scoreCardTypeForFoldId } from "@/lib/fold-utils";
import { buildPredictionRecordModelArtifactRefs } from "@/lib/resultArtifacts";
import { parseJsonRecord } from "@/ui/score";
import { projectPartitionScoreMaps } from "@/lib/score-adapters-fold-scores";

export function predictionRecordBestParams(pred: Pick<PredictionRecord, "best_params">): Record<string, unknown> | null {
  const parsed = parseJsonRecord(pred.best_params);
  return parsed && Object.keys(parsed).length > 0 ? parsed : null;
}

function predictionRecordScores(pred: Pick<PredictionRecord, "scores">): Record<string, unknown> | null {
  return parseJsonRecord(pred.scores);
}

/**
 * Maps a PredictionRecord (from parquet per-fold data) to a ScoreCardRow.
 * Always produces a leaf row for the predictions table.
 */
export function predictionRecordToRow(pred: PredictionRecord): ScoreCardRow {
  const scoresObj = predictionRecordScores(pred);
  const { valScores, testScores, trainScores } = projectPartitionScoreMaps(scoresObj, pred.partition);
  const foldId = pred.fold_id;

  return {
    id: pred.id,
    chainId: pred.trace_id || pred.id,
    datasetName: pred.source_dataset || pred.dataset_name,
    modelName: pred.model_name,
    modelClass: pred.model_classname || "",
    preprocessings: pred.preprocessings || null,
    bestParams: predictionRecordBestParams(pred),
    cardType: scoreCardTypeForFoldId(foldId),
    foldId,
    partition: pred.partition,
    nSamplesEval: pred.n_samples,
    metric: pred.metric || null,
    taskType: pred.task_type || null,
    testScores,
    valScores,
    trainScores,
    primaryTestScore: safeNumber(pred.test_score),
    primaryValScore: safeNumber(pred.val_score),
    primaryTrainScore: safeNumber(pred.train_score),
    artifactRefs: buildPredictionRecordModelArtifactRefs(pred),
    hasRefitArtifact: foldId === "final" && !!pred.model_artifact_id,
  };
}

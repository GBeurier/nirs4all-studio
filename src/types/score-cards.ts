/**
 * Unified score card types for the 3 card types: TRAIN, CROSSVAL, REFIT.
 * Used across History (Runs), Results, and Predictions pages.
 */

/** The three card types that determine column layout and labeling. */
export type ScoreCardType = "train" | "crossval" | "refit";

/**
 * A normalized row that any score source (TopChainResult, ChainSummary,
 * PartitionPrediction, PredictionRecord) can be mapped into.
 */
export interface ScoreCardRow {
  // Identity
  id: string;
  chainId: string;
  runId?: string;
  pipelineId?: string;
  datasetName?: string;

  // Model info
  modelName: string;
  modelClass: string;
  preprocessings: string | null;
  bestParams: Record<string, unknown> | null;

  // Row type & context
  cardType: ScoreCardType;
  foldId?: string;           // "final", "avg", "w_avg", "0", "1", etc.
  partition?: string;        // "val", "test", "train"
  nSamplesTrain?: number | null;
  nSamplesEval?: number | null;
  foldCount?: number;
  metric: string | null;
  taskType?: string | null;

  // Score maps by partition (keyed by metric name, e.g. {rmse: 0.32, r2: 0.95})
  testScores: Record<string, number | null>;
  valScores: Record<string, number | null>;
  trainScores: Record<string, number | null>;

  // Aggregation scores (crossval card only)
  avgValScores?: Record<string, number | null>;
  avgTestScores?: Record<string, number | null>;
  wAvgTestScores?: Record<string, number | null>;
  meanValScores?: Record<string, number | null>;
  meanTestScores?: Record<string, number | null>;
  minValScores?: Record<string, number | null>;
  maxValScores?: Record<string, number | null>;
  minTestScores?: Record<string, number | null>;
  maxTestScores?: Record<string, number | null>;

  // Primary metric scalar fallbacks
  primaryTestScore: number | null;
  primaryValScore: number | null;
  primaryTrainScore: number | null;

  // Artifact availability
  foldArtifacts?: Record<string, string> | null;
  hasRefitArtifact: boolean;

  // Hierarchy: children for expandable rows
  children?: ScoreCardRow[];
}

import { isLowerBetter } from "@/lib/scores";
import type { InspectorChainSummary, ScoreColumn } from "@/types/inspector";

export interface InspectorScoreStats {
  min: number;
  max: number;
  mean: number;
}

interface ScoreObject {
  value?: unknown;
  score?: unknown;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeScoreValue(value: unknown): number | null {
  if (isFiniteNumber(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const scoreObject = value as ScoreObject;
  if (isFiniteNumber(scoreObject.value)) return scoreObject.value;
  if (isFiniteNumber(scoreObject.score)) return scoreObject.score;
  return null;
}

export function getInspectorFiniteScore(
  chain: InspectorChainSummary,
  scoreColumn: ScoreColumn,
): number | null {
  return normalizeScoreValue((chain as Record<ScoreColumn, unknown>)[scoreColumn]);
}

export function getInspectorScoreValues(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): number[] {
  return chains
    .map((chain) => getInspectorFiniteScore(chain, scoreColumn))
    .filter((score): score is number => score != null);
}

export function getInspectorMetric(chains: readonly InspectorChainSummary[]): string | null {
  return chains.find((chain) => chain.metric)?.metric ?? null;
}

export function isInspectorLowerBetter(
  chains: readonly InspectorChainSummary[],
  metric = getInspectorMetric(chains),
): boolean {
  return isLowerBetter(metric);
}

export function compareInspectorScoreValues(
  leftScore: number,
  rightScore: number,
  lowerBetter: boolean,
): number {
  return lowerBetter ? leftScore - rightScore : rightScore - leftScore;
}

export function compareInspectorChainsByScore(
  left: InspectorChainSummary,
  right: InspectorChainSummary,
  scoreColumn: ScoreColumn,
  lowerBetter: boolean,
  tieBreaker: "none" | "chain_id" = "none",
): number {
  const leftScore = getInspectorFiniteScore(left, scoreColumn);
  const rightScore = getInspectorFiniteScore(right, scoreColumn);
  if (leftScore == null && rightScore == null) return tieBreaker === "chain_id" ? left.chain_id.localeCompare(right.chain_id) : 0;
  if (leftScore == null) return 1;
  if (rightScore == null) return -1;
  const scoreComparison = compareInspectorScoreValues(leftScore, rightScore, lowerBetter);
  if (scoreComparison !== 0 || tieBreaker !== "chain_id") return scoreComparison;
  return left.chain_id.localeCompare(right.chain_id);
}

export function sortInspectorChainsByScore(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  options: {
    metric?: string | null;
    lowerBetter?: boolean;
    tieBreaker?: "none" | "chain_id";
  } = {},
): InspectorChainSummary[] {
  const lowerBetter = options.lowerBetter ?? isInspectorLowerBetter(chains, options.metric);
  return [...chains].sort((left, right) => (
    compareInspectorChainsByScore(left, right, scoreColumn, lowerBetter, options.tieBreaker)
  ));
}

export function computeInspectorScoreStats(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): InspectorScoreStats | null {
  const scores = getInspectorScoreValues(chains, scoreColumn);
  if (scores.length === 0) return null;

  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (const score of scores) {
    if (score < min) min = score;
    if (score > max) max = score;
    sum += score;
  }
  return { min, max, mean: sum / scores.length };
}

export function isInspectorScoreInRange(
  chain: InspectorChainSummary,
  scoreColumn: ScoreColumn,
  min: number,
  max: number,
): boolean {
  const score = getInspectorFiniteScore(chain, scoreColumn);
  return score != null && score >= min && score <= max;
}

export function computeInspectorOutlierChainIds(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
): Set<string> {
  const scoredChains = chains
    .map((chain) => ({ chainId: chain.chain_id, score: getInspectorFiniteScore(chain, scoreColumn) }))
    .filter((entry): entry is { chainId: string; score: number } => entry.score != null);

  if (scoredChains.length < 4) return new Set();

  const sortedScores = scoredChains.map((entry) => entry.score).sort((left, right) => left - right);
  const q25 = sortedScores[Math.floor(sortedScores.length * 0.25)];
  const q75 = sortedScores[Math.floor(sortedScores.length * 0.75)];
  const iqr = q75 - q25;
  const lower = q25 - 1.5 * iqr;
  const upper = q75 + 1.5 * iqr;

  return new Set(
    scoredChains
      .filter((entry) => entry.score < lower || entry.score > upper)
      .map((entry) => entry.chainId),
  );
}

import { getInspectorFiniteScore } from "@/lib/inspector/scoreAccess";
import type {
  HistogramResponse,
  InspectorChainSummary,
  ScoreColumn,
} from "@/types/inspector";

/**
 * Build a score-distribution histogram for a set of inspector chains.
 *
 * Pure/stable binning logic: chains without a finite score for `scoreColumn`
 * are dropped, the remaining scores are split into equal-width bins, and each
 * bin keeps the contributing chain ids. Degenerate inputs (no scored chains, or
 * a single distinct score) are handled explicitly so the result always matches
 * the {@link HistogramResponse} contract.
 */
export function buildHistogramData(
  chains: readonly InspectorChainSummary[],
  scoreColumn: ScoreColumn,
  nBins = 12,
): HistogramResponse {
  const scored = chains
    .map(chain => ({
      chainId: chain.chain_id,
      score: getInspectorFiniteScore(chain, scoreColumn),
    }))
    .filter((entry): entry is { chainId: string; score: number } => entry.score != null);

  if (scored.length === 0) {
    return {
      bins: [],
      score_column: scoreColumn,
      total_chains: 0,
      min_score: null,
      max_score: null,
      mean_score: null,
    };
  }

  const scores = scored.map(entry => entry.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const meanScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

  if (minScore === maxScore) {
    return {
      bins: [{
        bin_start: minScore,
        bin_end: maxScore,
        count: scored.length,
        chain_ids: scored.map(entry => entry.chainId),
      }],
      score_column: scoreColumn,
      total_chains: scored.length,
      min_score: minScore,
      max_score: maxScore,
      mean_score: meanScore,
    };
  }

  const binCount = Math.max(5, Math.min(nBins, scored.length));
  const binWidth = (maxScore - minScore) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    bin_start: minScore + index * binWidth,
    bin_end: index === binCount - 1 ? maxScore : minScore + (index + 1) * binWidth,
    count: 0,
    chain_ids: [] as string[],
  }));

  for (const entry of scored) {
    const rawIndex = Math.floor((entry.score - minScore) / binWidth);
    const index = Math.min(binCount - 1, Math.max(0, rawIndex));
    bins[index].count += 1;
    bins[index].chain_ids.push(entry.chainId);
  }

  return {
    bins,
    score_column: scoreColumn,
    total_chains: scored.length,
    min_score: minScore,
    max_score: maxScore,
    mean_score: meanScore,
  };
}

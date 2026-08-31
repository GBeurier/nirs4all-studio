/**
 * Score normalization — turn raw scored chains into a comparable "goodness".
 *
 * Pure, framework-free. This is the *descriptive* normalizer: the same
 * view-model tier as `viz/geometry`. The authoritative, lineage-tracked
 * normalization is a `dag-ml` coordination concern; when its artifact is
 * available the goodness is read from it verbatim ({@link file://./contract.ts})
 * and this module is bypassed.
 */

import { mean, stdDev } from "../viz/geometry.js";
import type { ChainMetric, ChainPoint, ChainStep, ChainTokenRef, ScoredChain, ScoreLens } from "./types.js";
import { coerceChainRole } from "./types.js";

/** Orient a score so higher is always better. */
export function orientedValue(score: number, lowerIsBetter: boolean): number {
  return lowerIsBetter ? -score : score;
}

/**
 * Percentile rank of each value within the list, in `[0, 1]` (1 = largest).
 * Ties share their averaged rank. A single value maps to `0.5`.
 */
export function percentileRanks(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [0.5];
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && order[j + 1]!.value === order[i]!.value) j += 1;
    const averaged = (i + j) / 2 / (n - 1);
    for (let k = i; k <= j; k += 1) ranks[order[k]!.index] = averaged;
    i = j + 1;
  }
  return ranks;
}

/** Sample z-score of each value (mean 0, unit sd); a zero-spread list → all 0. */
export function zScores(values: readonly number[]): number[] {
  if (values.length === 0) return [];
  const mu = mean(values);
  const sd = stdDev(values);
  if (!Number.isFinite(sd) || sd === 0) return values.map(() => 0);
  return values.map((value) => (value - mu) / sd);
}

/** First-occurrence-ordered, deduped token references for a step list. */
export function dedupeOrderedTokens(steps: readonly ChainStep[]): ChainTokenRef[] {
  const seen = new Set<string>();
  const out: ChainTokenRef[] = [];
  for (const step of steps) {
    if (seen.has(step.token)) continue;
    seen.add(step.token);
    out.push({ token: step.token, label: step.label ?? step.token, role: coerceChainRole(step.role) });
  }
  return out;
}

/**
 * Project scored chains to comparable {@link ChainPoint}s under a lens.
 * Chains with a non-finite score should be filtered out by the caller.
 */
export function computeChainPoints(
  chains: readonly ScoredChain[],
  metric: ChainMetric,
  lens: ScoreLens,
): ChainPoint[] {
  const oriented = chains.map((chain) => orientedValue(chain.score, metric.lowerIsBetter));
  const goodness = new Array<number>(chains.length);

  if (lens === "raw") {
    for (let i = 0; i < chains.length; i += 1) goodness[i] = oriented[i]!;
  } else {
    const groups = new Map<string, number[]>();
    chains.forEach((chain, index) => {
      const key = chain.dataset ?? "∗";
      const bucket = groups.get(key);
      if (bucket) bucket.push(index);
      else groups.set(key, [index]);
    });
    for (const indices of groups.values()) {
      const values = indices.map((index) => oriented[index]!);
      const transformed = lens === "rankByDataset" ? percentileRanks(values) : zScores(values);
      indices.forEach((index, k) => {
        goodness[index] = transformed[k]!;
      });
    }
  }

  return chains.map((chain, index) => {
    const ordered = dedupeOrderedTokens(chain.steps);
    return {
      id: chain.id,
      score: chain.score,
      goodness: goodness[index]!,
      dataset: chain.dataset ?? "∗",
      source: chain.source ?? "∗",
      tokens: ordered.map((token) => token.token),
      orderedTokens: ordered,
    };
  });
}

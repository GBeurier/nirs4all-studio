/**
 * Chain matching, dedupe and ordering helpers for TopChainResult → ScoreCardRow.
 *
 * This module owns the "which chains are the same variant, which CV chain feeds
 * which refit, and in what order do rows appear" responsibility used by
 * `datasetChainsToRows`. It only inspects stable identity/signature fields and
 * comparable scores — it never builds rows itself.
 */

import type { ScoreCardRow } from "@/types/score-cards";
import type { TopChainResult } from "@/types/enriched-runs";
import { isLowerBetter } from "@/lib/scores";
import { safeNumber } from "@/lib/fold-utils";
import {
  scoreSourceDisplayKey,
  scoreSourceSignatureParts,
  scoreSourceVariantKey,
} from "@/lib/score-adapters-signatures";

export function displayParams(chain: TopChainResult | null | undefined): Record<string, unknown> | null {
  if (!chain) return null;
  return (chain.variant_params ?? chain.best_params ?? null) as Record<string, unknown> | null;
}

function compareNullableScores(
  a: number | null | undefined,
  b: number | null | undefined,
  lowerBetter: boolean,
): number {
  const aScore = safeNumber(a);
  const bScore = safeNumber(b);
  if (aScore == null && bScore == null) return 0;
  if (aScore == null) return 1;
  if (bScore == null) return -1;
  if (aScore === bScore) return 0;
  return lowerBetter ? aScore - bScore : bScore - aScore;
}

export function compareRefitChains(a: TopChainResult, b: TopChainResult, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byFinal = compareNullableScores(a.final_test_score, b.final_test_score, lowerBetter);
  if (byFinal !== 0) return byFinal;
  const byCv = compareNullableScores(a.avg_val_score, b.avg_val_score, lowerBetter);
  if (byCv !== 0) return byCv;
  return a.chain_id.localeCompare(b.chain_id);
}

export function compareCvChains(a: TopChainResult, b: TopChainResult, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byVal = compareNullableScores(a.avg_val_score, b.avg_val_score, lowerBetter);
  if (byVal !== 0) return byVal;
  const byTest = compareNullableScores(a.avg_test_score, b.avg_test_score, lowerBetter);
  if (byTest !== 0) return byTest;
  return a.chain_id.localeCompare(b.chain_id);
}

export function compareRefitRows(a: ScoreCardRow, b: ScoreCardRow, metric: string | null): number {
  const lowerBetter = isLowerBetter(metric);
  const byTest = compareNullableScores(a.primaryTestScore, b.primaryTestScore, lowerBetter);
  if (byTest !== 0) return byTest;
  const byTrain = compareNullableScores(a.primaryTrainScore, b.primaryTrainScore, lowerBetter);
  if (byTrain !== 0) return byTrain;
  const byModel = a.modelName.localeCompare(b.modelName);
  if (byModel !== 0) return byModel;
  const byChain = a.chainId.localeCompare(b.chainId);
  if (byChain !== 0) return byChain;
  return (a.foldId ?? "").localeCompare(b.foldId ?? "");
}

function signatureParts(chain: TopChainResult) {
  return scoreSourceSignatureParts(chain, displayParams(chain));
}

function signaturePartsExactlyMatch(a: TopChainResult, b: TopChainResult): boolean {
  const aSig = signatureParts(a);
  const bSig = signatureParts(b);
  return (
    aSig.modelClass === bSig.modelClass
    && aSig.modelName === bSig.modelName
    && aSig.preprocessings === bSig.preprocessings
    && aSig.bestParams === bSig.bestParams
  );
}

function variantKey(chain: TopChainResult): string {
  return scoreSourceVariantKey(chain, displayParams(chain));
}

export function displayVariantKey(chain: TopChainResult): string {
  return scoreSourceDisplayKey(chain);
}

export function dedupeChainsByVariant(
  chains: TopChainResult[],
  compare: (a: TopChainResult, b: TopChainResult) => number,
): TopChainResult[] {
  const bestByVariant = new Map<string, TopChainResult>();

  for (const chain of chains) {
    const key = variantKey(chain);
    const current = bestByVariant.get(key);
    if (!current || compare(chain, current) < 0) {
      bestByVariant.set(key, chain);
    }
  }

  return [...bestByVariant.values()].sort(compare);
}

export function findMatchingCvSource(
  refitChain: TopChainResult,
  cvChains: TopChainResult[],
  usedChainIds: Set<string>,
  metric: string | null,
): TopChainResult | null {
  if (refitChain.cv_source_chain_id) {
    const explicitMatch = cvChains.find(chain => (
      chain.chain_id === refitChain.cv_source_chain_id
      && !usedChainIds.has(chain.chain_id)
    ));
    if (explicitMatch) return explicitMatch;
  }

  const refitSig = signatureParts(refitChain);
  const available = cvChains.filter(chain => !usedChainIds.has(chain.chain_id));
  const sameRunAvailable = refitChain.run_id
    ? available.filter(chain => chain.run_id === refitChain.run_id)
    : [];
  const searchPools = sameRunAvailable.length > 0 ? [sameRunAvailable, available] : [available];
  const matchers = [
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return (
        sig.modelClass === refitSig.modelClass
        && sig.modelName === refitSig.modelName
        && sig.preprocessings === refitSig.preprocessings
        && sig.bestParams === refitSig.bestParams
      );
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return (
        sig.modelClass === refitSig.modelClass
        && sig.modelName === refitSig.modelName
        && sig.preprocessings === refitSig.preprocessings
      );
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return sig.modelClass === refitSig.modelClass && sig.modelName === refitSig.modelName;
    },
    (chain: TopChainResult) => {
      const sig = signatureParts(chain);
      return sig.modelClass === refitSig.modelClass;
    },
  ];

  for (const pool of searchPools) {
    for (const matches of matchers) {
      const candidates = pool.filter(matches).sort((a, b) => compareCvChains(a, b, metric));
      if (candidates.length === 1) return candidates[0];
      if (candidates.length > 1) {
        const [bestCandidate] = candidates;
        if (bestCandidate && signatureParts(bestCandidate).preprocessings === refitSig.preprocessings) {
          return bestCandidate;
        }
      }
    }
  }

  return null;
}

export function findMatchingCvSourceExact(
  refitChain: TopChainResult,
  cvChains: TopChainResult[],
  usedChainIds: Set<string>,
  metric: string | null,
): TopChainResult | null {
  if (refitChain.cv_source_chain_id) {
    const explicitMatch = cvChains.find(chain => (
      chain.chain_id === refitChain.cv_source_chain_id
      && !usedChainIds.has(chain.chain_id)
    ));
    if (explicitMatch) return explicitMatch;
  }

  const available = cvChains.filter(chain => !usedChainIds.has(chain.chain_id));
  const sameRunAvailable = refitChain.run_id
    ? available.filter(chain => chain.run_id === refitChain.run_id)
    : [];
  for (const pool of (sameRunAvailable.length > 0 ? [sameRunAvailable, available] : [available])) {
    const candidates = pool
      .filter(chain => signaturePartsExactlyMatch(refitChain, chain))
      .sort((a, b) => compareCvChains(a, b, metric));
    if (candidates[0]) return candidates[0];
  }
  return null;
}

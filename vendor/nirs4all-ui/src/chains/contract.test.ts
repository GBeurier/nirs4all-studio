import { describe, expect, it } from "vitest";

import { fromScoredChains } from "./analysis.js";
import {
  CHAIN_EFFECT_SCHEMA_ID,
  isChainEffectAnalysisArtifact,
  parseChainEffectAnalysis,
  toChainEffectArtifact,
} from "./contract.js";
import type { ChainMetric, ScoredChain } from "./types.js";

const NRMSE: ChainMetric = { key: "nrmse", label: "nRMSE", lowerIsBetter: true };

const CHAINS: ScoredChain[] = [
  { id: "a", dataset: "d1", source: "nir", score: 0.10, steps: [{ token: "snv", label: "SNV", role: "preprocess" }, { token: "pls", label: "PLS", role: "model" }] },
  { id: "b", dataset: "d1", source: "nir", score: 0.20, steps: [{ token: "msc", label: "MSC", role: "preprocess" }, { token: "pls", label: "PLS", role: "model" }] },
];

describe("chain-effect contract", () => {
  it("round-trips a view-model through the wire artifact", () => {
    const analysis = fromScoredChains(CHAINS, { metric: NRMSE, lens: "rankByDataset" });
    const artifact = toChainEffectArtifact(analysis);

    expect(artifact.schema_id).toBe(CHAIN_EFFECT_SCHEMA_ID);
    expect(artifact.lens).toBe("rank_by_dataset");
    expect(artifact.metric.lower_is_better).toBe(true);
    expect(isChainEffectAnalysisArtifact(artifact)).toBe(true);

    const reparsed = parseChainEffectAnalysis(artifact);
    expect(reparsed.lens).toBe("rankByDataset");
    expect(reparsed.metric.lowerIsBetter).toBe(true);
    expect(reparsed.total).toBe(2);
    expect(reparsed.baseline).toBeCloseTo(analysis.baseline, 10);
    expect(reparsed.tokens.map((t) => t.token).sort()).toEqual(["msc", "pls", "snv"]);
  });

  it("trusts an authoritative goodness/baseline verbatim", () => {
    const artifact = {
      schema_id: CHAIN_EFFECT_SCHEMA_ID,
      schema_version: 1,
      metric: { key: "nrmse", label: "nRMSE", lower_is_better: true },
      lens: "rank_by_dataset" as const,
      baseline: 0.5,
      points: [
        { id: "a", score: 0.1, goodness: 0.9, dataset: "d1", source: null, ordered_tokens: [{ token: "snv", role: "preprocess" }] },
        { id: "b", score: 0.4, goodness: 0.1, dataset: "d1", source: null, ordered_tokens: [{ token: "msc", role: "preprocess" }] },
      ],
    };
    const analysis = parseChainEffectAnalysis(artifact);
    expect(analysis.baseline).toBe(0.5);
    expect(analysis.points.find((p) => p.id === "a")!.goodness).toBe(0.9);
    expect(analysis.points.find((p) => p.id === "a")!.source).toBe("∗");
  });

  it("rejects malformed artifacts", () => {
    expect(isChainEffectAnalysisArtifact({ schema_id: "x", points: [] })).toBe(false);
    expect(() => parseChainEffectAnalysis({ nope: true })).toThrow();
    expect(() =>
      parseChainEffectAnalysis({
        schema_id: CHAIN_EFFECT_SCHEMA_ID,
        schema_version: 1,
        metric: { key: "k", label: "l", lower_is_better: true },
        lens: "bogus",
        points: [],
      }),
    ).toThrow();
  });
});

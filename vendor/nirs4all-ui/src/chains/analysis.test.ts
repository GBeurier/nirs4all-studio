import { describe, expect, it } from "vitest";

import { buildAnalysis, fromScoredChains, nodeFlow, nodeNeighbors, positionMatrix, sequenceMatrix, stat, tokenContexts } from "./analysis.js";
import { computeChainPoints } from "./normalize.js";
import type { ChainMetric, FlowNode, ScoredChain } from "./types.js";

const NRMSE: ChainMetric = { key: "nrmse", label: "nRMSE", lowerIsBetter: true };

/** SNV consistently beats MSC on both datasets; PLS beats RF. */
function corpus(): ScoredChain[] {
  const chains: ScoredChain[] = [];
  const push = (id: string, dataset: string, pre: string, model: string, score: number) =>
    chains.push({
      id,
      dataset,
      score,
      steps: [
        { token: "split_kfold", role: "split" },
        { token: pre, role: "preprocess" },
        { token: model, role: "model" },
      ],
    });
  push("a", "wheat", "snv", "pls", 0.10);
  push("b", "wheat", "msc", "pls", 0.16);
  push("c", "wheat", "snv", "rf", 0.18);
  push("d", "wheat", "msc", "rf", 0.24);
  push("e", "soil", "snv", "pls", 2.0);
  push("f", "soil", "msc", "pls", 3.2);
  push("g", "soil", "snv", "rf", 3.6);
  push("h", "soil", "msc", "rf", 4.8);
  return chains;
}

describe("stat", () => {
  it("summarizes finite values and reports n", () => {
    const s = stat([1, 2, 3, 4]);
    expect(s.n).toBe(4);
    expect(s.median).toBeCloseTo(2.5, 6);
  });

  it("returns n=0 for an empty list", () => {
    expect(stat([]).n).toBe(0);
    expect(Number.isNaN(stat([]).median)).toBe(true);
  });
});

describe("buildAnalysis / fromScoredChains", () => {
  it("ranks helping tokens above hurting ones and computes with/without deltas", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    const snv = analysis.tokens.find((t) => t.token === "snv")!;
    const msc = analysis.tokens.find((t) => t.token === "msc")!;
    const pls = analysis.tokens.find((t) => t.token === "pls")!;

    expect(snv.delta).toBeGreaterThan(0); // SNV chains beat non-SNV (MSC) chains
    expect(msc.delta).toBeLessThan(0);
    expect(pls.delta).toBeGreaterThan(0);
    // sorted by delta desc → the top token is a helper, the last is a hurter
    expect(analysis.tokens[0]!.delta).toBeGreaterThanOrEqual(analysis.tokens[analysis.tokens.length - 1]!.delta || -Infinity);
    expect(snv.coverage).toBeCloseTo(0.5, 6);
  });

  it("exposes datasets, sources, roles and a baseline near the rank midpoint", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    expect(analysis.datasets).toEqual(["soil", "wheat"]);
    expect(analysis.roles).toContain("model");
    expect(analysis.total).toBe(8);
    expect(analysis.baseline).toBeGreaterThan(0.2);
    expect(analysis.baseline).toBeLessThan(0.8);
  });

  it("honors an authoritative baseline override", () => {
    const points = computeChainPoints(corpus(), NRMSE, "rankByDataset");
    const analysis = buildAnalysis(points, { metric: NRMSE, lens: "rankByDataset", baseline: 0.42 });
    expect(analysis.baseline).toBe(0.42);
  });
});

describe("positionMatrix", () => {
  it("buckets tokens by their position in the transform stack", () => {
    // two-preprocess chains: SNV first vs SNV second
    const chains: ScoredChain[] = [
      { id: "1", dataset: "d", score: 0.1, steps: [{ token: "snv", role: "preprocess" }, { token: "deriv", role: "preprocess" }, { token: "pls", role: "model" }] },
      { id: "2", dataset: "d", score: 0.2, steps: [{ token: "deriv", role: "preprocess" }, { token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] },
      { id: "3", dataset: "d", score: 0.15, steps: [{ token: "snv", role: "preprocess" }, { token: "deriv", role: "preprocess" }, { token: "pls", role: "model" }] },
      { id: "4", dataset: "d", score: 0.25, steps: [{ token: "deriv", role: "preprocess" }, { token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] },
    ];
    const analysis = fromScoredChains(chains, { metric: NRMSE, lens: "raw" });
    const matrix = positionMatrix(analysis, { mode: "absolute", maxAbsolute: 3, minCount: 1 });
    const snvRow = matrix.rows.find((r) => r.token === "snv")!;
    expect(matrix.buckets[0]!.label).toBe("1st");
    // SNV-first chains score better than SNV-second chains
    expect(snvRow.cells[0]!.median).toBeGreaterThan(snvRow.cells[1]!.median);
  });

  it("nulls cells below the min-count gate", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    const matrix = positionMatrix(analysis, { mode: "phase", minCount: 999 });
    expect(matrix.rows.every((row) => row.cells.every((cell) => cell === null))).toBe(true);
  });
});

describe("sequenceMatrix", () => {
  it("captures order — MSC after SNV vs SNV after MSC", () => {
    const chains: ScoredChain[] = [
      { id: "1", dataset: "d", score: 0.1, steps: [{ token: "snv", role: "preprocess" }, { token: "msc", role: "preprocess" }, { token: "pls", role: "model" }] },
      { id: "2", dataset: "d", score: 0.3, steps: [{ token: "msc", role: "preprocess" }, { token: "snv", role: "preprocess" }, { token: "pls", role: "model" }] },
    ];
    const analysis = fromScoredChains(chains, { metric: NRMSE, lens: "raw" });
    const matrix = sequenceMatrix(analysis, { minCount: 1 });
    const snvIdx = matrix.tokens.findIndex((t) => t.token === "snv");
    const mscIdx = matrix.tokens.findIndex((t) => t.token === "msc");
    // SNV→MSC (row snv, col msc) has better goodness than MSC→SNV
    expect(matrix.cells[snvIdx]![mscIdx]!.median).toBeGreaterThan(matrix.cells[mscIdx]![snvIdx]!.median);
    expect(matrix.cells[snvIdx]![snvIdx]).toBeNull();
  });
});

describe("nodeNeighbors", () => {
  it("orbits the co-occurring nodes of a focus, scored by shared-chain goodness", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    const orbit = nodeNeighbors(analysis, "snv", { minCount: 1 })!;
    expect(orbit.token).toBe("snv");
    const tokens = orbit.neighbors.map((n) => n.token);
    expect(tokens).toContain("pls");
    expect(tokens).toContain("rf");
    expect(tokens).toContain("split_kfold");
    const pls = orbit.neighbors.find((n) => n.token === "pls")!;
    const rf = orbit.neighbors.find((n) => n.token === "rf")!;
    // SNV+PLS chains beat SNV+RF chains
    expect(pls.stat.median).toBeGreaterThan(rf.stat.median);
    expect(orbit.self.n).toBeGreaterThan(0);
    expect(nodeNeighbors(analysis, "does-not-exist")).toBeNull();
  });

  it("folds neighbours beyond the cap into an others tally", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    const orbit = nodeNeighbors(analysis, "snv", { minCount: 1, maxNeighbors: 1 })!;
    expect(orbit.neighbors.length).toBe(1);
    expect(orbit.otherCount).toBeGreaterThan(0);
    expect(orbit.otherWeight).toBeGreaterThan(0);
  });
});

describe("nodeFlow", () => {
  it("splits a focus into predecessors (inner) and an ordered successor tree (outer)", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    // corpus chains are split_kfold → {snv|msc} → {pls|rf}; focus on the preprocess node
    const flow = nodeFlow(analysis, "snv", { minCount: 1, depth: 2 })!;
    expect(flow.token).toBe("snv");
    // split_kfold precedes snv
    expect(flow.predecessors.map((p) => p.token)).toContain("split_kfold");
    // models follow snv → appear in the successor tree, and NOT among predecessors
    const succTokens = flow.successors.map((s) => s.token);
    expect(succTokens).toContain("pls");
    expect(succTokens).toContain("rf");
    expect(flow.predecessors.map((p) => p.token)).not.toContain("pls");
    // depth is bounded
    const treeDepth = (nodes: typeof flow.successors): number =>
      nodes.length ? 1 + Math.max(...nodes.map((n) => treeDepth(n.children))) : 0;
    expect(treeDepth(flow.successors)).toBeLessThanOrEqual(2);
    expect(nodeFlow(analysis, "unknown")).toBeNull();
  });

  it("roots on the whole ordered path — a used node never reappears (no loops)", () => {
    const pre = (token: string) => ({ token, role: "preprocess" as const });
    const model = (token: string) => ({ token, role: "model" as const });
    const chains: ScoredChain[] = [
      { id: "1", dataset: "d", score: 0.10, steps: [pre("snv"), pre("sg1"), model("pls")] },
      { id: "2", dataset: "d", score: 0.20, steps: [pre("snv"), pre("msc"), model("pls")] },
      { id: "3", dataset: "d", score: 0.15, steps: [pre("msc"), pre("snv"), model("rf")] },
    ];
    const a = fromScoredChains(chains, { metric: NRMSE, lens: "raw" });
    // directly after SNV: sg1 (chain 1), msc (chain 2), rf (chain 3)
    const one = nodeFlow(a, "snv", { minCount: 1 })!;
    expect(one.successors.map((n) => n.token).sort()).toEqual(["msc", "rf", "sg1"]);
    // the ORDERED path [snv, sg1] matches only chain 1 → next is pls; snv/sg1 cannot recur
    const two = nodeFlow(a, ["snv", "sg1"], { minCount: 1 })!;
    const tokens = new Set<string>();
    const collect = (nodes: readonly FlowNode[]) => nodes.forEach((n) => { tokens.add(n.token); collect(n.children); });
    collect(two.successors);
    expect(tokens.has("pls")).toBe(true);
    expect(tokens.has("snv")).toBe(false);
    expect(tokens.has("sg1")).toBe(false);
    expect(two.self.n).toBe(1);
  });
});

describe("tokenContexts", () => {
  it("ranks neighbours of a focus token by median goodness", () => {
    const analysis = fromScoredChains(corpus(), { metric: NRMSE, lens: "rankByDataset" });
    const contexts = tokenContexts(analysis, "pls", { roles: ["preprocess"], minCount: 1 });
    // SNV before PLS should out-rank MSC before PLS
    const snv = contexts.predecessors.find((r) => r.token === "snv");
    const msc = contexts.predecessors.find((r) => r.token === "msc");
    expect(snv && msc).toBeTruthy();
    expect(snv!.stat.median).toBeGreaterThan(msc!.stat.median);
  });
});

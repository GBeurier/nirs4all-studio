/**
 * Chain-effect analysis — descriptive aggregation over comparable chains.
 *
 * Pure, framework-free. Given {@link ChainPoint}s (goodness already computed by
 * a lens, whether descriptive or authoritative), this derives the per-token
 * effects, the position matrix (early / mid / late, 1st vs 2nd …), the
 * predecessor × successor sequence matrix ("MSC after SNV?"), and per-token
 * neighbour contexts. Every aggregate is a robust median/IQR over goodness and
 * is gated by a minimum sample count so noise is not over-read.
 */

import { extentOf, fiveNumberSummary, quantileSorted } from "../viz/geometry.js";
import { computeChainPoints } from "./normalize.js";
import type {
  ChainEffectAnalysis,
  ChainMetric,
  ChainPoint,
  ChainStepRole,
  ChainTokenRef,
  ContextRow,
  FlowNode,
  NeighborLink,
  NodeFlow,
  NodeNeighborhood,
  PositionBucket,
  PositionMatrix,
  PositionMode,
  PositionRow,
  ScoredChain,
  ScoreLens,
  SequenceMatrix,
  Stat,
  TokenContexts,
  TokenEffect,
} from "./types.js";
import { CHAIN_ROLE_ORDER, CHAIN_TRANSFORM_ROLES } from "./types.js";

const EMPTY_STAT: Stat = { n: 0, min: NaN, q1: NaN, median: NaN, q3: NaN, max: NaN, mean: NaN };

/** Five-number summary + `n` of the finite values (empty → `n = 0`). */
export function stat(values: readonly number[]): Stat {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return { ...EMPTY_STAT };
  return { n: finite.length, ...fiveNumberSummary(finite) };
}

function medianOf(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  return quantileSorted(finite, 0.5);
}

function uniqueRolesInOrder(points: readonly ChainPoint[]): ChainStepRole[] {
  const present = new Set<ChainStepRole>();
  for (const point of points) for (const token of point.orderedTokens) present.add(token.role);
  return CHAIN_ROLE_ORDER.filter((role) => present.has(role));
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export interface BuildAnalysisMeta {
  metric: ChainMetric;
  lens: ScoreLens;
  /** Reference goodness; defaults to the global median (authoritative override). */
  baseline?: number | undefined;
}

/** Assemble a full {@link ChainEffectAnalysis} from pre-normalized points. */
export function buildAnalysis(points: readonly ChainPoint[], meta: BuildAnalysisMeta): ChainEffectAnalysis {
  const goodness = points.map((point) => point.goodness);
  const baseline = Number.isFinite(meta.baseline as number) ? (meta.baseline as number) : medianOf(goodness);
  const total = points.length;

  const catalog = new Map<string, ChainTokenRef>();
  for (const point of points) {
    for (const token of point.orderedTokens) {
      if (!catalog.has(token.token)) catalog.set(token.token, token);
    }
  }

  const tokens: TokenEffect[] = [];
  for (const [token, ref] of catalog) {
    const withValues: number[] = [];
    const withoutValues: number[] = [];
    for (const point of points) {
      (point.tokens.includes(token) ? withValues : withoutValues).push(point.goodness);
    }
    const withStat = stat(withValues);
    const withoutStat = stat(withoutValues);
    const delta = withStat.n > 0 && withoutStat.n > 0 ? withStat.median - withoutStat.median : NaN;
    tokens.push({
      token,
      label: ref.label,
      role: ref.role,
      n: withStat.n,
      coverage: total > 0 ? withStat.n / total : 0,
      with: withStat,
      without: withoutStat,
      delta,
    });
  }

  tokens.sort((a, b) => {
    const av = Number.isFinite(a.delta);
    const bv = Number.isFinite(b.delta);
    if (av !== bv) return av ? -1 : 1;
    if (av && bv && a.delta !== b.delta) return b.delta - a.delta;
    return b.coverage - a.coverage;
  });

  return {
    lens: meta.lens,
    metric: meta.metric,
    total,
    datasets: uniqueSorted(points.map((point) => point.dataset)),
    sources: uniqueSorted(points.map((point) => point.source)),
    roles: uniqueRolesInOrder(points),
    baseline,
    goodnessExtent: extentOf(goodness),
    points: points.slice(),
    tokens,
  };
}

/**
 * Descriptive analysis straight from raw scored chains — the non-authoritative
 * fallback used until `dag-ml` emits the native artifact. Drops chains whose
 * score is non-finite (boundary validation).
 */
export function fromScoredChains(
  chains: readonly ScoredChain[],
  options: { metric: ChainMetric; lens: ScoreLens },
): ChainEffectAnalysis {
  const valid = chains.filter((chain) => Number.isFinite(chain.score));
  const points = computeChainPoints(valid, options.metric, options.lens);
  return buildAnalysis(points, { metric: options.metric, lens: options.lens });
}

// --- position -------------------------------------------------------------

const PHASE_BUCKETS: readonly PositionBucket[] = [
  { key: "early", label: "Early" },
  { key: "mid", label: "Mid" },
  { key: "late", label: "Late" },
];

function ordinalLabel(index1: number): string {
  const suffixes = ["th", "st", "nd", "rd"];
  const mod100 = index1 % 100;
  const suffix = suffixes[(mod100 - 20) % 10] ?? suffixes[mod100] ?? suffixes[0];
  return `${index1}${suffix}`;
}

function absoluteBuckets(max: number): PositionBucket[] {
  const buckets: PositionBucket[] = [];
  for (let i = 1; i < max; i += 1) buckets.push({ key: `p${i}`, label: ordinalLabel(i) });
  buckets.push({ key: `p${max}+`, label: `${ordinalLabel(max)}+` });
  return buckets;
}

function phaseIndex(idx: number, length: number): number {
  if (length <= 1) return 0;
  const rel = idx / (length - 1);
  if (rel < 1 / 3) return 0;
  if (rel > 2 / 3) return 2;
  return 1;
}

export interface PositionMatrixOptions {
  /** Default `"phase"` (Early/Mid/Late) — handles variable-length chains. */
  mode?: PositionMode;
  /** Absolute-mode bucket cap; the last bucket is "kth+". Default `5`. */
  maxAbsolute?: number;
  /** Minimum chains per cell; below this the cell is `null`. Default `3`. */
  minCount?: number;
  /** Roles whose ordering defines the "transform stack". Default preprocess/feature/augmentation. */
  roles?: readonly ChainStepRole[];
  /** Restrict/order rows to these tokens; default all tokens of `roles`. */
  tokens?: readonly string[];
}

/** Token × position goodness matrix — answers "is MSC better 1st or 2nd?". */
export function positionMatrix(analysis: ChainEffectAnalysis, options: PositionMatrixOptions = {}): PositionMatrix {
  const mode = options.mode ?? "phase";
  const maxAbsolute = Math.max(2, Math.trunc(options.maxAbsolute ?? 5));
  const minCount = Math.max(1, Math.trunc(options.minCount ?? 3));
  const roles = options.roles ?? CHAIN_TRANSFORM_ROLES;
  const roleSet = new Set(roles);
  const buckets = mode === "absolute" ? absoluteBuckets(maxAbsolute) : [...PHASE_BUCKETS];

  const byToken = new Map(analysis.tokens.map((token) => [token.token, token]));
  const tokenOrder = options.tokens
    ? options.tokens.filter((token) => byToken.has(token))
    : analysis.tokens.filter((token) => roleSet.has(token.role)).map((token) => token.token);

  const rows: PositionRow[] = tokenOrder.map((token) => {
    const ref = byToken.get(token)!;
    const perBucket: number[][] = buckets.map(() => []);
    for (const point of analysis.points) {
      const stack = point.orderedTokens.filter((entry) => roleSet.has(entry.role));
      const idx = stack.findIndex((entry) => entry.token === token);
      if (idx < 0) continue;
      const bucket = mode === "absolute" ? Math.min(idx, maxAbsolute - 1) : phaseIndex(idx, stack.length);
      perBucket[bucket]!.push(point.goodness);
    }
    const cells = perBucket.map((values) => {
      const summary = stat(values);
      return summary.n >= minCount ? summary : null;
    });
    return { token, label: ref.label, role: ref.role, cells };
  });

  return { mode, buckets, rows, baseline: analysis.baseline };
}

// --- sequence -------------------------------------------------------------

export interface SequenceMatrixOptions {
  roles?: readonly ChainStepRole[];
  minCount?: number;
  /** Consecutive in the transform stack (vs anywhere-before). Default `false`. */
  adjacentOnly?: boolean;
  tokens?: readonly string[];
  /** Cap the matrix to the top-N tokens by coverage. Default `8`. */
  maxTokens?: number;
}

/** Predecessor × successor goodness matrix — answers "MSC after SNV?". */
export function sequenceMatrix(analysis: ChainEffectAnalysis, options: SequenceMatrixOptions = {}): SequenceMatrix {
  const roles = options.roles ?? CHAIN_TRANSFORM_ROLES;
  const roleSet = new Set(roles);
  const minCount = Math.max(1, Math.trunc(options.minCount ?? 3));
  const adjacentOnly = options.adjacentOnly ?? false;
  const maxTokens = Math.max(2, Math.trunc(options.maxTokens ?? 8));

  const byToken = new Map(analysis.tokens.map((token) => [token.token, token]));
  const selected = options.tokens
    ? options.tokens.filter((token) => byToken.has(token))
    : analysis.tokens
        .filter((token) => roleSet.has(token.role))
        .slice()
        .sort((a, b) => b.coverage - a.coverage)
        .slice(0, maxTokens)
        .map((token) => token.token);

  const refs: ChainTokenRef[] = selected.map((token) => {
    const effect = byToken.get(token)!;
    return { token: effect.token, label: effect.label, role: effect.role };
  });
  const colIndex = new Map(refs.map((ref, index) => [ref.token, index]));
  const size = refs.length;
  const buckets: number[][][] = refs.map(() => refs.map(() => []));

  for (const point of analysis.points) {
    const fullIndex = new Map<string, number>();
    point.orderedTokens.forEach((entry, index) => {
      if (colIndex.has(entry.token)) fullIndex.set(entry.token, index);
    });
    const stack = point.orderedTokens.filter((entry) => roleSet.has(entry.role));
    const stackPos = new Map<string, number>();
    stack.forEach((entry, index) => {
      if (colIndex.has(entry.token)) stackPos.set(entry.token, index);
    });

    for (let i = 0; i < size; i += 1) {
      const a = refs[i]!.token;
      const posA = fullIndex.get(a);
      if (posA === undefined) continue;
      for (let j = 0; j < size; j += 1) {
        if (i === j) continue;
        const b = refs[j]!.token;
        const posB = fullIndex.get(b);
        if (posB === undefined) continue;
        const before = adjacentOnly
          ? stackPos.get(b) === (stackPos.get(a) ?? -2) + 1
          : posA < posB;
        if (before) buckets[i]![j]!.push(point.goodness);
      }
    }
  }

  const cells = buckets.map((row, i) =>
    row.map((values, j) => {
      if (i === j) return null;
      const summary = stat(values);
      return summary.n >= minCount ? summary : null;
    }),
  );

  return { tokens: refs, cells, baseline: analysis.baseline, adjacentOnly };
}

// --- contexts -------------------------------------------------------------

export interface TokenContextsOptions {
  roles?: readonly ChainStepRole[];
  minCount?: number;
  /** Cap each list to the top-K by median goodness. Default: unbounded. */
  topK?: number;
}

/** Best/worst neighbours around a focus token (explorer detail panel). */
export function tokenContexts(
  analysis: ChainEffectAnalysis,
  focusToken: string,
  options: TokenContextsOptions = {},
): TokenContexts {
  const roles = options.roles ?? CHAIN_TRANSFORM_ROLES;
  const roleSet = new Set(roles);
  const minCount = Math.max(1, Math.trunc(options.minCount ?? 3));
  const byToken = new Map(analysis.tokens.map((token) => [token.token, token]));

  const predValues = new Map<string, number[]>();
  const succValues = new Map<string, number[]>();

  for (const point of analysis.points) {
    const focusIdx = point.orderedTokens.findIndex((entry) => entry.token === focusToken);
    if (focusIdx < 0) continue;
    point.orderedTokens.forEach((entry, index) => {
      if (entry.token === focusToken || !roleSet.has(entry.role)) return;
      const target = index < focusIdx ? predValues : succValues;
      const bucket = target.get(entry.token);
      if (bucket) bucket.push(point.goodness);
      else target.set(entry.token, [point.goodness]);
    });
  }

  const build = (values: Map<string, number[]>): ContextRow[] => {
    const rows: ContextRow[] = [];
    for (const [token, list] of values) {
      const summary = stat(list);
      if (summary.n < minCount) continue;
      const ref = byToken.get(token);
      rows.push({
        token,
        label: ref?.label ?? token,
        role: ref?.role ?? "other",
        stat: summary,
        delta: summary.median - analysis.baseline,
      });
    }
    rows.sort((a, b) => b.stat.median - a.stat.median);
    return typeof options.topK === "number" ? rows.slice(0, Math.max(0, options.topK)) : rows;
  };

  return { token: focusToken, predecessors: build(predValues), successors: build(succValues) };
}

// --- neighbourhood (radial navigator) --------------------------------------

export interface NodeNeighborsOptions {
  /** Neighbour roles to include. Default: every role present. */
  roles?: readonly ChainStepRole[] | undefined;
  /** Minimum shared chains for a neighbour to appear. Default `1`. */
  minCount?: number;
  /** Keep the top-N neighbours by link weight; the rest fold into "others". Default `9`. */
  maxNeighbors?: number;
}

/**
 * Co-occurrence neighbourhood of a focus node: every token that shares a chain
 * with it, weighted by the number of shared chains and scored by the goodness
 * of those shared chains (the *combined* effect). Drives {@link ChainNodeOrbit}.
 * Returns `null` when the focus token is unknown.
 */
export function nodeNeighbors(
  analysis: ChainEffectAnalysis,
  focusToken: string,
  options: NodeNeighborsOptions = {},
): NodeNeighborhood | null {
  const focus = analysis.tokens.find((token) => token.token === focusToken);
  if (!focus) return null;

  const roleSet = options.roles ? new Set(options.roles) : null;
  const minCount = Math.max(1, Math.trunc(options.minCount ?? 1));
  const maxNeighbors = Math.max(1, Math.trunc(options.maxNeighbors ?? 9));

  const selfValues: number[] = [];
  const perNeighbor = new Map<string, number[]>();
  for (const point of analysis.points) {
    if (!point.tokens.includes(focusToken)) continue;
    selfValues.push(point.goodness);
    for (const ref of point.orderedTokens) {
      if (ref.token === focusToken) continue;
      if (roleSet && !roleSet.has(ref.role)) continue;
      const bucket = perNeighbor.get(ref.token);
      if (bucket) bucket.push(point.goodness);
      else perNeighbor.set(ref.token, [point.goodness]);
    }
  }

  const byToken = new Map(analysis.tokens.map((token) => [token.token, token]));
  const links: NeighborLink[] = [];
  for (const [token, values] of perNeighbor) {
    if (values.length < minCount) continue;
    const ref = byToken.get(token);
    const summary = stat(values);
    links.push({
      token,
      label: ref?.label ?? token,
      role: ref?.role ?? "other",
      count: values.length,
      stat: summary,
      delta: summary.median - analysis.baseline,
    });
  }
  links.sort((a, b) => b.count - a.count || b.stat.median - a.stat.median);

  const kept = links.slice(0, maxNeighbors);
  const folded = links.slice(maxNeighbors);
  const otherWeight = folded.reduce((sum, link) => sum + link.count, 0);

  return {
    token: focus.token,
    label: focus.label,
    role: focus.role,
    self: stat(selfValues),
    neighbors: kept,
    otherCount: folded.length,
    otherWeight,
    baseline: analysis.baseline,
    goodnessExtent: analysis.goodnessExtent,
  };
}

// --- directional flow (sunburst) -------------------------------------------

export interface NodeFlowOptions {
  /** Step roles to include. Default: every role present. */
  roles?: readonly ChainStepRole[] | undefined;
  /** Minimum chains for a wedge to appear. Default `1`. */
  minCount?: number;
  /** Outward successor levels (1–3). Default `2`. */
  depth?: number;
  /** Keep the top-N children per node; the rest drop. Default `6`. */
  maxPerLevel?: number;
  /** Cap the inner predecessor ring. Default `6`. */
  maxPredecessors?: number;
}

interface TrieNode {
  token: string;
  values: number[];
  children: Map<string, TrieNode>;
}

/**
 * If `path` occurs as an ordered subsequence of `orderedTokens`, return the
 * indices of its first and last matched tokens; otherwise `null`.
 */
function pathSpan(
  orderedTokens: readonly ChainTokenRef[],
  path: readonly string[],
): { first: number; last: number } | null {
  let pi = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < orderedTokens.length && pi < path.length; i += 1) {
    if (orderedTokens[i]!.token === path[pi]) {
      if (pi === 0) first = i;
      last = i;
      pi += 1;
    }
  }
  return pi === path.length ? { first, last } : null;
}

/**
 * Directional flow around a focus node: the predecessors that lead into it (one
 * inner ring) and the *real ordered continuations* that follow it, expanded as
 * a bounded successor tree (each path `focus → a → b` is an actual chain
 * sub-sequence that occurred, weighted by its chain count). Drives the
 * multi-ring {@link ChainNodeOrbit} sunburst; returns `null` for an unknown
 * focus.
 */
export function nodeFlow(
  analysis: ChainEffectAnalysis,
  focus: string | readonly string[],
  options: NodeFlowOptions = {},
): NodeFlow | null {
  const path = typeof focus === "string" ? [focus] : focus.slice();
  if (path.length === 0) return null;
  const headToken = path[path.length - 1]!;
  const head = analysis.tokens.find((token) => token.token === headToken);
  if (!head) return null;

  const roleSet = options.roles ? new Set(options.roles) : null;
  const minCount = Math.max(1, Math.trunc(options.minCount ?? 1));
  const depth = Math.min(3, Math.max(1, Math.trunc(options.depth ?? 2)));
  const maxPerLevel = Math.max(1, Math.trunc(options.maxPerLevel ?? 6));
  const maxPredecessors = Math.max(1, Math.trunc(options.maxPredecessors ?? 6));
  const byToken = new Map(analysis.tokens.map((token) => [token.token, token]));

  const selfValues: number[] = [];
  const predValues = new Map<string, number[]>();
  const root: TrieNode = { token: "", values: [], children: new Map() };

  for (const point of analysis.points) {
    const span = pathSpan(point.orderedTokens, path);
    if (!span) continue;
    selfValues.push(point.goodness);

    for (let i = 0; i < span.first; i += 1) {
      const entry = point.orderedTokens[i]!;
      if (roleSet && !roleSet.has(entry.role)) continue;
      const bucket = predValues.get(entry.token);
      if (bucket) bucket.push(point.goodness);
      else predValues.set(entry.token, [point.goodness]);
    }

    let node = root;
    let level = 0;
    for (let i = span.last + 1; i < point.orderedTokens.length && level < depth; i += 1) {
      const entry = point.orderedTokens[i]!;
      if (roleSet && !roleSet.has(entry.role)) continue;
      let child = node.children.get(entry.token);
      if (!child) {
        child = { token: entry.token, values: [], children: new Map() };
        node.children.set(entry.token, child);
      }
      child.values.push(point.goodness);
      node = child;
      level += 1;
    }
  }

  const linkFrom = (token: string, values: number[]): NeighborLink => {
    const ref = byToken.get(token);
    const summary = stat(values);
    return {
      token,
      label: ref?.label ?? token,
      role: ref?.role ?? "other",
      count: values.length,
      stat: summary,
      delta: summary.median - analysis.baseline,
    };
  };

  const predecessors = [...predValues.entries()]
    .map(([token, values]) => linkFrom(token, values))
    .filter((link) => link.count >= minCount)
    .sort((a, b) => b.count - a.count || b.stat.median - a.stat.median)
    .slice(0, maxPredecessors);

  const convert = (trie: TrieNode): FlowNode[] =>
    [...trie.children.values()]
      .filter((child) => child.values.length >= minCount)
      .sort((a, b) => b.values.length - a.values.length)
      .slice(0, maxPerLevel)
      .map((child) => {
        const link = linkFrom(child.token, child.values);
        return { ...link, children: convert(child) };
      });

  return {
    token: head.token,
    label: head.label,
    role: head.role,
    self: stat(selfValues),
    predecessors,
    successors: convert(root),
    baseline: analysis.baseline,
    goodnessExtent: analysis.goodnessExtent,
  };
}

/**
 * Package-level view-model contract for the chain-effect explorer.
 *
 * A "chain" is one executed *linear* pipeline — an ordered sequence of steps
 * (e.g. `SNV → SavGol → PLS`) that produced a comparable score (nRMSE, RMSE,
 * R², …) on some dataset/source. This domain turns a corpus of *hundreds* of
 * scored chains into the influence of each node: how much a step helps or
 * hurts globally, whether it is better early / mid / late in the chain, and
 * whether its effect depends on what precedes it (e.g. "MSC after SNV").
 *
 * This is a small, framework-free contract — deliberately NOT a dependency on
 * `dag-ml`. The *authoritative* analysis (per-dataset score normalization with
 * lineage) is a coordination concern that lives native in `dag-ml`; this
 * package renders its serialized artifact (see {@link file://./contract.ts})
 * and also ships a descriptive {@link file://./analysis.ts fromScoredChains}
 * adapter — the same view-model tier as `viz/geometry` — so hosts can render
 * from a raw scored-chain list before the native producer exists.
 */

/** Coarse role of a step; drives color, legend, and position/sequence scoping. */
export type ChainStepRole =
  | "split"
  | "preprocess"
  | "feature"
  | "model"
  | "augmentation"
  | "target"
  | "other";

/** One node occurrence inside a chain. */
export interface ChainStep {
  /** Canonical id, e.g. `"snv"`, `"msc"`, `"savgol"`, `"pls"`. */
  token: string;
  /** Display label; defaults to `token`. */
  label?: string;
  role: ChainStepRole;
}

/** A single executed chain with a comparable score (host-provided raw input). */
export interface ScoredChain {
  id: string;
  /** Ordered steps, first → last. */
  steps: readonly ChainStep[];
  /** Metric value (e.g. nRMSE). Direction is carried by {@link ChainMetric}. */
  score: number;
  /** Dataset the chain ran on — the unit of per-dataset normalization. */
  dataset?: string;
  /** Source / modality (multisource, multimodal). */
  source?: string;
}

/** The metric the scores are expressed in, plus its optimization direction. */
export interface ChainMetric {
  key: string;
  label: string;
  /** `true` for error metrics (nRMSE, RMSE); `false` for R²/accuracy. */
  lowerIsBetter: boolean;
}

/**
 * Normalization lens that makes heterogeneous datasets comparable.
 * - `raw`: oriented score as-is (best for a single dataset).
 * - `rankByDataset`: percentile rank within each dataset (0..1, 1 = best) —
 *   robust, non-parametric; the recommended default for cross-dataset corpora.
 * - `zByDataset`: z-score within each dataset (higher = better).
 */
export type ScoreLens = "raw" | "rankByDataset" | "zByDataset";

/** A deduplicated token reference (first-occurrence order within a chain). */
export interface ChainTokenRef {
  token: string;
  label: string;
  role: ChainStepRole;
}

/** One chain projected to a comparable "goodness" (higher = better). */
export interface ChainPoint {
  id: string;
  /** Raw metric value (for tooltips). */
  score: number;
  /** Oriented, lens-normalized score; higher is always better. */
  goodness: number;
  /** Dataset key (`"∗"` when unknown). */
  dataset: string;
  /** Source key (`"∗"` when unknown). */
  source: string;
  /** Unique tokens present (membership test). */
  tokens: readonly string[];
  /** First-occurrence-ordered, deduped step references. */
  orderedTokens: readonly ChainTokenRef[];
}

/** Five-number summary + sample size of a goodness distribution. */
export interface Stat {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
}

/** Global effect of one token: distribution with vs without, and the delta. */
export interface TokenEffect {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Chains containing the token. */
  n: number;
  /** `n / total`. */
  coverage: number;
  /** Goodness of chains that contain the token. */
  with: Stat;
  /** Goodness of chains that do not. */
  without: Stat;
  /** `with.median − without.median` (NaN when either side is empty). */
  delta: number;
}

/** The full analysis view-model consumed by every chart in this domain. */
export interface ChainEffectAnalysis {
  lens: ScoreLens;
  metric: ChainMetric;
  total: number;
  datasets: readonly string[];
  sources: readonly string[];
  roles: readonly ChainStepRole[];
  /** Reference goodness (global median); the diverging color pivot. */
  baseline: number;
  goodnessExtent: { min: number; max: number };
  points: readonly ChainPoint[];
  /** Per-token effects, sorted by `delta` desc (NaN last). */
  tokens: readonly TokenEffect[];
}

/** Position bucketization: absolute ordinal or relative early/mid/late phase. */
export type PositionMode = "absolute" | "phase";

export interface PositionBucket {
  key: string;
  label: string;
}

export interface PositionRow {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Index-aligned to the matrix buckets; `null` below the min-count gate. */
  cells: readonly (Stat | null)[];
}

export interface PositionMatrix {
  mode: PositionMode;
  buckets: readonly PositionBucket[];
  rows: readonly PositionRow[];
  baseline: number;
}

/** Predecessor (rows) × successor (cols) goodness matrix. */
export interface SequenceMatrix {
  tokens: readonly ChainTokenRef[];
  /** `cells[pred][succ]`; `null` on the diagonal or below the min-count gate. */
  cells: readonly (readonly (Stat | null)[])[];
  baseline: number;
  adjacentOnly: boolean;
}

export interface ContextRow {
  token: string;
  label: string;
  role: ChainStepRole;
  stat: Stat;
  /** `stat.median − baseline`. */
  delta: number;
}

/** Best/worst neighbours for a focus token (drives the explorer detail panel). */
export interface TokenContexts {
  token: string;
  /** Tokens occurring before the focus, sorted by median goodness desc. */
  predecessors: readonly ContextRow[];
  /** Tokens occurring after the focus, sorted by median goodness desc. */
  successors: readonly ContextRow[];
}

/** One co-occurring node linked to a focus node (an orbit wedge). */
export interface NeighborLink {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Chains containing both the focus and this token — the link weight. */
  count: number;
  /** Goodness distribution of those shared chains. */
  stat: Stat;
  /** `stat.median − baseline` (the combined effect). */
  delta: number;
}

/** One node in the directional flow tree (a sunburst wedge with children). */
export interface FlowNode {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Chains matching the ordered path focus → … → this node. */
  count: number;
  stat: Stat;
  /** `stat.median − baseline`. */
  delta: number;
  /** The next step(s) after this node, nested one ring further out. */
  children: readonly FlowNode[];
}

/**
 * Directional flow around a focus node — the multi-ring sunburst model:
 * predecessors (what leads in, one inner ring) and a successor tree (what
 * follows, expanded outward `depth` rings).
 */
export interface NodeFlow {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Goodness of every chain containing the focus. */
  self: Stat;
  /** Nodes occurring before the focus — the inner ring. */
  predecessors: readonly NeighborLink[];
  /** Ordered continuation after the focus — the outer sunburst. */
  successors: readonly FlowNode[];
  baseline: number;
  goodnessExtent: { min: number; max: number };
}

/** A focus node and its co-occurring neighbours — the single-ring model. */
export interface NodeNeighborhood {
  token: string;
  label: string;
  role: ChainStepRole;
  /** Goodness of every chain containing the focus. */
  self: Stat;
  /** Neighbours sorted by link weight desc (capped by `maxNeighbors`). */
  neighbors: readonly NeighborLink[];
  /** Neighbour tokens folded out beyond the cap. */
  otherCount: number;
  /** Summed link weight of the folded neighbours (the "others" wedge span). */
  otherWeight: number;
  baseline: number;
  goodnessExtent: { min: number; max: number };
}

/** Human-facing role labels for legends and chips. */
export const CHAIN_ROLE_LABELS: Readonly<Record<ChainStepRole, string>> = {
  split: "Split / CV",
  preprocess: "Preprocess",
  feature: "Feature",
  model: "Model",
  augmentation: "Augmentation",
  target: "Target",
  other: "Other",
};

/** Stable display order for roles (used when listing/grouping). */
export const CHAIN_ROLE_ORDER: readonly ChainStepRole[] = [
  "split",
  "preprocess",
  "feature",
  "augmentation",
  "model",
  "target",
  "other",
];

/** Roles whose *order* is meaningful — the "transform stack" of a chain. */
export const CHAIN_TRANSFORM_ROLES: readonly ChainStepRole[] = ["preprocess", "feature", "augmentation"];

/** Short labels for each normalization lens. */
export const CHAIN_LENS_LABELS: Readonly<Record<ScoreLens, string>> = {
  raw: "Raw score",
  rankByDataset: "Rank in dataset",
  zByDataset: "Z in dataset",
};

const VALID_ROLES = new Set<ChainStepRole>(CHAIN_ROLE_ORDER);

/** Coerce an arbitrary role string to a known {@link ChainStepRole}. */
export function coerceChainRole(role: string | undefined): ChainStepRole {
  return role && VALID_ROLES.has(role as ChainStepRole) ? (role as ChainStepRole) : "other";
}

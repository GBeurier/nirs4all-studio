/**
 * Serialized contract for the chain-effect analysis — the seam to `dag-ml`.
 *
 * The *authoritative* analysis is a coordination concern that lives native in
 * `dag-ml` (over its `ScoreSet` + `GraphPlan` node identities, with per-dataset
 * normalization and fingerprints). It serializes to the snake_case artifact
 * below — mirroring how `TuningResult` / `CalibratedRunResult` reach this
 * package. {@link parseChainEffectAnalysis} validates and projects it into the
 * camelCase {@link ChainEffectAnalysis} view-model the charts render, trusting
 * the producer's authoritative `goodness`/`baseline` verbatim. Token effects
 * and the position/sequence matrices are *derived* views, so the wire artifact
 * stays lean (metric + lens + baseline + points).
 *
 * {@link toChainEffectArtifact} does the reverse for tests, demos, and hosts
 * that want to persist the descriptive view-model in the same shape.
 */

import { buildAnalysis } from "./analysis.js";
import type { ChainEffectAnalysis, ChainPoint, ChainStepRole, ChainTokenRef, ScoreLens } from "./types.js";
import { coerceChainRole } from "./types.js";

export const CHAIN_EFFECT_SCHEMA_ID =
  "https://github.com/GBeurier/dag-ml/schemas/chain_effect_analysis.v1.schema.json" as const;
export const CHAIN_EFFECT_SCHEMA_VERSION = 1 as const;

/** Wire spelling of {@link ScoreLens}. */
export type ChainEffectLensWire = "raw" | "rank_by_dataset" | "z_by_dataset";

const LENS_FROM_WIRE: Readonly<Record<ChainEffectLensWire, ScoreLens>> = {
  raw: "raw",
  rank_by_dataset: "rankByDataset",
  z_by_dataset: "zByDataset",
};

const LENS_TO_WIRE: Readonly<Record<ScoreLens, ChainEffectLensWire>> = {
  raw: "raw",
  rankByDataset: "rank_by_dataset",
  zByDataset: "z_by_dataset",
};

export interface ChainEffectStepArtifact {
  token: string;
  label?: string;
  role: string;
}

export interface ChainEffectPointArtifact {
  id: string;
  score: number;
  goodness: number;
  dataset?: string | null;
  source?: string | null;
  ordered_tokens: readonly ChainEffectStepArtifact[];
}

export interface ChainEffectMetricArtifact {
  key: string;
  label: string;
  lower_is_better: boolean;
}

export interface ChainEffectAnalysisArtifact {
  schema_id: string;
  schema_version: number;
  metric: ChainEffectMetricArtifact;
  lens: ChainEffectLensWire;
  baseline?: number | null;
  points: readonly ChainEffectPointArtifact[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMetric(value: unknown): value is ChainEffectMetricArtifact {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.label === "string" &&
    typeof value.lower_is_better === "boolean"
  );
}

function isStepArtifact(value: unknown): value is ChainEffectStepArtifact {
  return isRecord(value) && typeof value.token === "string" && typeof value.role === "string";
}

function isPointArtifact(value: unknown): value is ChainEffectPointArtifact {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.score === "number" &&
    typeof value.goodness === "number" &&
    Array.isArray(value.ordered_tokens) &&
    value.ordered_tokens.every(isStepArtifact)
  );
}

/** Structural guard for a serialized chain-effect artifact. */
export function isChainEffectAnalysisArtifact(value: unknown): value is ChainEffectAnalysisArtifact {
  return (
    isRecord(value) &&
    value.schema_id === CHAIN_EFFECT_SCHEMA_ID &&
    typeof value.schema_version === "number" &&
    isMetric(value.metric) &&
    typeof value.lens === "string" &&
    value.lens in LENS_FROM_WIRE &&
    Array.isArray(value.points) &&
    value.points.every(isPointArtifact)
  );
}

function dedupeArtifactTokens(steps: readonly ChainEffectStepArtifact[]): ChainTokenRef[] {
  const seen = new Set<string>();
  const out: ChainTokenRef[] = [];
  for (const step of steps) {
    if (seen.has(step.token)) continue;
    seen.add(step.token);
    out.push({ token: step.token, label: step.label ?? step.token, role: coerceChainRole(step.role) });
  }
  return out;
}

/** Validate + project a serialized artifact into the render-ready view-model. */
export function parseChainEffectAnalysis(value: unknown): ChainEffectAnalysis {
  if (!isChainEffectAnalysisArtifact(value)) {
    throw new Error("Invalid chain-effect analysis artifact");
  }
  const metric = {
    key: value.metric.key,
    label: value.metric.label,
    lowerIsBetter: value.metric.lower_is_better,
  };
  const lens = LENS_FROM_WIRE[value.lens as ChainEffectLensWire];
  const points: ChainPoint[] = value.points.map((point) => {
    const ordered = dedupeArtifactTokens(point.ordered_tokens);
    return {
      id: point.id,
      score: point.score,
      goodness: point.goodness,
      dataset: point.dataset ?? "∗",
      source: point.source ?? "∗",
      tokens: ordered.map((token) => token.token),
      orderedTokens: ordered,
    };
  });
  const baseline = typeof value.baseline === "number" && Number.isFinite(value.baseline) ? value.baseline : undefined;
  return buildAnalysis(points, { metric, lens, baseline });
}

/** Serialize a view-model back to the wire artifact (tests / demos / hosts). */
export function toChainEffectArtifact(analysis: ChainEffectAnalysis): ChainEffectAnalysisArtifact {
  return {
    schema_id: CHAIN_EFFECT_SCHEMA_ID,
    schema_version: CHAIN_EFFECT_SCHEMA_VERSION,
    metric: {
      key: analysis.metric.key,
      label: analysis.metric.label,
      lower_is_better: analysis.metric.lowerIsBetter,
    },
    lens: LENS_TO_WIRE[analysis.lens],
    baseline: analysis.baseline,
    points: analysis.points.map((point) => ({
      id: point.id,
      score: point.score,
      goodness: point.goodness,
      dataset: point.dataset === "∗" ? null : point.dataset,
      source: point.source === "∗" ? null : point.source,
      ordered_tokens: point.orderedTokens.map((token) => ({
        token: token.token,
        label: token.label,
        role: token.role as ChainStepRole,
      })),
    })),
  };
}

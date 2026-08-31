import type { ReactNode } from "react";

import {
  clamp,
  makeScale,
  niceExtent,
  quantileSorted,
  round,
  type Extent,
} from "../viz/geometry.js";
import { N4_VIZ_COLORS } from "../viz/theme.js";
import { conformalBandShade } from "../viz/ConformalIntervalStrip.js";
import type {
  ConformalGuaranteeView,
  ConformalIntervalSummaryRow,
  ConformalPredictionIntervalCell,
  ConformalPredictionRow,
} from "../conformal/result.js";

const COVERED_COLOR = "#059669";
const MISSED_COLOR = N4_VIZ_COLORS.rose;
const PREDICTION_COLOR = N4_VIZ_COLORS.indigo;

export type ConformalTreeGroupMode = "conformance" | "uncertainty" | "none";
export type ConformalTierTone = "success" | "warning" | "danger" | "neutral";

/** One prediction, projected onto its conformance / uncertainty coordinates. */
export interface ConformalTreeSample {
  index: number;
  sampleId: string | null;
  prediction: number;
  predictionLabel: string;
  actual: number | null;
  /** Width of the target-coverage interval (falls back to the widest band). */
  targetWidth: number | null;
  widestWidth: number;
  coveredAtTarget: boolean | null;
  /** Smallest coverage level whose interval still contains the truth. */
  tightestCovering: number | null;
  intervals: readonly ConformalPredictionIntervalCell[];
}

export interface ConformalTreeTier {
  id: string;
  label: string;
  description: string;
  tone: ConformalTierTone;
  samples: ConformalTreeSample[];
  count: number;
  share: number;
  meanWidth: number | null;
}

export interface ConformalTreeModel {
  tiers: ConformalTreeTier[];
  coverages: number[];
  domain: Extent;
  target: number;
  total: number;
  hasActuals: boolean;
  groupBy: ConformalTreeGroupMode;
}

export interface BuildConformalTreeOptions {
  actuals?: readonly (number | null | undefined)[] | undefined;
  targetCoverage?: number | null | undefined;
  groupBy?: "auto" | ConformalTreeGroupMode | undefined;
}

function cellWidth(cell: ConformalPredictionIntervalCell): number {
  return cell.upper - cell.lower;
}

function coversActual(cell: ConformalPredictionIntervalCell, actual: number): boolean {
  return actual >= cell.lower && actual <= cell.upper;
}

/**
 * Project calibrated prediction rows into a grouped, nesting-aware tree model —
 * the pure view-model behind {@link ConformalPredictionTree}. Grouping is by
 * where the truth falls within the nested intervals (conformance) when ground
 * truth is present, otherwise by interval width (uncertainty).
 */
export function buildConformalTreeModel(
  rows: readonly ConformalPredictionRow[],
  options: BuildConformalTreeOptions = {},
): ConformalTreeModel {
  const { actuals, targetCoverage = null, groupBy = "auto" } = options;

  const coverages = [...new Set(rows.flatMap((row) => row.intervals.map((cell) => cell.coverage)))]
    .filter((coverage) => Number.isFinite(coverage))
    .sort((a, b) => b - a);
  const minCoverage = coverages.length > 0 ? (coverages[coverages.length - 1] as number) : Number.NaN;
  const target = targetCoverage != null && coverages.includes(targetCoverage)
    ? targetCoverage
    : (coverages[0] ?? Number.NaN);

  const valuePool: number[] = [];
  const samples: ConformalTreeSample[] = rows.map((row, index) => {
    const rawActual = actuals?.[index];
    const actual = rawActual != null && Number.isFinite(rawActual) ? rawActual : null;
    valuePool.push(row.yPred);
    if (actual != null) valuePool.push(actual);

    let widest = 0;
    let tightestCovering: number | null = null;
    for (const cell of row.intervals) {
      valuePool.push(cell.lower, cell.upper);
      widest = Math.max(widest, cellWidth(cell));
      if (actual != null && coversActual(cell, actual)) {
        tightestCovering = tightestCovering == null ? cell.coverage : Math.min(tightestCovering, cell.coverage);
      }
    }
    const targetCell = row.intervals.find((cell) => cell.coverage === target) ?? null;

    return {
      index: row.index,
      sampleId: row.sampleId,
      prediction: row.yPred,
      predictionLabel: row.yPredLabel,
      actual,
      targetWidth: targetCell ? cellWidth(targetCell) : null,
      widestWidth: widest,
      coveredAtTarget: actual == null ? null : tightestCovering != null && tightestCovering <= target,
      tightestCovering,
      intervals: row.intervals,
    };
  });

  const hasActuals = samples.some((sample) => sample.actual != null);
  const mode: ConformalTreeGroupMode = groupBy === "auto"
    ? (hasActuals ? "conformance" : "uncertainty")
    : groupBy;

  const domain = niceExtent(valuePool, 0.04);
  const tiers = mode === "conformance"
    ? conformanceTiers(samples, target, minCoverage)
    : mode === "uncertainty"
      ? uncertaintyTiers(samples)
      : flatTier(samples);

  return {
    tiers: tiers.filter((tier) => tier.count > 0),
    coverages,
    domain,
    target,
    total: samples.length,
    hasActuals,
    groupBy: mode,
  };
}

function tierWidth(sample: ConformalTreeSample): number {
  return sample.targetWidth ?? sample.widestWidth;
}

function finalizeTier(
  id: string,
  label: string,
  description: string,
  tone: ConformalTierTone,
  samples: ConformalTreeSample[],
  total: number,
): ConformalTreeTier {
  const widths = samples.map(tierWidth).filter((width) => Number.isFinite(width));
  const meanWidth = widths.length > 0 ? widths.reduce((sum, width) => sum + width, 0) / widths.length : null;
  return {
    id,
    label,
    description,
    tone,
    samples,
    count: samples.length,
    share: total > 0 ? samples.length / total : 0,
    meanWidth,
  };
}

function conformanceTiers(samples: ConformalTreeSample[], target: number, minCoverage: number): ConformalTreeTier[] {
  const core: ConformalTreeSample[] = [];
  const within: ConformalTreeSample[] = [];
  const wide: ConformalTreeSample[] = [];
  const violation: ConformalTreeSample[] = [];
  const unknown: ConformalTreeSample[] = [];

  for (const sample of samples) {
    if (sample.actual == null) {
      unknown.push(sample);
    } else if (sample.tightestCovering == null) {
      violation.push(sample);
    } else if (sample.tightestCovering <= minCoverage) {
      core.push(sample);
    } else if (sample.tightestCovering <= target) {
      within.push(sample);
    } else {
      wide.push(sample);
    }
  }

  return [
    finalizeTier("core", "Truth in the tightest band", "Covered even by the narrowest calibrated interval.", "success", core, samples.length),
    finalizeTier("within", "Covered at target", "Covered at the guarantee level but not the tightest band.", "success", within, samples.length),
    finalizeTier("wide", "Covered only when widened", "Truth falls outside the target band but inside a wider one.", "warning", wide, samples.length),
    finalizeTier("violation", "Interval violations", "Truth escapes every calibrated interval.", "danger", violation, samples.length),
    finalizeTier("unknown", "No ground truth", "Prediction intervals only — no observed value to score.", "neutral", unknown, samples.length),
  ];
}

function uncertaintyTiers(samples: ConformalTreeSample[]): ConformalTreeTier[] {
  const sortedWidths = samples.map(tierWidth).filter((width) => Number.isFinite(width)).sort((a, b) => a - b);
  const q33 = quantileSorted(sortedWidths, 1 / 3);
  const q66 = quantileSorted(sortedWidths, 2 / 3);

  const tight: ConformalTreeSample[] = [];
  const moderate: ConformalTreeSample[] = [];
  const broad: ConformalTreeSample[] = [];
  for (const sample of samples) {
    const width = tierWidth(sample);
    if (width <= q33) tight.push(sample);
    else if (width <= q66) moderate.push(sample);
    else broad.push(sample);
  }

  return [
    finalizeTier("tight", "Tight intervals", "The most confident predictions — narrowest calibrated intervals.", "success", tight, samples.length),
    finalizeTier("moderate", "Typical intervals", "Interval widths around the median of the set.", "neutral", moderate, samples.length),
    finalizeTier("broad", "Wide intervals", "The least certain predictions — widest calibrated intervals.", "warning", broad, samples.length),
  ];
}

function flatTier(samples: ConformalTreeSample[]): ConformalTreeTier[] {
  return [finalizeTier("all", "All predictions", "Every calibrated prediction.", "neutral", samples, samples.length)];
}

function fmtCoverage(coverage: number): string {
  if (!Number.isFinite(coverage)) return "—";
  const percent = coverage * 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

function fmtShare(share: number): string {
  const percent = share * 100;
  return `${percent < 10 && percent > 0 ? percent.toFixed(1) : percent.toFixed(0)}%`;
}

function fmtWidth(width: number | null): string {
  if (width == null || !Number.isFinite(width)) return "—";
  if (Math.abs(width) >= 1000) return width.toFixed(0);
  if (Math.abs(width) >= 1) return width.toFixed(2);
  return width.toFixed(3);
}

function shadeForCoverage(coverage: number, coverages: readonly number[]): string {
  if (coverages.length <= 1) return conformalBandShade(0.62);
  const rank = coverages.indexOf(coverage);
  return conformalBandShade(rank / (coverages.length - 1));
}

interface NestedBandGlyphProps {
  sample: ConformalTreeSample;
  coverages: readonly number[];
  domain: Extent;
  width: number;
  height?: number;
}

/** Per-sample horizontal nesting of the calibrated intervals + truth marker. */
function NestedBandGlyph({ sample, coverages, domain, width, height = 22 }: NestedBandGlyphProps) {
  const padX = 3;
  const scale = makeScale(domain, padX, width - padX);
  const barTop = 3;
  const barHeight = height - barTop * 2;
  const bands = [...sample.intervals].sort((a, b) => b.coverage - a.coverage);

  return (
    <svg
      className="n4conf-glyph"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`Nested intervals for ${sample.sampleId ?? `sample ${sample.index}`}`}
      preserveAspectRatio="none"
    >
      {bands.map((cell) => {
        const x1 = scale(cell.lower);
        const x2 = scale(cell.upper);
        return (
          <rect
            key={`b-${cell.coverage}`}
            className="n4conf-glyph-band"
            x={round(Math.min(x1, x2))}
            y={barTop}
            width={round(Math.abs(x2 - x1))}
            height={barHeight}
            rx={2}
            fill={shadeForCoverage(cell.coverage, coverages)}
          />
        );
      })}
      <line
        className="n4conf-glyph-point"
        x1={round(scale(sample.prediction))}
        x2={round(scale(sample.prediction))}
        y1={barTop - 1}
        y2={height - barTop + 1}
        stroke={PREDICTION_COLOR}
        strokeWidth={2}
      />
      {sample.actual != null ? (
        sample.coveredAtTarget !== false ? (
          <circle
            cx={round(scale(sample.actual))}
            cy={height / 2}
            r={3.2}
            fill={COVERED_COLOR}
            stroke="var(--n4-color-surface, #fff)"
            strokeWidth={1.5}
          />
        ) : (
          <path
            d={diamond(scale(sample.actual), height / 2, 3.8)}
            fill={MISSED_COLOR}
            stroke="var(--n4-color-surface, #fff)"
            strokeWidth={1.5}
          />
        )
      ) : null}
    </svg>
  );
}

export interface ConformalPredictionTreeProps {
  rows: readonly ConformalPredictionRow[];
  /** Ground-truth values aligned to `rows` — enables conformance grouping + scoring. */
  actuals?: readonly (number | null | undefined)[];
  /** Materialized interval summaries (qhat per coverage) for the leaf rows. */
  summaries?: readonly ConformalIntervalSummaryRow[];
  guarantee?: ConformalGuaranteeView | null;
  targetCoverage?: number | null;
  groupBy?: "auto" | ConformalTreeGroupMode;
  unit?: string;
  defaultOpenTiers?: boolean;
  maxSamplesPerTier?: number;
  glyphWidth?: number;
  className?: string;
  empty?: ReactNode;
}

/**
 * Calibrated **predictions as a nested conformance tree** — the drill-down
 * companion to {@link file://../viz/ConformalIntervalStrip.tsx ConformalIntervalStrip}.
 * Predictions are grouped into conformance tiers (where the truth lands inside
 * the nested intervals) or uncertainty tiers (interval width), each tier opening
 * into per-sample nodes that carry a nesting glyph, and each sample opening into
 * its per-coverage interval rows. Presentational + local `<details>` state only;
 * hosts pass `conformal` view-model rows. Default styles ship at
 * `nirs4all-ui/assets/conformal.css`.
 */
export function ConformalPredictionTree({
  rows,
  actuals,
  summaries,
  guarantee = null,
  targetCoverage = null,
  groupBy = "auto",
  unit,
  defaultOpenTiers = true,
  maxSamplesPerTier = 50,
  glyphWidth = 150,
  className,
  empty,
}: ConformalPredictionTreeProps) {
  if (rows.length === 0) return empty == null ? <div className={cx("n4conf-tree", className)} /> : <>{empty}</>;

  const model = buildConformalTreeModel(rows, { actuals, targetCoverage, groupBy });
  const qhatByCoverage = new Map((summaries ?? []).map((row) => [row.coverage, row.qhatLabel]));
  const maxWidth = Math.max(1e-9, ...rows.flatMap((row) => row.intervals.map((cell) => cell.width)));
  const unitSuffix = unit ? ` ${unit}` : "";

  return (
    <div className={cx("n4conf-tree", className)}>
      {guarantee ? (
        <header className="n4conf-guarantee" data-tone={guarantee.tone}>
          <span className="n4conf-guarantee-status" data-status={guarantee.status} />
          <span className="n4conf-guarantee-label">{guarantee.label}</span>
          <span className="n4conf-guarantee-meta">
            {guarantee.method} · {guarantee.effectiveEngine} · target {guarantee.coverageLabel}
          </span>
        </header>
      ) : null}

      <div className="n4conf-legend" role="note">
        <span className="n4conf-legend-item"><i className="n4conf-swatch" style={{ background: PREDICTION_COLOR }} /> prediction</span>
        {model.hasActuals ? (
          <>
            <span className="n4conf-legend-item"><i className="n4conf-dot" style={{ background: COVERED_COLOR }} /> covered</span>
            <span className="n4conf-legend-item"><i className="n4conf-diamond" style={{ background: MISSED_COLOR }} /> missed</span>
          </>
        ) : null}
        <span className="n4conf-legend-item n4conf-legend-ramp" aria-hidden="true">
          {model.coverages.map((coverage) => (
            <i key={coverage} className="n4conf-swatch" title={fmtCoverage(coverage)} style={{ background: shadeForCoverage(coverage, model.coverages) }} />
          ))}
          <span className="n4conf-legend-ramp-label">wide → tight</span>
        </span>
      </div>

      {model.tiers.map((tier) => (
        <details className="n4conf-tier" data-tone={tier.tone} key={tier.id} open={defaultOpenTiers}>
          <summary className="n4conf-tier-summary">
            <span className="n4conf-chevron" aria-hidden="true" />
            <span className="n4conf-tier-label">{tier.label}</span>
            <span className="n4conf-tier-desc">{tier.description}</span>
            <span className="n4conf-tier-stats">
              <span className="n4conf-badge">{tier.count}</span>
              <span className="n4conf-share">{fmtShare(tier.share)}</span>
              <span className="n4conf-meanwidth">x̄ width {fmtWidth(tier.meanWidth)}{unitSuffix}</span>
            </span>
          </summary>

          <div className="n4conf-samples">
            {tier.samples.slice(0, maxSamplesPerTier).map((sample) => (
              <details className="n4conf-sample" key={sample.index}>
                <summary className="n4conf-sample-summary">
                  <span className="n4conf-chevron" aria-hidden="true" />
                  <span className="n4conf-sample-id">{sample.sampleId ?? `#${sample.index}`}</span>
                  <span className="n4conf-sample-pred">ŷ {sample.predictionLabel}{unitSuffix}</span>
                  <NestedBandGlyph sample={sample} coverages={model.coverages} domain={model.domain} width={glyphWidth} />
                  {sample.coveredAtTarget == null ? (
                    <span className="n4conf-chip" data-tone="neutral">±{fmtWidth(sample.targetWidth ?? sample.widestWidth)}</span>
                  ) : sample.coveredAtTarget ? (
                    <span className="n4conf-chip" data-tone="success">covered {sample.tightestCovering != null ? fmtCoverage(sample.tightestCovering) : ""}</span>
                  ) : (
                    <span className="n4conf-chip" data-tone="danger">missed</span>
                  )}
                </summary>

                <div className="n4conf-levels">
                  {[...sample.intervals].sort((a, b) => a.coverage - b.coverage).map((cell) => {
                    const covered = sample.actual == null ? null : coversActual(cell, sample.actual);
                    const qhat = qhatByCoverage.get(cell.coverage);
                    return (
                      <div className="n4conf-level" data-covered={covered == null ? "na" : covered ? "yes" : "no"} key={cell.coverage}>
                        <span className="n4conf-level-cov">{cell.coverageLabel}</span>
                        {qhat ? <span className="n4conf-level-qhat">q̂ {qhat}</span> : null}
                        <span className="n4conf-level-range">[{cell.lowerLabel}, {cell.upperLabel}]</span>
                        <span className="n4conf-level-bar" aria-hidden="true">
                          <i
                            className="n4conf-level-bar-fill"
                            style={{ width: `${clamp((cell.width / maxWidth) * 100, 2, 100)}%`, background: shadeForCoverage(cell.coverage, model.coverages) }}
                          />
                        </span>
                        <span className="n4conf-level-width">{cell.widthLabel}{unitSuffix}</span>
                        {covered != null ? (
                          <span className="n4conf-level-mark" data-covered={covered ? "yes" : "no"}>{covered ? "✓" : "✗"}</span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
            {tier.samples.length > maxSamplesPerTier ? (
              <p className="n4conf-more">+{tier.samples.length - maxSamplesPerTier} more predictions</p>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

function diamond(cx: number, cy: number, radius: number): string {
  const x = round(cx);
  const y = round(cy);
  const r = round(radius);
  return `M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`;
}

function cx(...parts: Array<string | false | null | undefined>): string | undefined {
  const resolved = parts.filter((part): part is string => typeof part === "string" && part.length > 0);
  return resolved.length > 0 ? resolved.join(" ") : undefined;
}

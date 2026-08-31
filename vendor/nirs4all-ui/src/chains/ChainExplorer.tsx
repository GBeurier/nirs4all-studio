import { useMemo, useState } from "react";

import { clamp } from "../viz/geometry.js";
import { cx } from "./_cx.js";
import {
  buildAnalysis,
  fromScoredChains,
  positionMatrix,
  sequenceMatrix,
  tokenContexts,
} from "./analysis.js";
import { ChainScoreBeeswarm } from "./ChainScoreBeeswarm.js";
import { effectColor, roleColor } from "./colors.js";
import { NodeEffectForest, type ForestSort } from "./NodeEffectForest.js";
import { PositionEffectHeatmap } from "./PositionEffectHeatmap.js";
import { SequenceEffectHeatmap } from "./SequenceEffectHeatmap.js";
import type {
  ChainEffectAnalysis,
  ChainMetric,
  ChainStepRole,
  ContextRow,
  PositionMode,
  ScoredChain,
  ScoreLens,
} from "./types.js";
import { CHAIN_LENS_LABELS, CHAIN_ROLE_LABELS, CHAIN_TRANSFORM_ROLES } from "./types.js";

const DEFAULT_METRIC: ChainMetric = { key: "nrmse", label: "nRMSE", lowerIsBetter: true };
const LENS_ORDER: readonly ScoreLens[] = ["rankByDataset", "zByDataset", "raw"];

export interface ChainExplorerProps {
  /**
   * Raw scored chains (host-provided) — computed live so the lens and the
   * source/dataset/role filters stay interactive over hundreds of chains.
   */
  chains?: readonly ScoredChain[];
  /**
   * A precomputed authoritative analysis (e.g. parsed from the `dag-ml`
   * artifact). When given without `chains`, the lens is fixed to its lens and
   * only the identity filters recompute descriptive aggregates for the subset.
   */
  analysis?: ChainEffectAnalysis;
  /** Metric for the `chains` path. Default nRMSE (lower is better). */
  metric?: ChainMetric;
  defaultLens?: ScoreLens;
  defaultSelectedToken?: string;
  width?: number;
  title?: string;
  className?: string;
  roleColors?: Partial<Record<ChainStepRole, string>>;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function fmtDelta(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : "−"}${fmt(Math.abs(value))}`;
}

interface Universe {
  sources: string[];
  datasets: string[];
  roles: ChainStepRole[];
}

function toggle(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/**
 * Interactive chain-effect explorer — the flagship that turns a corpus of
 * hundreds of scored chains into the influence of each node in a single
 * component. Pick a normalization lens, filter by source / dataset / role, and
 * click a node in the forest to isolate it: its with/without distribution
 * shift, its early/mid/late position profile, the predecessor × successor order
 * matrix, and its best neighbouring contexts. Local UI state only — no app
 * state, network, storage, or runtime execution. Ships with
 * `nirs4all-ui/assets/chains.css`.
 */
export function ChainExplorer({
  chains,
  analysis: providedAnalysis,
  metric = DEFAULT_METRIC,
  defaultLens = "rankByDataset",
  defaultSelectedToken,
  width = 1120,
  title = "Chain effect explorer",
  className,
  roleColors,
}: ChainExplorerProps) {
  const rawMode = Array.isArray(chains);
  const [lens, setLens] = useState<ScoreLens>(rawMode ? defaultLens : (providedAnalysis?.lens ?? defaultLens));
  const [sortBy, setSortBy] = useState<ForestSort>("delta");
  const [positionMode, setPositionMode] = useState<PositionMode>("phase");
  const [excludedSources, setExcludedSources] = useState<ReadonlySet<string>>(new Set());
  const [excludedDatasets, setExcludedDatasets] = useState<ReadonlySet<string>>(new Set());
  const [excludedRoles, setExcludedRoles] = useState<ReadonlySet<string>>(new Set());
  const [selectedTokenState, setSelectedTokenState] = useState<string | null>(defaultSelectedToken ?? null);

  const universe: Universe = useMemo(() => {
    if (rawMode && chains) {
      const roles = new Set<ChainStepRole>();
      for (const chain of chains) for (const step of chain.steps) roles.add(step.role);
      return {
        sources: uniqueStrings(chains.map((chain) => chain.source ?? "∗")),
        datasets: uniqueStrings(chains.map((chain) => chain.dataset ?? "∗")),
        roles: [...roles],
      };
    }
    const base = providedAnalysis;
    return {
      sources: base ? [...base.sources] : [],
      datasets: base ? [...base.datasets] : [],
      roles: base ? [...base.roles] : [],
    };
  }, [rawMode, chains, providedAnalysis]);

  const analysis: ChainEffectAnalysis | null = useMemo(() => {
    if (rawMode && chains) {
      const filtered = chains.filter(
        (chain) =>
          !excludedSources.has(chain.source ?? "∗") && !excludedDatasets.has(chain.dataset ?? "∗"),
      );
      return fromScoredChains(filtered, { metric, lens });
    }
    if (providedAnalysis) {
      const filtered = providedAnalysis.points.filter(
        (point) => !excludedSources.has(point.source) && !excludedDatasets.has(point.dataset),
      );
      return buildAnalysis(filtered, { metric: providedAnalysis.metric, lens: providedAnalysis.lens });
    }
    return null;
  }, [rawMode, chains, providedAnalysis, metric, lens, excludedSources, excludedDatasets]);

  const activeRoles = universe.roles.filter((role) => !excludedRoles.has(role));
  const forestRoles = activeRoles.length > 0 ? activeRoles : universe.roles;

  const visibleTokens = useMemo(
    () => (analysis ? analysis.tokens.filter((token) => forestRoles.includes(token.role)) : []),
    [analysis, forestRoles],
  );

  const selectedToken =
    selectedTokenState && visibleTokens.some((token) => token.token === selectedTokenState)
      ? selectedTokenState
      : visibleTokens[0]?.token ?? null;
  const selectedEffect = analysis?.tokens.find((token) => token.token === selectedToken) ?? null;

  const position = useMemo(
    () => (analysis ? positionMatrix(analysis, { mode: positionMode, minCount: 3 }) : null),
    [analysis, positionMode],
  );
  const sequence = useMemo(
    () => (analysis ? sequenceMatrix(analysis, { minCount: 3, maxTokens: 7 }) : null),
    [analysis],
  );
  const contexts = useMemo(
    () => (analysis && selectedToken ? tokenContexts(analysis, selectedToken, { minCount: 3 }) : null),
    [analysis, selectedToken],
  );

  if (!analysis || analysis.total === 0) {
    return (
      <div className={cx("n4chains-explorer", className)} style={{ width }}>
        <div className="n4chains-empty">No chains to analyze.</div>
      </div>
    );
  }

  const halfRange =
    Math.max(
      Math.abs(analysis.goodnessExtent.max - analysis.baseline),
      Math.abs(analysis.baseline - analysis.goodnessExtent.min),
    ) || 1;

  const renderContexts = (rows: readonly ContextRow[], verb: string) => {
    if (rows.length === 0) return <p className="n4chains-ctx-empty">Not enough data.</p>;
    const top = rows.slice(0, 5);
    return (
      <ul className="n4chains-ctx-list">
        {top.map((row) => {
          const t = clamp((row.stat.median - analysis.goodnessExtent.min) / (analysis.goodnessExtent.max - analysis.goodnessExtent.min || 1), 0, 1);
          return (
            <li key={row.token} className="n4chains-ctx-row">
              <span className="n4chains-ctx-name">
                <span className="n4chains-chip-dom" style={{ background: roleColor(row.role, roleColors) }} />
                {verb} {row.label}
              </span>
              <span className="n4chains-ctx-bar">
                <span
                  className="n4chains-ctx-fill"
                  style={{ width: `${(t * 100).toFixed(1)}%`, background: effectColor(row.stat.median, analysis.baseline, halfRange) }}
                />
              </span>
              <span className={cx("n4chains-ctx-delta", row.delta >= 0 ? "is-up" : "is-down")}>{fmtDelta(row.delta)}</span>
              <span className="n4chains-ctx-n">n={row.stat.n}</span>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className={cx("n4chains-explorer", className)} style={{ width }}>
      <header className="n4chains-toolbar">
        <div className="n4chains-toolbar-main">
          <h3 className="n4chains-heading">{title}</h3>
          <div className="n4chains-summary">
            <span className="n4chains-stat"><strong>{analysis.total}</strong> chains</span>
            <span className="n4chains-stat"><strong>{analysis.datasets.length}</strong> datasets</span>
            <span className="n4chains-stat"><strong>{analysis.sources.length}</strong> sources</span>
            <span className="n4chains-stat"><strong>{analysis.tokens.length}</strong> nodes</span>
            <span className="n4chains-stat n4chains-stat--metric">{analysis.metric.label}</span>
          </div>
        </div>
        <div className="n4chains-toolbar-controls">
          <div className="n4chains-seg" role="group" aria-label="Normalization lens">
            {LENS_ORDER.map((option) => (
              <button
                key={option}
                type="button"
                className={cx("n4chains-seg-btn", lens === option && "is-active")}
                aria-pressed={lens === option}
                disabled={!rawMode && option !== analysis.lens}
                onClick={() => rawMode && setLens(option)}
              >
                {CHAIN_LENS_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="n4chains-filters">
        <FilterGroup
          label="Role"
          options={universe.roles.map((role) => ({ key: role, label: CHAIN_ROLE_LABELS[role], color: roleColor(role, roleColors) }))}
          excluded={excludedRoles}
          onToggle={(key) => setExcludedRoles((prev) => toggle(prev, key))}
        />
        {universe.sources.length > 1 ? (
          <FilterGroup
            label="Source"
            options={universe.sources.map((source) => ({ key: source, label: source }))}
            excluded={excludedSources}
            onToggle={(key) => setExcludedSources((prev) => toggle(prev, key))}
          />
        ) : null}
        {universe.datasets.length > 1 ? (
          <FilterGroup
            label="Dataset"
            options={universe.datasets.map((dataset) => ({ key: dataset, label: dataset }))}
            excluded={excludedDatasets}
            onToggle={(key) => setExcludedDatasets((prev) => toggle(prev, key))}
          />
        ) : null}
      </div>

      <div className="n4chains-cols">
        <section className="n4chains-panel n4chains-panel--forest">
          <div className="n4chains-panel-head">
            <span>Node influence ranking</span>
            <div className="n4chains-seg n4chains-seg--sm" role="group" aria-label="Sort">
              {(["delta", "median", "coverage"] as ForestSort[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cx("n4chains-seg-btn", sortBy === option && "is-active")}
                  aria-pressed={sortBy === option}
                  onClick={() => setSortBy(option)}
                >
                  {option === "delta" ? "Δ effect" : option === "median" ? "median" : "coverage"}
                </button>
              ))}
            </div>
          </div>
          <NodeEffectForest
            analysis={analysis}
            roles={forestRoles}
            sortBy={sortBy}
            selectedToken={selectedToken}
            onSelectToken={setSelectedTokenState}
            width={Math.round(width * 0.44)}
            hideTitle
            roleColors={roleColors}
          />
        </section>

        <section className="n4chains-panel n4chains-panel--detail">
          {selectedEffect ? (
            <>
              <div className="n4chains-detail-head">
                <span className="n4chains-chip-dom" style={{ background: roleColor(selectedEffect.role, roleColors) }} />
                <strong>{selectedEffect.label}</strong>
                <span className="n4chains-detail-role">{CHAIN_ROLE_LABELS[selectedEffect.role]}</span>
                <span className={cx("n4chains-detail-delta", selectedEffect.delta >= 0 ? "is-up" : "is-down")}>
                  {fmtDelta(selectedEffect.delta)} vs without
                </span>
                <span className="n4chains-detail-cov">{Math.round(selectedEffect.coverage * 100)}% of chains</span>
              </div>
              <ChainScoreBeeswarm
                analysis={analysis}
                focusToken={selectedEffect.token}
                width={Math.round(width * 0.5)}
                height={200}
              />
              <div className="n4chains-ctx">
                <div className="n4chains-ctx-col">
                  <span className="n4chains-ctx-title">Best when placed after…</span>
                  {contexts ? renderContexts(contexts.predecessors, "after") : null}
                </div>
                <div className="n4chains-ctx-col">
                  <span className="n4chains-ctx-title">Best when followed by…</span>
                  {contexts ? renderContexts(contexts.successors, "before") : null}
                </div>
              </div>
            </>
          ) : (
            <p className="n4chains-ctx-empty">Select a node to inspect its influence.</p>
          )}
        </section>
      </div>

      <div className="n4chains-cols n4chains-cols--matrices">
        <section className="n4chains-panel">
          <div className="n4chains-panel-head">
            <span>Effect by position</span>
            <div className="n4chains-seg n4chains-seg--sm" role="group" aria-label="Position mode">
              {(["phase", "absolute"] as PositionMode[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  className={cx("n4chains-seg-btn", positionMode === option && "is-active")}
                  aria-pressed={positionMode === option}
                  onClick={() => setPositionMode(option)}
                >
                  {option === "phase" ? "early/mid/late" : "1st/2nd/…"}
                </button>
              ))}
            </div>
          </div>
          {position ? (
            <PositionEffectHeatmap
              matrix={position}
              width={Math.round(width * 0.47)}
              selectedToken={selectedToken}
              onSelectToken={setSelectedTokenState}
              hideTitle
              roleColors={roleColors}
            />
          ) : null}
        </section>
        <section className="n4chains-panel">
          <div className="n4chains-panel-head">
            <span>Effect by order</span>
            <span className="n4chains-panel-note">preprocessing stack · top nodes</span>
          </div>
          {sequence ? <SequenceEffectHeatmap matrix={sequence} width={Math.round(width * 0.47)} hideTitle roleColors={roleColors} /> : null}
        </section>
      </div>
    </div>
  );
}

interface FilterOption {
  key: string;
  label: string;
  color?: string;
}

function FilterGroup({
  label,
  options,
  excluded,
  onToggle,
}: {
  label: string;
  options: readonly FilterOption[];
  excluded: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  return (
    <div className="n4chains-filter-group">
      <span className="n4chains-filter-label">{label}</span>
      <div className="n4chains-filter-chips">
        {options.map((option) => {
          const active = !excluded.has(option.key);
          return (
            <button
              key={option.key}
              type="button"
              className={cx("n4chains-fchip", active ? "is-active" : "is-off")}
              aria-pressed={active}
              onClick={() => onToggle(option.key)}
            >
              {option.color ? <span className="n4chains-chip-dom" style={{ background: option.color }} /> : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

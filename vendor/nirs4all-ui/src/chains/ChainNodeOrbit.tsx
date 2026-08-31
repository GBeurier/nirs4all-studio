import { useMemo, useState } from "react";

import { round } from "../viz/geometry.js";
import { cx } from "./_cx.js";
import { nodeFlow } from "./analysis.js";
import { effectColor, effectTextColor, roleColor } from "./colors.js";
import { annularSector, labelRotation, polar, START, TAU, treeDepth } from "./radial.js";
import type { ChainEffectAnalysis, ChainStepRole, FlowNode, NeighborLink } from "./types.js";
import { CHAIN_LENS_LABELS, CHAIN_ROLE_LABELS } from "./types.js";

export interface ChainNodeOrbitProps {
  analysis: ChainEffectAnalysis;
  /** Starting focus node; defaults to the highest-coverage node (the hub). */
  defaultFocusToken?: string;
  /** Step roles to include. Default: every role present. */
  roles?: readonly ChainStepRole[] | undefined;
  /** Outward successor rings (1–3). Default `2`. */
  depth?: number;
  /** Keep the top-N children per node. Default `6`. */
  maxPerLevel?: number;
  /** Minimum chains for a wedge. Default `2`. */
  minCount?: number;
  size?: number;
  /** Notified whenever the focus changes (navigation). */
  onFocusChange?: (token: string) => void;
  title?: string;
  className?: string;
  roleColors?: Partial<Record<ChainStepRole, string>> | undefined;
}

interface Wedge {
  key: string;
  token: string;
  label: string;
  role: ChainStepRole;
  median: number;
  count: number;
  ring: number;
  a0: number;
  a1: number;
  kind: "pred" | "succ";
}

function fmt(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

/**
 * Radial flow navigator — a foldable, multi-ring sunburst. A focus node sits at
 * the centre; an inner ring shows the nodes that *precede* it, and 2–3 outer
 * rings show the *real ordered continuations* that follow (each ring one step
 * further down the pipeline), so a whole bounded chain is legible at a glance —
 * no clicking into meaningless infinity. Wedges are sized by chain count and
 * colored by the combined effect (teal = better, amber = worse). Click any
 * wedge to re-centre on that node; the breadcrumb walks back. Local UI state only.
 */
export function ChainNodeOrbit({
  analysis,
  defaultFocusToken,
  roles,
  depth = 2,
  maxPerLevel = 6,
  minCount = 2,
  size = 460,
  onFocusChange,
  title = "Node flow",
  className,
  roleColors,
}: ChainNodeOrbitProps) {
  const hub = defaultFocusToken ?? analysis.tokens[0]?.token ?? "";
  const [path, setPath] = useState<string[]>(hub ? [hub] : []);
  const focusToken = path[path.length - 1] ?? hub;

  const flow = useMemo(
    () => (path.length ? nodeFlow(analysis, path, { roles, depth, maxPerLevel, minCount }) : null),
    [analysis, path, roles, depth, maxPerLevel, minCount],
  );

  // Extend the *whole selected chain*: a successor is appended (forward), a
  // predecessor is prepended (backward). Rooting on the full ordered path means
  // an already-used node never reappears — no infinite back-and-forth.
  const extend = (wedge: Wedge) => {
    setPath((prev) => (wedge.kind === "succ" ? [...prev, wedge.token] : [wedge.token, ...prev]));
    onFocusChange?.(wedge.token);
  };
  const jumpTo = (index: number) => {
    setPath((prev) => {
      const next = prev.slice(0, index + 1);
      onFocusChange?.(next[next.length - 1] ?? hub);
      return next;
    });
  };
  const back = () => {
    if (path.length > 1) jumpTo(path.length - 2);
  };
  const reset = () => {
    if (path.length === 1 && path[0] === hub) return;
    setPath([hub]);
    onFocusChange?.(hub);
  };

  if (!flow) {
    return (
      <div className={cx("n4chains-orbit", className)} style={{ width: size }}>
        <div className="n4chains-empty">No node to explore.</div>
      </div>
    );
  }

  const cx0 = size / 2;
  const cy0 = size / 2;
  const rCenter = Math.round(size * 0.115);
  const rMax = size / 2 - 50;
  const innerStart = rCenter + 8;
  const ringGap = 3;

  const hasPred = flow.predecessors.length > 0;
  const succDepth = treeDepth(flow.successors);
  const totalRings = (hasPred ? 1 : 0) + succDepth;
  const succBase = hasPred ? 1 : 0;
  const ringW = totalRings > 0 ? (rMax - innerStart - ringGap * (totalRings - 1)) / totalRings : 0;
  const ringRadii = (ring: number): [number, number] => {
    const rIn = innerStart + ring * (ringW + ringGap);
    return [rIn, rIn + ringW];
  };

  const halfRange =
    Math.max(
      Math.abs(flow.goodnessExtent.max - flow.baseline),
      Math.abs(flow.baseline - flow.goodnessExtent.min),
    ) || 1;

  const wedges: Wedge[] = [];
  // inner predecessor ring
  if (hasPred) {
    const total = flow.predecessors.reduce((sum, link) => sum + link.count, 0);
    const pad = flow.predecessors.length > 1 ? 0.02 : 0;
    const avail = TAU - pad * flow.predecessors.length;
    let cursor = START + pad / 2;
    flow.predecessors.forEach((link: NeighborLink) => {
      const sweep = total > 0 ? (link.count / total) * avail : avail / flow.predecessors.length;
      wedges.push({
        key: `pred-${link.token}`,
        token: link.token,
        label: link.label,
        role: link.role,
        median: link.stat.median,
        count: link.count,
        ring: 0,
        a0: cursor,
        a1: cursor + sweep,
        kind: "pred",
      });
      cursor += sweep + pad;
    });
  }
  // outward successor sunburst
  const layoutSucc = (nodes: readonly FlowNode[], a0: number, a1: number, level: number) => {
    const total = nodes.reduce((sum, node) => sum + node.count, 0);
    const pad = nodes.length > 1 ? 0.014 : 0;
    const avail = a1 - a0 - pad * nodes.length;
    let cursor = a0 + pad / 2;
    for (const node of nodes) {
      const sweep = total > 0 ? (node.count / total) * avail : avail / nodes.length;
      const na0 = cursor;
      const na1 = cursor + sweep;
      cursor = na1 + pad;
      wedges.push({
        key: `succ-${level}-${node.token}-${round(na0)}`,
        token: node.token,
        label: node.label,
        role: node.role,
        median: node.stat.median,
        count: node.count,
        ring: succBase + level,
        a0: na0,
        a1: na1,
        kind: "succ",
      });
      if (node.children.length > 0) layoutSucc(node.children, na0, na1, level + 1);
    }
  };
  layoutSucc(flow.successors, START, START + TAU, 0);

  // bounded breadcrumb: home … last-3
  const crumbIndices: Array<number | "gap"> =
    path.length <= 5
      ? path.map((_, index) => index)
      : [0, "gap", path.length - 3, path.length - 2, path.length - 1];

  return (
    <div className={cx("n4chains-orbit", className)} style={{ width: size }}>
      <header className="n4chains-orbit-head">
        <span className="n4chains-orbit-chainlabel">chain</span>
        <nav className="n4chains-orbit-crumbs" aria-label="Selected chain">
          {crumbIndices.map((entry, i) => {
            if (entry === "gap") {
              return (
                <span key={`gap-${i}`} className="n4chains-crumb-wrap">
                  <span className="n4chains-crumb-sep">›</span>
                  <span className="n4chains-crumb-ellipsis">…</span>
                </span>
              );
            }
            const token = path[entry]!;
            const ref = analysis.tokens.find((item) => item.token === token);
            const isLast = entry === path.length - 1;
            return (
              <span key={`${token}-${entry}`} className="n4chains-crumb-wrap">
                {i > 0 ? <span className="n4chains-crumb-sep">›</span> : null}
                <button
                  type="button"
                  className={cx("n4chains-crumb", isLast && "is-current")}
                  onClick={() => jumpTo(entry)}
                  disabled={isLast}
                >
                  {ref?.label ?? token}
                </button>
              </span>
            );
          })}
        </nav>
        <span className="n4chains-orbit-tools">
          {path.length > 1 ? (
            <button type="button" className="n4chains-orbit-reset" onClick={reset}>
              ⟲ reset
            </button>
          ) : null}
          <span className="n4chains-orbit-caption">{CHAIN_LENS_LABELS[analysis.lens]}</span>
        </span>
      </header>

      <svg
        className={cx("n4chains", "n4chains-orbit-svg")}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={title}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{`${flow.label} — flow (${flow.predecessors.length} in, ${succDepth} level(s) out)`}</title>

        {wedges.map((wedge) => {
          const [rIn, rOut] = ringRadii(wedge.ring);
          const mid = (wedge.a0 + wedge.a1) / 2;
          const rMid = (rIn + rOut) / 2;
          const arcLen = (wedge.a1 - wedge.a0) * rMid;
          const [lx, ly] = polar(cx0, cy0, rMid, mid);
          const deg = labelRotation(mid);
          const showLabel = arcLen > 34 && ringW >= 15;
          return (
            <g
              key={wedge.key}
              className={cx("n4chains-wedge", "is-interactive", wedge.kind === "pred" && "is-pred")}
              data-role={wedge.role}
              onClick={() => extend(wedge)}
              tabIndex={0}
              role="button"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  extend(wedge);
                }
              }}
            >
              <title>{`${wedge.kind === "pred" ? "prepend (before)" : "append (after)"} · ${wedge.label} — median ${fmt(wedge.median)}, ${wedge.count} chains`}</title>
              <path
                className="n4chains-wedge-arc"
                d={annularSector(cx0, cy0, rIn, rOut, wedge.a0, wedge.a1)}
                fill={effectColor(wedge.median, flow.baseline, halfRange)}
              />
              {showLabel ? (
                <text
                  className="n4chains-wedge-label"
                  x={round(lx)}
                  y={round(ly + 3)}
                  textAnchor="middle"
                  transform={`rotate(${round(deg)} ${round(lx)} ${round(ly)})`}
                  fill={effectTextColor(wedge.median, flow.baseline, halfRange)}
                >
                  {wedge.label}
                </text>
              ) : null}
            </g>
          );
        })}

        <circle
          className={cx("n4chains-orbit-center", path.length > 1 && "is-interactive")}
          cx={cx0}
          cy={cy0}
          r={rCenter}
          fill={effectColor(flow.self.median, flow.baseline, halfRange)}
          onClick={path.length > 1 ? back : undefined}
          tabIndex={path.length > 1 ? 0 : undefined}
          role={path.length > 1 ? "button" : undefined}
          onKeyDown={
            path.length > 1
              ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    back();
                  }
                }
              : undefined
          }
        >
          <title>{path.length > 1 ? "Back to previous node" : flow.label}</title>
        </circle>
        <text
          className="n4chains-center-label"
          x={cx0}
          y={cy0 - 2}
          textAnchor="middle"
          fill={effectTextColor(flow.self.median, flow.baseline, halfRange)}
        >
          {flow.label}
        </text>
        <text
          className="n4chains-center-value"
          x={cx0}
          y={cy0 + 12}
          textAnchor="middle"
          fill={effectTextColor(flow.self.median, flow.baseline, halfRange)}
        >
          {fmt(flow.self.median)}
        </text>
      </svg>

      <footer className="n4chains-orbit-foot">
        <span className="n4chains-orbit-role">
          <span className="n4chains-chip-dom" style={{ background: roleColor(flow.role, roleColors) }} />
          {CHAIN_ROLE_LABELS[flow.role]}
        </span>
        <span className="n4chains-orbit-flow">inner = before · outer = after · click to extend</span>
        <span className="n4chains-orbit-legend" aria-hidden="true">
          <span style={{ color: "#0f766e" }}>better</span>
          <span className="n4chains-orbit-ramp" />
          <span style={{ color: "#b45309" }}>worse</span>
        </span>
      </footer>
    </div>
  );
}

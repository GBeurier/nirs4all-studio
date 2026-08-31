import { useMemo, useState } from "react";

import { round } from "../viz/geometry.js";
import { cx } from "./_cx.js";
import { nodeFlow } from "./analysis.js";
import { effectColor, effectTextColor, roleColor } from "./colors.js";
import { annularSector, labelRotation, pieSector, polar, START, TAU, treeDepth } from "./radial.js";
import type { ChainEffectAnalysis, ChainStepRole, FlowNode, NeighborLink } from "./types.js";
import { CHAIN_LENS_LABELS, CHAIN_ROLE_LABELS } from "./types.js";

export interface ChainNodeHubProps {
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

interface SuccWedge {
  key: string;
  token: string;
  label: string;
  role: ChainStepRole;
  median: number;
  count: number;
  ring: number;
  a0: number;
  a1: number;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "—";
}

/**
 * Chain hub navigator — the twin of {@link ChainNodeOrbit} with the focus on
 * the *second* ring. The centre is a pie (camembert) of every possible
 * predecessor, a band around it is the focus node itself, and the outer rings
 * are the ordered successors (2–3 levels). Reading centre → out is pipeline
 * order: predecessors converge into the hub, successors radiate away. Rooted on
 * the whole selected chain (no loops); click a centre slice to prepend, an
 * outer wedge to append, the focus band to step back, and Reset to start over.
 */
export function ChainNodeHub({
  analysis,
  defaultFocusToken,
  roles,
  depth = 2,
  maxPerLevel = 6,
  minCount = 2,
  size = 460,
  onFocusChange,
  title = "Chain hub",
  className,
  roleColors,
}: ChainNodeHubProps) {
  const hub = defaultFocusToken ?? analysis.tokens[0]?.token ?? "";
  const [path, setPath] = useState<string[]>(hub ? [hub] : []);

  const flow = useMemo(
    () => (path.length ? nodeFlow(analysis, path, { roles, depth, maxPerLevel, minCount }) : null),
    [analysis, path, roles, depth, maxPerLevel, minCount],
  );

  const prepend = (token: string) => {
    setPath((prev) => [token, ...prev]);
    onFocusChange?.(token);
  };
  const append = (token: string) => {
    setPath((prev) => [...prev, token]);
    onFocusChange?.(token);
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
      <div className={cx("n4chains-orbit", "n4chains-hub", className)} style={{ width: size }}>
        <div className="n4chains-empty">No node to explore.</div>
      </div>
    );
  }

  const cx0 = size / 2;
  const cy0 = size / 2;
  const gap = 4;
  const rCore = Math.round(size * 0.185);
  const focusRingW = Math.round(size * 0.052);
  const rFocusIn = rCore + gap;
  const rFocusOut = rFocusIn + focusRingW;
  const rMax = size / 2 - 50;
  const succStart = rFocusOut + gap;
  const succDepth = treeDepth(flow.successors);
  const ringW = succDepth > 0 ? Math.max(8, (rMax - succStart - gap * (succDepth - 1)) / succDepth) : 0;
  const succRing = (level: number): [number, number] => {
    const rIn = succStart + level * (ringW + gap);
    return [rIn, rIn + ringW];
  };

  const halfRange =
    Math.max(Math.abs(flow.goodnessExtent.max - flow.baseline), Math.abs(flow.baseline - flow.goodnessExtent.min)) || 1;

  // predecessor pie (centre)
  const preds = flow.predecessors;
  const predTotal = preds.reduce((sum, link) => sum + link.count, 0);
  const predPad = preds.length > 1 ? 0.02 : 0;
  const predAvail = TAU - predPad * preds.length;
  let pc = START + predPad / 2;
  const predSlices = preds.map((link: NeighborLink) => {
    const sweep = predTotal > 0 ? (link.count / predTotal) * predAvail : predAvail / preds.length;
    const slice = { link, a0: pc, a1: pc + sweep };
    pc += sweep + predPad;
    return slice;
  });

  // successor sunburst (outer)
  const succWedges: SuccWedge[] = [];
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
      succWedges.push({
        key: `s-${level}-${node.token}-${round(na0)}`,
        token: node.token,
        label: node.label,
        role: node.role,
        median: node.stat.median,
        count: node.count,
        ring: level,
        a0: na0,
        a1: na1,
      });
      if (node.children.length > 0) layoutSucc(node.children, na0, na1, level + 1);
    }
  };
  layoutSucc(flow.successors, START, START + TAU, 0);

  const crumbIndices: Array<number | "gap"> =
    path.length <= 5 ? path.map((_, index) => index) : [0, "gap", path.length - 3, path.length - 2, path.length - 1];

  const [flx, fly] = polar(cx0, cy0, (rFocusIn + rFocusOut) / 2, START);

  return (
    <div className={cx("n4chains-orbit", "n4chains-hub", className)} style={{ width: size }}>
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
        <title>{`${flow.label} — hub (${preds.length} predecessors, ${succDepth} level(s) of successors)`}</title>

        {/* centre pie: predecessors */}
        {preds.length === 0 ? (
          <circle className="n4chains-hub-core-empty" cx={cx0} cy={cy0} r={rCore} />
        ) : (
          predSlices.map(({ link, a0, a1 }) => {
            const mid = (a0 + a1) / 2;
            const arc = (a1 - a0) * rCore * 0.62;
            const [lx, ly] = polar(cx0, cy0, rCore * 0.62, mid);
            return (
              <g
                key={`pred-${link.token}`}
                className="n4chains-wedge is-interactive is-pred"
                data-role={link.role}
                onClick={() => prepend(link.token)}
                tabIndex={0}
                role="button"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    prepend(link.token);
                  }
                }}
              >
                <title>{`prepend (before) · ${link.label} — median ${fmt(link.stat.median)}, ${link.count} chains`}</title>
                <path className="n4chains-wedge-arc" d={pieSector(cx0, cy0, rCore, a0, a1)} fill={effectColor(link.stat.median, flow.baseline, halfRange)} />
                {arc > 30 ? (
                  <text
                    className="n4chains-wedge-label"
                    x={round(lx)}
                    y={round(ly + 3)}
                    textAnchor="middle"
                    transform={`rotate(${labelRotation(mid)} ${round(lx)} ${round(ly)})`}
                    fill={effectTextColor(link.stat.median, flow.baseline, halfRange)}
                  >
                    {link.label}
                  </text>
                ) : null}
              </g>
            );
          })
        )}

        {/* focus band (2nd ring) */}
        <g
          className={cx("n4chains-hub-focus", path.length > 1 && "is-interactive")}
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
          <title>{path.length > 1 ? `${flow.label} — click to step back` : flow.label}</title>
          <path
            className="n4chains-hub-focus-arc"
            d={annularSector(cx0, cy0, rFocusIn, rFocusOut, START + 0.0008, START + TAU - 0.0008)}
            fill={effectColor(flow.self.median, flow.baseline, halfRange)}
          />
          <text
            className="n4chains-hub-focus-label"
            x={round(flx)}
            y={round(fly + 4)}
            textAnchor="middle"
            fill={effectTextColor(flow.self.median, flow.baseline, halfRange)}
          >
            {flow.label} · {fmt(flow.self.median)}
          </text>
        </g>

        {/* outer successor rings */}
        {succWedges.map((wedge) => {
          const [rIn, rOut] = succRing(wedge.ring);
          const mid = (wedge.a0 + wedge.a1) / 2;
          const rMid = (rIn + rOut) / 2;
          const arc = (wedge.a1 - wedge.a0) * rMid;
          const [lx, ly] = polar(cx0, cy0, rMid, mid);
          return (
            <g
              key={wedge.key}
              className="n4chains-wedge is-interactive"
              data-role={wedge.role}
              onClick={() => append(wedge.token)}
              tabIndex={0}
              role="button"
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  append(wedge.token);
                }
              }}
            >
              <title>{`append (after) · ${wedge.label} — median ${fmt(wedge.median)}, ${wedge.count} chains`}</title>
              <path className="n4chains-wedge-arc" d={annularSector(cx0, cy0, rIn, rOut, wedge.a0, wedge.a1)} fill={effectColor(wedge.median, flow.baseline, halfRange)} />
              {arc > 34 && ringW >= 15 ? (
                <text
                  className="n4chains-wedge-label"
                  x={round(lx)}
                  y={round(ly + 3)}
                  textAnchor="middle"
                  transform={`rotate(${labelRotation(mid)} ${round(lx)} ${round(ly)})`}
                  fill={effectTextColor(wedge.median, flow.baseline, halfRange)}
                >
                  {wedge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <footer className="n4chains-orbit-foot">
        <span className="n4chains-orbit-role">
          <span className="n4chains-chip-dom" style={{ background: roleColor(flow.role, roleColors) }} />
          {CHAIN_ROLE_LABELS[flow.role]}
        </span>
        <span className="n4chains-orbit-flow">centre = predecessors · outer = successors</span>
        <span className="n4chains-orbit-legend" aria-hidden="true">
          <span style={{ color: "#0f766e" }}>better</span>
          <span className="n4chains-orbit-ramp" />
          <span style={{ color: "#b45309" }}>worse</span>
        </span>
      </footer>
    </div>
  );
}

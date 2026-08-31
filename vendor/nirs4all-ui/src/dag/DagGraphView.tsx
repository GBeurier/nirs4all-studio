import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { clamp, round } from "../viz/geometry.js";
import { cx } from "./_cx.js";
import { categoryColor, DAG_CATEGORY_LABELS, DAG_EDGE_COLORS } from "./colors.js";
import {
  collapseAtDepth,
  computeEffectiveGraph,
  defaultCollapsed,
  type EffEdge,
} from "./collapse.js";
import { ancestorGroupIds, buildHierarchy } from "./hierarchy.js";
import { layoutDag, type DagLayout, type DagLayoutEdge, type DagLayoutFrame, type DagLayoutNode } from "./layout.js";
import { resolveLabels, type DagViewLabels } from "./locale.js";
import { GROUP_NODE_PREFIX } from "./collapse.js";
import { describeShapeDelta, formatShape, shapeChange, SHAPE_CHANGE_STYLE } from "./shape.js";
import { dagCategory, type DagCategory, type DagDirection, type DagGraph, type DagNode, type DagShape } from "./types.js";

export interface DagGraphViewProps {
  /** Compiled graph in view-model form (see `fromCompiledGraph`). */
  graph: DagGraph;
  /** Stage width in px (the SVG viewport). Default 960. */
  width?: number;
  /** Stage height in px. Default 620. */
  height?: number;
  /** Initial orientation. Default `"LR"`. */
  direction?: DagDirection;
  /** Force an initial collapse depth; omit to auto-fit to a readable size. */
  initialCollapseDepth?: number;
  title?: string;
  className?: string;
  /** Per-category color overrides. */
  colors?: Partial<Record<DagCategory, string>>;
  /** Fired when a leaf node is selected (or deselected with `null`). */
  onSelectNode?: (id: string | null) => void;
  showMinimap?: boolean;
  showLegend?: boolean;
  showInspector?: boolean;
  /** Start with dataset-shape annotations on (when the graph carries shapes). Default true. */
  showShapes?: boolean;
  labels?: Partial<DagViewLabels>;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface WorldRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const MIN_K = 0.04;
const MAX_K = 2.4;
const CULL_MARGIN = 160;

function fitTransform(layout: DagLayout, width: number, height: number): Transform {
  if (width <= 0 || height <= 0 || layout.width <= 0 || layout.height <= 0) return { x: 0, y: 0, k: 1 };
  const pad = 44;
  const k = clamp(Math.min((width - pad) / layout.width, (height - pad) / layout.height), MIN_K, 1.1);
  return { x: (width - layout.width * k) / 2, y: (height - layout.height * k) / 2, k };
}

function worldViewport(t: Transform, width: number, height: number, margin: number): WorldRect {
  return {
    x0: (-t.x - margin) / t.k,
    y0: (-t.y - margin) / t.k,
    x1: (width - t.x + margin) / t.k,
    y1: (height - t.y + margin) / t.k,
  };
}

function nodeVisible(ln: DagLayoutNode, v: WorldRect): boolean {
  return ln.x < v.x1 && ln.x + ln.w > v.x0 && ln.y < v.y1 && ln.y + ln.h > v.y0;
}

function edgeVisible(e: DagLayoutEdge, v: WorldRect): boolean {
  const minX = Math.min(e.sx, e.tx);
  const maxX = Math.max(e.sx, e.tx);
  const minY = Math.min(e.sy, e.ty);
  const maxY = Math.max(e.sy, e.ty);
  return minX < v.x1 && maxX > v.x0 && minY < v.y1 && maxY > v.y0;
}

function frameVisible(f: DagLayoutFrame, v: WorldRect): boolean {
  return f.x < v.x1 && f.x + f.w > v.x0 && f.y < v.y1 && f.y + f.h > v.y0;
}

/**
 * Interactive viewer for a compiled DAG-ML graph of any size. Layered layout,
 * pan / zoom, viewport culling and level-of-detail keep it responsive; the
 * group hierarchy makes it readable at thousands of nodes by collapsing whole
 * clusters into a single super-node. Presentational: local UI state only, no
 * app state / IO / runtime execution.
 */
export function DagGraphView({
  graph,
  width = 960,
  height = 620,
  direction: directionProp = "LR",
  initialCollapseDepth,
  title,
  className,
  colors,
  onSelectNode,
  showMinimap = true,
  showLegend = true,
  showInspector = true,
  showShapes = true,
  labels: labelsProp,
}: DagGraphViewProps) {
  const labels = resolveLabels(labelsProp);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const [direction, setDirection] = useState<DagDirection>(directionProp);
  const [shapesOn, setShapesOn] = useState<boolean>(showShapes);
  const hasShapes = useMemo(() => graph.nodes.some((n) => n.io != null), [graph.nodes]);

  const hierarchy = useMemo(() => buildHierarchy(graph), [graph]);
  const initial = useMemo(
    () => defaultCollapsed(hierarchy, graph.nodes.length, initialCollapseDepth !== undefined ? { depth: initialCollapseDepth } : {}),
    [hierarchy, graph.nodes.length, initialCollapseDepth],
  );

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(initial.collapsed);
  const [depth, setDepth] = useState<number>(initial.depth);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [query, setQuery] = useState<string>("");
  const [focusId, setFocusId] = useState<string | null>(null);

  const eff = useMemo(() => computeEffectiveGraph(graph, hierarchy, collapsed), [graph, hierarchy, collapsed]);
  const layout = useMemo(() => layoutDag(eff, { direction, hierarchy }), [eff, direction, hierarchy]);

  const [transform, setTransform] = useState<Transform>(() => fitTransform(layout, width, height));

  // keep the freshest layout / size available to imperative callbacks
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const sizeRef = useRef({ width, height });
  sizeRef.current = { width, height };

  const fit = useCallback(() => {
    setTransform(fitTransform(layoutRef.current, sizeRef.current.width, sizeRef.current.height));
  }, []);

  // reset when the graph itself changes, and re-fit on graph / orientation change
  useEffect(() => {
    setCollapsed(initial.collapsed);
    setDepth(initial.depth);
    setSelected(null);
    onSelectNode?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  useEffect(() => {
    fit();
  }, [initial, direction, fit]);

  const zoomAt = useCallback((clientX: number, clientY: number, factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    setTransform((t) => {
      const k = clamp(t.k * factor, MIN_K, MAX_K);
      const wx = (px - t.x) / t.k;
      const wy = (py - t.y) / t.k;
      return { k, x: px - wx * k, y: py - wy * k };
    });
  }, []);

  // native, non-passive wheel listener so zoom doesn't scroll the page
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const centerOn = useCallback((ln: DagLayoutNode) => {
    setTransform((t) => ({
      k: t.k,
      x: sizeRef.current.width / 2 - (ln.x + ln.w / 2) * t.k,
      y: sizeRef.current.height / 2 - (ln.y + ln.h / 2) * t.k,
    }));
  }, []);

  // once a focus target is laid out (after revealing it), center on it
  useEffect(() => {
    if (!focusId) return;
    const ln = layout.nodes.find((n) => n.node.id === focusId);
    if (ln) {
      centerOn(ln);
      setFocusId(null);
    }
  }, [focusId, layout, centerOn]);

  const expandGroup = useCallback(
    (groupId: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        for (const child of hierarchy.groups.get(groupId)?.children ?? []) next.add(child);
        return next;
      });
    },
    [hierarchy],
  );

  const collapseGroup = useCallback(
    (groupId: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.add(groupId);
        const stack = [...(hierarchy.groups.get(groupId)?.children ?? [])];
        while (stack.length) {
          const child = stack.pop() as string;
          next.delete(child);
          for (const grand of hierarchy.groups.get(child)?.children ?? []) stack.push(grand);
        }
        return next;
      });
    },
    [hierarchy],
  );

  const revealNode = useCallback(
    (nodeId: string) => {
      const ancestors = ancestorGroupIds(hierarchy, nodeId);
      if (ancestors.length === 0) return;
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const g of ancestors) next.delete(g);
        return next;
      });
    },
    [hierarchy],
  );

  const applyDepth = useCallback(
    (next: number) => {
      const clamped = clamp(next, 0, hierarchy.maxDepth + 1);
      setDepth(clamped);
      setCollapsed(collapseAtDepth(hierarchy, clamped));
    },
    [hierarchy],
  );

  const submitSearch = useCallback(() => {
    const q = query.trim().toLowerCase();
    if (!q) return;
    const match = graph.nodes.find(
      (n) =>
        n.id.toLowerCase().includes(q) ||
        (n.label ?? "").toLowerCase().includes(q) ||
        (n.kind ?? "").toLowerCase().includes(q),
    );
    if (!match) return;
    revealNode(match.id);
    setSelected(match.id);
    onSelectNode?.(match.id);
    setFocusId(match.id);
  }, [query, graph.nodes, revealNode, onSelectNode]);

  const zoomCenter = useCallback(
    (factor: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      const cx0 = (rect?.left ?? 0) + sizeRef.current.width / 2;
      const cy0 = (rect?.top ?? 0) + sizeRef.current.height / 2;
      zoomAt(cx0, cy0, factor);
    },
    [zoomAt],
  );

  // Resolve the interactive element under a screen point. Done via
  // elementFromPoint (not the click target) because the stage sets pointer
  // capture for panning, which retargets the browser `click` event to the
  // <svg> itself — so a delegated onClick never sees the node.
  const hitTarget = useCallback((clientX: number, clientY: number): Element | null => {
    if (typeof document === "undefined") return null;
    return document.elementFromPoint(clientX, clientY)?.closest("[data-collapse-group],[data-node-id]") ?? null;
  }, []);

  const activate = useCallback(
    (el: Element | null) => {
      if (!el) {
        setSelected(null);
        onSelectNode?.(null);
        return;
      }
      const collapseId = el.getAttribute("data-collapse-group");
      if (collapseId) {
        collapseGroup(collapseId);
        return;
      }
      const nodeId = el.getAttribute("data-node-id");
      if (!nodeId) return;
      const groupId = el.getAttribute("data-group-id");
      if (groupId) {
        expandGroup(groupId);
      } else {
        setSelected(nodeId);
        onSelectNode?.(nodeId);
      }
    },
    [collapseGroup, expandGroup, onSelectNode],
  );

  const onContentOver = useCallback((e: ReactMouseEvent<SVGGElement>) => {
    const el = (e.target as Element).closest("[data-node-id]");
    setHovered(el ? el.getAttribute("data-node-id") : null);
  }, []);

  const onStagePointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      /* no active pointer to capture (e.g. synthetic events) — panning still works */
    }
  }, []);

  const onStagePointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    if (d.moved) setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
  }, []);

  const onStagePointerUp = useCallback(
    (e: ReactPointerEvent<SVGSVGElement>) => {
      const d = drag.current;
      drag.current = null;
      try {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
      } catch {
        /* pointer was never captured */
      }
      // A pan (moved) is never a click; a stationary press is a click — hit-test
      // the real element under the pointer and expand/collapse/select it.
      if (d && !d.moved) activate(hitTarget(e.clientX, e.clientY));
    },
    [activate, hitTarget],
  );

  // adjacency of the effective graph, for hover / selection emphasis
  const incident = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (node: string, edgeId: string) => {
      const set = map.get(node) ?? new Set<string>();
      set.add(edgeId);
      map.set(node, set);
    };
    for (const e of eff.edges) {
      add(e.source, e.id);
      add(e.target, e.id);
    }
    return map;
  }, [eff.edges]);

  const focusNode = hovered ?? selected;
  const emphasizedEdges = useMemo(() => (focusNode ? incident.get(focusNode) ?? new Set<string>() : null), [focusNode, incident]);
  const neighborNodes = useMemo(() => {
    if (!focusNode) return null;
    const set = new Set<string>([focusNode]);
    for (const e of eff.edges) {
      if (e.source === focusNode) set.add(e.target);
      if (e.target === focusNode) set.add(e.source);
    }
    return set;
  }, [focusNode, eff.edges]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const ln of layout.nodes) {
      const n = ln.node;
      if (n.id.toLowerCase().includes(q) || n.label.toLowerCase().includes(q) || (n.kind ?? "").toLowerCase().includes(q)) {
        set.add(n.id);
      }
    }
    return set;
  }, [query, layout.nodes]);

  const view = worldViewport(transform, width, height, CULL_MARGIN);
  const visFrames = layout.frames.filter((f) => frameVisible(f, view));
  const visEdges = layout.edges.filter((e) => edgeVisible(e, view));
  const visNodes = layout.nodes.filter((ln) => nodeVisible(ln, view));

  const screenNodeH = layout.nodeH * transform.k;
  const lod: 0 | 1 | 2 = screenNodeH >= 26 ? 2 : screenNodeH >= 14 ? 1 : 0;

  const presentCategories = useMemo(() => {
    const set = new Set<DagCategory>();
    for (const n of eff.nodes) set.add(n.category);
    return [...set];
  }, [eff.nodes]);

  const selectedNode: DagNode | null = useMemo(
    () => (selected ? graph.nodes.find((n) => n.id === selected) ?? null : null),
    [selected, graph.nodes],
  );

  const contentTransform = `translate(${round(transform.x)} ${round(transform.y)}) scale(${transform.k.toFixed(4)})`;
  const dim = matches !== null || neighborNodes !== null;

  return (
    <div
      className={cx("n4dag", className)}
      style={{ width, position: "relative" }}
      data-direction={direction}
      role="group"
      aria-label={title ?? labels.title}
    >
      <div className="n4dag__toolbar">
        <span className="n4dag__title">{title ?? graph.name ?? labels.title}</span>
        <span className="n4dag__counts">
          {eff.nodes.length}/{graph.nodes.length} {labels.nodesVisible} · {eff.edges.length} {labels.edges}
        </span>
        <span className="n4dag__spacer" />
        <form
          className="n4dag__search"
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
        >
          <input
            className="n4dag__search-input"
            type="search"
            value={query}
            placeholder={labels.search}
            aria-label={labels.search}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <div className="n4dag__group" role="group" aria-label={labels.depth}>
          <button className="n4dag__btn" type="button" onClick={() => applyDepth(depth - 1)} aria-label={`${labels.collapseAll} (−1)`} title={`${labels.depth} −`}>
            −
          </button>
          <span className="n4dag__depth" aria-live="polite">
            {labels.depth} {Math.min(depth, hierarchy.maxDepth + 1)}
          </span>
          <button className="n4dag__btn" type="button" onClick={() => applyDepth(depth + 1)} aria-label={`${labels.expandAll} (+1)`} title={`${labels.depth} +`}>
            +
          </button>
        </div>
        <button className="n4dag__btn n4dag__btn--text" type="button" onClick={() => applyDepth(0)} title={labels.collapseAll}>
          {labels.collapseAll}
        </button>
        <button className="n4dag__btn n4dag__btn--text" type="button" onClick={() => applyDepth(hierarchy.maxDepth + 1)} title={labels.expandAll}>
          {labels.expandAll}
        </button>
        {hasShapes ? (
          <button
            className={cx("n4dag__btn", "n4dag__btn--text", shapesOn && "n4dag__btn--on")}
            type="button"
            aria-pressed={shapesOn}
            onClick={() => setShapesOn((v) => !v)}
            title={labels.shapes}
          >
            {labels.shapes}
          </button>
        ) : null}
        <button
          className="n4dag__btn n4dag__btn--text"
          type="button"
          onClick={() => setDirection((d) => (d === "LR" ? "TB" : "LR"))}
          title={labels.direction}
        >
          {direction}
        </button>
        <div className="n4dag__group" role="group" aria-label="zoom">
          <button className="n4dag__btn" type="button" onClick={() => zoomCenter(1 / 1.25)} aria-label={labels.zoomOut}>
            −
          </button>
          <button className="n4dag__btn" type="button" onClick={fit} title={labels.fit} aria-label={labels.fit}>
            ⤢
          </button>
          <button className="n4dag__btn" type="button" onClick={() => zoomCenter(1.25)} aria-label={labels.zoomIn}>
            +
          </button>
        </div>
      </div>

      <div className="n4dag__stage" style={{ height }}>
        <svg
          ref={svgRef}
          className="n4dag__canvas"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="application"
          aria-label={title ?? labels.title}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
        >
          <defs>
            <marker id="n4dag-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0,0 L8,4 L0,8 z" className="n4dag__arrowhead" />
            </marker>
          </defs>

          {layout.nodes.length === 0 ? (
            <text className="n4dag__empty" x={width / 2} y={height / 2} textAnchor="middle">
              {labels.emptyGraph}
            </text>
          ) : null}

          <g
            transform={contentTransform}
            onMouseOver={onContentOver}
            onMouseLeave={() => setHovered(null)}
          >
            {/* cluster frames (outer → inner) */}
            {visFrames.map((f) => (
              <g key={`f-${f.id}`} className="n4dag__frame" data-depth={f.depth}>
                <rect className="n4dag__frame-box" x={f.x} y={f.y} width={f.w} height={f.h} rx={12} />
                <g className="n4dag__frame-header" data-collapse-group={f.id} role="button" tabIndex={-1} aria-label={`${labels.collapseAll}: ${f.label}`}>
                  <rect x={f.x} y={f.y} width={Math.min(f.w, Math.max(64, f.label.length * 7 + 26))} height={18} rx={9} className="n4dag__frame-tab" />
                  <text className="n4dag__frame-label" x={f.x + 10} y={f.y + 13}>
                    − {f.label}
                  </text>
                </g>
              </g>
            ))}

            {/* edges */}
            <g className="n4dag__edges" fill="none">
              {visEdges.map((e) => {
                const emphasized = emphasizedEdges?.has(e.edge.id) ?? false;
                const dimmed = dim && !emphasized;
                return (
                  <path
                    key={`e-${e.edge.id}`}
                    className={cx("n4dag__edge", e.edge.oof && "n4dag__edge--oof", e.back && "n4dag__edge--back", emphasized && "n4dag__edge--on", dimmed && "n4dag__edge--dim")}
                    d={e.path}
                    stroke={edgeStroke(e.edge, emphasized)}
                    strokeWidth={emphasized ? 2.4 : e.edge.oof ? 1.8 : 1.3}
                    markerEnd={lod === 2 ? "url(#n4dag-arrow)" : undefined}
                  />
                );
              })}
            </g>

            {/* shape labels on edges leaving a collapsed cluster (the shape it emits) */}
            {shapesOn && lod === 2 ? (
              <g className="n4dag__edge-shapes">
                {visEdges.map((e) =>
                  e.edge.shape && e.edge.source.startsWith(GROUP_NODE_PREFIX) && !(dim && !(emphasizedEdges?.has(e.edge.id) ?? false)) ? (
                    <EdgeShapeLabel key={`es-${e.edge.id}`} mx={(e.sx + e.tx) / 2} my={(e.sy + e.ty) / 2} shape={e.edge.shape} />
                  ) : null,
                )}
              </g>
            ) : null}

            {/* nodes */}
            <g className="n4dag__nodes">
              {visNodes.map((ln) => (
                <NodeMark
                  key={`n-${ln.node.id}`}
                  ln={ln}
                  direction={direction}
                  lod={lod}
                  colors={colors}
                  shapesOn={shapesOn}
                  selected={selected === ln.node.id}
                  hovered={hovered === ln.node.id}
                  matched={matches?.has(ln.node.id) ?? false}
                  dimmed={dim && !(neighborNodes?.has(ln.node.id) ?? false) && !(matches?.has(ln.node.id) ?? false)}
                  labels={labels}
                />
              ))}
            </g>
          </g>
        </svg>

        {showLegend && presentCategories.length > 0 ? (
          <div className="n4dag__legend" aria-label={labels.legend}>
            {presentCategories.map((c) => (
              <span key={c} className="n4dag__legend-item">
                <span className="n4dag__legend-swatch" style={{ background: categoryColor(c, colors) }} />
                {DAG_CATEGORY_LABELS[c]}
              </span>
            ))}
          </div>
        ) : null}

        {showMinimap && layout.width > 0 ? (
          <Minimap layout={layout} transform={transform} width={width} height={height} colors={colors} onRecenter={setTransform} />
        ) : null}

        {showInspector && selectedNode ? (
          <aside className="n4dag__inspector" aria-label={selectedNode.label ?? selectedNode.id}>
            <button
              className="n4dag__inspector-close"
              type="button"
              onClick={() => {
                setSelected(null);
                onSelectNode?.(null);
              }}
              aria-label={labels.close}
            >
              ×
            </button>
            <NodeInspector node={selectedNode} colors={colors} labels={labels} />
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function edgeStroke(edge: EffEdge, emphasized: boolean): string {
  if (emphasized && edge.kind) return DAG_EDGE_COLORS[edge.kind];
  if (edge.oof) return DAG_EDGE_COLORS.prediction;
  return "currentColor";
}

function EdgeShapeLabel({ mx, my, shape }: { mx: number; my: number; shape: DagShape }) {
  const text = formatShape(shape);
  const wpx = text.length * 6.1 + 12;
  return (
    <g className="n4dag__edge-shape" transform={`translate(${round(mx)} ${round(my)})`}>
      <rect className="n4dag__edge-shape-bg" x={round(-wpx / 2)} y={-8} width={round(wpx)} height={16} rx={5} />
      <text className="n4dag__edge-shape-text" x={0} y={4} textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

interface NodeMarkProps {
  ln: DagLayoutNode;
  direction: DagDirection;
  lod: 0 | 1 | 2;
  colors: Partial<Record<DagCategory, string>> | undefined;
  shapesOn: boolean;
  selected: boolean;
  hovered: boolean;
  matched: boolean;
  dimmed: boolean;
  labels: DagViewLabels;
}

function NodeMark({ ln, direction, lod, colors, shapesOn, selected, hovered, matched, dimmed, labels }: NodeMarkProps) {
  const { node, x, y, w, h } = ln;
  const color = categoryColor(node.category, colors);
  const shape = !node.isGroup && shapesOn ? node.outShape : undefined;
  const change = shape ? shapeChange(node.inShapes ?? [], shape) : "none";
  const changeStyle = SHAPE_CHANGE_STYLE[change];
  const hasSub = node.isGroup || !!node.detail || !!shape;
  const active = selected || hovered || matched;

  const dataAttrs: Record<string, string> = { "data-node-id": node.id };
  if (node.isGroup && node.groupId) dataAttrs["data-group-id"] = node.groupId;

  if (lod === 0) {
    return (
      <rect
        {...dataAttrs}
        className={cx("n4dag__node-lod", dimmed && "n4dag__node--dim")}
        x={x}
        y={y}
        width={w}
        height={h}
        rx={3}
        fill={color}
        fillOpacity={matched ? 0.95 : 0.62}
        stroke={selected ? color : "none"}
        strokeWidth={selected ? 3 : 0}
      />
    );
  }

  return (
    <g
      {...dataAttrs}
      className={cx(
        "n4dag__node",
        node.isGroup && "n4dag__node--group",
        selected && "n4dag__node--selected",
        hovered && "n4dag__node--hover",
        matched && "n4dag__node--match",
        dimmed && "n4dag__node--dim",
      )}
      data-category={node.category}
      role="button"
      aria-label={node.label}
    >
      {node.isGroup ? (
        <>
          <rect x={x + 5} y={y + 5} width={w} height={h} rx={9} className="n4dag__node-stack" fill={color} />
          <rect x={x + 2.5} y={y + 2.5} width={w} height={h} rx={9} className="n4dag__node-stack" fill={color} />
        </>
      ) : null}

      <rect
        className="n4dag__node-card"
        x={x}
        y={y}
        width={w}
        height={h}
        rx={9}
        fill={`color-mix(in srgb, ${color} ${node.isGroup ? 20 : 12}%, var(--n4dag-node-bg, #ffffff))`}
        stroke={color}
        strokeOpacity={active ? 1 : 0.7}
        strokeWidth={selected ? 2.2 : active ? 1.6 : 1}
      />

      {direction === "LR" ? (
        <rect className="n4dag__node-accent" x={x} y={y + 8} width={4} height={h - 16} rx={2} fill={color} />
      ) : (
        <rect className="n4dag__node-accent" x={x + 8} y={y} width={w - 16} height={4} rx={2} fill={color} />
      )}

      <text className="n4dag__node-label" x={x + 14} y={hasSub ? y + h / 2 - 3 : y + h / 2 + 4}>
        {truncate(node.label, direction === "LR" ? 22 : 20)}
      </text>

      {lod === 2 && node.isGroup ? (
        <text className="n4dag__node-sub" x={x + 14} y={y + h / 2 + 12}>
          {node.childCount} {labels.contains}
        </text>
      ) : null}
      {lod === 2 && !node.isGroup && shape ? (
        <text className="n4dag__node-shape" x={x + 14} y={y + h / 2 + 12} fill={changeStyle.tone || undefined}>
          {changeStyle.glyph ? `${changeStyle.glyph} ` : ""}
          {truncate(formatShape(shape), direction === "LR" ? 22 : 20)}
        </text>
      ) : lod === 2 && !node.isGroup && node.detail ? (
        <text className="n4dag__node-sub" x={x + 14} y={y + h / 2 + 12}>
          {truncate(node.detail, direction === "LR" ? 24 : 22)}
        </text>
      ) : null}

      {node.isGroup ? (
        <text className="n4dag__node-expand" x={x + w - 12} y={y + 16} textAnchor="end">
          +
        </text>
      ) : null}

      {shape && change !== "none" ? (
        <circle
          className="n4dag__node-port"
          cx={direction === "LR" ? x + w : x + w / 2}
          cy={direction === "LR" ? y + h / 2 : y + h}
          r={3.5}
          fill={changeStyle.tone}
        >
          <title>{formatShape(shape)}</title>
        </circle>
      ) : null}

      {lod === 2 && node.status ? <circle className="n4dag__node-status" data-status={node.status} cx={x + w - 12} cy={y + 12} r={4} /> : null}

      {lod === 2 && node.variants != null && node.variants > 1 ? (
        <text className="n4dag__node-badge" x={x + w - 10} y={y + h - 8} textAnchor="end">
          ×{node.variants}
        </text>
      ) : null}
    </g>
  );
}

interface MinimapProps {
  layout: DagLayout;
  transform: Transform;
  width: number;
  height: number;
  colors: Partial<Record<DagCategory, string>> | undefined;
  onRecenter: (updater: (t: Transform) => Transform) => void;
}

function Minimap({ layout, transform, width, height, colors, onRecenter }: MinimapProps) {
  const boxW = 188;
  const boxH = 128;
  const scale = Math.min(boxW / layout.width, boxH / layout.height);
  const mw = layout.width * scale;
  const mh = layout.height * scale;
  const view = worldViewport(transform, width, height, 0);

  // node dots are static per layout — recompute only when the layout changes,
  // not on every pan/zoom (which only moves the viewport rectangle)
  const dots = useMemo(() => {
    const step = Math.max(1, Math.ceil(layout.nodes.length / 900));
    const out: Array<{ id: string; x: number; y: number; w: number; h: number; fill: string }> = [];
    layout.nodes.forEach((ln, i) => {
      if (i % step !== 0) return;
      out.push({
        id: ln.node.id,
        x: ln.x * scale,
        y: ln.y * scale,
        w: Math.max(1.5, ln.w * scale),
        h: Math.max(1.5, ln.h * scale),
        fill: categoryColor(ln.node.category, colors),
      });
    });
    return out;
  }, [layout, scale, colors]);

  const recenter = (e: ReactPointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const wx = (e.clientX - rect.left) / scale;
    const wy = (e.clientY - rect.top) / scale;
    onRecenter((t) => ({ k: t.k, x: width / 2 - wx * t.k, y: height / 2 - wy * t.k }));
  };

  return (
    <svg
      className="n4dag__minimap"
      width={mw}
      height={mh}
      viewBox={`0 0 ${round(mw)} ${round(mh)}`}
      aria-hidden="true"
      onPointerDown={recenter}
      onPointerMove={(e) => {
        if (e.buttons === 1) recenter(e);
      }}
    >
      <rect className="n4dag__minimap-bg" x={0} y={0} width={mw} height={mh} rx={4} />
      {dots.map((d) => (
        <rect key={d.id} x={d.x} y={d.y} width={d.w} height={d.h} fill={d.fill} fillOpacity={0.75} />
      ))}
      <rect
        className="n4dag__minimap-view"
        x={round(clamp(view.x0 * scale, 0, mw))}
        y={round(clamp(view.y0 * scale, 0, mh))}
        width={round(clamp((view.x1 - view.x0) * scale, 0, mw))}
        height={round(clamp((view.y1 - view.y0) * scale, 0, mh))}
      />
    </svg>
  );
}

function ShapeRow({ tag, shape, out }: { tag: string; shape: DagShape; out?: boolean }) {
  return (
    <div className={cx("n4dag__io-row", out && "n4dag__io-row--out")}>
      <span className="n4dag__io-tag">{tag}</span>
      <span className="n4dag__io-shape n4dag__mono">{formatShape(shape)}</span>
      {shape.representation && shape.representation !== "prediction" ? <span className="n4dag__io-rep">{shape.representation}</span> : null}
      {shape.note ? <span className="n4dag__io-note">{shape.note}</span> : null}
      {shape.sources && shape.sources.length > 1 ? (
        <span className="n4dag__io-sources">{shape.sources.map((s) => `${s.name} (${s.features ?? "?"})`).join(" · ")}</span>
      ) : null}
    </div>
  );
}

function NodeInspector({ node, colors, labels }: { node: DagNode; colors: Partial<Record<DagCategory, string>> | undefined; labels: DagViewLabels }) {
  const color = categoryColor(dagCategory(node.kind), colors);
  const metaEntries = node.meta ? Object.entries(node.meta).slice(0, 12) : [];
  const io = node.io;
  const inputs = io?.in ?? [];
  const delta = io?.out ? describeShapeDelta(inputs, io.out) : null;
  return (
    <div className="n4dag__inspector-body">
      <div className="n4dag__inspector-head">
        <span className="n4dag__inspector-dot" style={{ background: color }} />
        <span className="n4dag__inspector-title">{node.label ?? node.id}</span>
      </div>

      {io && (inputs.length > 0 || io.out) ? (
        <div className="n4dag__io">
          <div className="n4dag__io-title">{labels.shape}</div>
          {inputs.map((s, i) => (
            <ShapeRow key={`in-${i}`} tag={inputs.length > 1 ? `${labels.shapeIn} ${i + 1}` : labels.shapeIn} shape={s} />
          ))}
          {io.out ? <ShapeRow tag={labels.shapeOut} shape={io.out} out /> : null}
          {delta ? <div className="n4dag__io-delta">{delta}</div> : null}
        </div>
      ) : null}

      <dl className="n4dag__inspector-dl">
        <div>
          <dt>id</dt>
          <dd className="n4dag__mono">{node.id}</dd>
        </div>
        {node.kind ? (
          <div>
            <dt>kind</dt>
            <dd>{node.kind}</dd>
          </div>
        ) : null}
        {node.detail ? (
          <div>
            <dt>detail</dt>
            <dd>{node.detail}</dd>
          </div>
        ) : null}
        {node.status ? (
          <div>
            <dt>status</dt>
            <dd>{node.status}</dd>
          </div>
        ) : null}
        {node.metric != null ? (
          <div>
            <dt>metric</dt>
            <dd className="n4dag__mono">{node.metric}</dd>
          </div>
        ) : null}
        {node.variants != null ? (
          <div>
            <dt>variants</dt>
            <dd className="n4dag__mono">{node.variants}</dd>
          </div>
        ) : null}
        {metaEntries.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="n4dag__mono">{formatMeta(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function formatMeta(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

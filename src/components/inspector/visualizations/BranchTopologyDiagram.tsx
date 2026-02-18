/**
 * BranchTopologyDiagram — DAG diagram of pipeline structure with metrics overlay.
 *
 * Renders topology nodes as rounded rects, color-coded by type.
 * Model nodes show score badges. Edges connect parent/children.
 * Click model node → select matching chains.
 * Custom SVG (tree layout).
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import type { BranchTopologyResponse, TopologyNode } from '@/types/inspector';

interface BranchTopologyDiagramProps {
  data: BranchTopologyResponse | null | undefined;
  isLoading: boolean;
}

interface LayoutNode {
  node: TopologyNode;
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutNode[];
}

interface HoveredNode {
  node: TopologyNode;
  mouseX: number;
  mouseY: number;
}

const NODE_COLORS: Record<TopologyNode['type'], string> = {
  data: '#64748b',
  transform: '#2563eb',
  splitter: '#d97706',
  model: '#0d9488',
  merge: '#7c3aed',
  branch: '#ea580c',
};

const NODE_WIDTH = 120;
const NODE_HEIGHT = 36;
const H_GAP = 30;
const V_GAP = 50;

function layoutTree(nodes: TopologyNode[], startX: number, startY: number): { layoutNodes: LayoutNode[]; totalWidth: number; totalHeight: number } {
  if (nodes.length === 0) return { layoutNodes: [], totalWidth: 0, totalHeight: 0 };

  // Recursively compute subtree widths
  function computeWidth(node: TopologyNode): number {
    if (!node.children?.length) return NODE_WIDTH;
    let sum = 0;
    for (const child of node.children) {
      if (sum > 0) sum += H_GAP;
      sum += computeWidth(child);
    }
    return Math.max(NODE_WIDTH, sum);
  }

  function buildLayout(node: TopologyNode, cx: number, y: number): LayoutNode {
    const subtreeW = computeWidth(node);
    const x = cx - NODE_WIDTH / 2;

    const childLayouts: LayoutNode[] = [];
    if (node.children?.length) {
      let childX = cx - subtreeW / 2;
      for (const child of node.children) {
        const childW = computeWidth(child);
        const childCx = childX + childW / 2;
        childLayouts.push(buildLayout(child, childCx, y + NODE_HEIGHT + V_GAP));
        childX += childW + H_GAP;
      }
    }

    return {
      node,
      x,
      y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      children: childLayouts,
    };
  }

  // Layout root nodes side by side
  let totalW = 0;
  for (const n of nodes) {
    if (totalW > 0) totalW += H_GAP;
    totalW += computeWidth(n);
  }

  const results: LayoutNode[] = [];
  let currentX = startX;
  for (const node of nodes) {
    const w = computeWidth(node);
    const cx = currentX + w / 2;
    results.push(buildLayout(node, cx, startY));
    currentX += w + H_GAP;
  }

  // Compute bounding box
  let maxY = startY;
  function findMaxY(ln: LayoutNode) {
    if (ln.y + ln.height > maxY) maxY = ln.y + ln.height;
    for (const c of ln.children) findMaxY(c);
  }
  for (const r of results) findMaxY(r);

  return { layoutNodes: results, totalWidth: totalW, totalHeight: maxY - startY + 20 };
}

function collectEdges(layoutNode: LayoutNode): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const edges: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  for (const child of layoutNode.children) {
    edges.push({
      x1: layoutNode.x + layoutNode.width / 2,
      y1: layoutNode.y + layoutNode.height,
      x2: child.x + child.width / 2,
      y2: child.y,
    });
    edges.push(...collectEdges(child));
  }
  return edges;
}

function collectAllNodes(layoutNodes: LayoutNode[]): LayoutNode[] {
  const result: LayoutNode[] = [];
  function collect(ln: LayoutNode) {
    result.push(ln);
    for (const c of ln.children) collect(c);
  }
  for (const ln of layoutNodes) collect(ln);
  return result;
}

export function BranchTopologyDiagram({ data, isLoading }: BranchTopologyDiagramProps) {
  const { select } = useInspectorSelection();
  const containerRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<HoveredNode | null>(null);
  const [dims, setDims] = useState({ width: 600, height: 400 });

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) setDims({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { layoutNodes, edges, allNodes, svgWidth, svgHeight } = useMemo(() => {
    if (!data?.nodes?.length) {
      return { layoutNodes: [], edges: [], allNodes: [], svgWidth: dims.width, svgHeight: dims.height };
    }

    const padding = 20;
    const { layoutNodes: lns, totalWidth, totalHeight } = layoutTree(data.nodes, padding, padding);

    const edgeList: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    for (const ln of lns) edgeList.push(...collectEdges(ln));

    const all = collectAllNodes(lns);
    const w = Math.max(totalWidth + padding * 2, dims.width);
    const h = Math.max(totalHeight + padding * 2, dims.height);

    return { layoutNodes: lns, edges: edgeList, allNodes: all, svgWidth: w, svgHeight: h };
  }, [data, dims]);

  const handleNodeClick = useCallback((node: TopologyNode) => {
    if (node.chain_ids?.length) {
      select(node.chain_ids, 'toggle');
    }
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading topology data...</span>
      </div>
    );
  }

  if (allNodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        No branch topology data available.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-auto">
      <svg width={svgWidth} height={svgHeight} className="select-none">
        {/* Edges */}
        {edges.map((edge, i) => (
          <path
            key={i}
            d={`M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + V_GAP / 2}, ${edge.x2} ${edge.y2 - V_GAP / 2}, ${edge.x2} ${edge.y2}`}
            fill="none"
            stroke="#475569"
            strokeWidth={1.5}
            opacity={0.5}
          />
        ))}

        {/* Nodes */}
        {allNodes.map((ln) => {
          const { node, x, y, width, height } = ln;
          const color = NODE_COLORS[node.type] ?? '#64748b';
          const isHov = hovered?.node.id === node.id;
          const hasChains = (node.chain_ids?.length ?? 0) > 0;
          const hasScore = node.metrics?.mean_score != null;

          return (
            <g
              key={node.id}
              cursor={hasChains ? 'pointer' : 'default'}
              onClick={() => handleNodeClick(node)}
              onMouseEnter={(e) => setHovered({ node, mouseX: e.clientX, mouseY: e.clientY })}
              onMouseLeave={() => setHovered(null)}
            >
              {/* Node rect */}
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                rx={6}
                fill={color}
                fillOpacity={isHov ? 0.35 : 0.2}
                stroke={color}
                strokeWidth={isHov ? 2 : 1.5}
              />

              {/* Node label */}
              <text
                x={x + width / 2}
                y={y + (hasScore ? height * 0.4 : height / 2)}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-foreground"
                fontSize={10}
                fontWeight={500}
              >
                {node.label.length > 14 ? node.label.slice(0, 12) + '…' : node.label}
              </text>

              {/* Score badge for model nodes */}
              {hasScore && (
                <text
                  x={x + width / 2}
                  y={y + height * 0.72}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={color}
                  fontSize={9}
                  fontWeight={600}
                >
                  {node.metrics!.mean_score!.toFixed(4)}
                </text>
              )}

              {/* Type indicator */}
              <circle
                cx={x + 10}
                cy={y + height / 2}
                r={3}
                fill={color}
              />
            </g>
          );
        })}

        {/* Pipeline name */}
        {data?.pipeline_name && (
          <text
            x={10}
            y={svgHeight - 8}
            className="fill-muted-foreground"
            fontSize={9}
            opacity={0.6}
          >
            Pipeline: {data.pipeline_name}
          </text>
        )}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
          style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 60 }}
        >
          <div className="font-medium">{hovered.node.label}</div>
          <div className="capitalize">Type: {hovered.node.type}</div>
          <div>Depth: {hovered.node.depth}</div>
          {hovered.node.metrics && (
            <>
              {hovered.node.metrics.mean_score != null && (
                <div>Mean score: {hovered.node.metrics.mean_score.toFixed(4)}</div>
              )}
              <div>Chains: {hovered.node.metrics.chain_count}</div>
            </>
          )}
          {hovered.node.chain_ids && (
            <div className="text-[10px] mt-1 opacity-70">Click to select</div>
          )}
        </div>
      )}
    </div>
  );
}

import type { BranchTopologyResponse, TopologyNode } from '@/types/inspector';

export const BRANCH_TOPOLOGY_NODE_WIDTH = 120;
export const BRANCH_TOPOLOGY_NODE_HEIGHT = 36;
export const BRANCH_TOPOLOGY_HORIZONTAL_GAP = 30;
export const BRANCH_TOPOLOGY_VERTICAL_GAP = 50;
export const BRANCH_TOPOLOGY_PADDING = 20;

export interface BranchTopologyLayoutNode {
  node: TopologyNode;
  x: number;
  y: number;
  width: number;
  height: number;
  children: BranchTopologyLayoutNode[];
}

export interface BranchTopologyEdge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface BranchTopologyTreeLayout {
  layoutNodes: BranchTopologyLayoutNode[];
  totalWidth: number;
  totalHeight: number;
}

export interface BranchTopologyDiagramLayout {
  layoutNodes: BranchTopologyLayoutNode[];
  edges: BranchTopologyEdge[];
  allNodes: BranchTopologyLayoutNode[];
  svgWidth: number;
  svgHeight: number;
}

export function computeBranchTopologySubtreeWidth(node: TopologyNode): number {
  if (!node.children?.length) return BRANCH_TOPOLOGY_NODE_WIDTH;
  let width = 0;
  for (const child of node.children) {
    if (width > 0) width += BRANCH_TOPOLOGY_HORIZONTAL_GAP;
    width += computeBranchTopologySubtreeWidth(child);
  }
  return Math.max(BRANCH_TOPOLOGY_NODE_WIDTH, width);
}

export function layoutBranchTopologyTree(
  nodes: readonly TopologyNode[],
  startX: number,
  startY: number,
): BranchTopologyTreeLayout {
  if (nodes.length === 0) return { layoutNodes: [], totalWidth: 0, totalHeight: 0 };

  function buildLayout(node: TopologyNode, cx: number, y: number): BranchTopologyLayoutNode {
    const subtreeWidth = computeBranchTopologySubtreeWidth(node);
    const childLayouts: BranchTopologyLayoutNode[] = [];
    if (node.children?.length) {
      let childX = cx - subtreeWidth / 2;
      for (const child of node.children) {
        const childWidth = computeBranchTopologySubtreeWidth(child);
        const childCx = childX + childWidth / 2;
        childLayouts.push(buildLayout(
          child,
          childCx,
          y + BRANCH_TOPOLOGY_NODE_HEIGHT + BRANCH_TOPOLOGY_VERTICAL_GAP,
        ));
        childX += childWidth + BRANCH_TOPOLOGY_HORIZONTAL_GAP;
      }
    }

    return {
      node,
      x: cx - BRANCH_TOPOLOGY_NODE_WIDTH / 2,
      y,
      width: BRANCH_TOPOLOGY_NODE_WIDTH,
      height: BRANCH_TOPOLOGY_NODE_HEIGHT,
      children: childLayouts,
    };
  }

  let totalWidth = 0;
  for (const node of nodes) {
    if (totalWidth > 0) totalWidth += BRANCH_TOPOLOGY_HORIZONTAL_GAP;
    totalWidth += computeBranchTopologySubtreeWidth(node);
  }

  const layoutNodes: BranchTopologyLayoutNode[] = [];
  let currentX = startX;
  for (const node of nodes) {
    const width = computeBranchTopologySubtreeWidth(node);
    layoutNodes.push(buildLayout(node, currentX + width / 2, startY));
    currentX += width + BRANCH_TOPOLOGY_HORIZONTAL_GAP;
  }

  let maxY = startY;
  function visitForMaxY(layoutNode: BranchTopologyLayoutNode) {
    if (layoutNode.y + layoutNode.height > maxY) maxY = layoutNode.y + layoutNode.height;
    for (const child of layoutNode.children) visitForMaxY(child);
  }
  for (const layoutNode of layoutNodes) visitForMaxY(layoutNode);

  return {
    layoutNodes,
    totalWidth,
    totalHeight: maxY - startY + 20,
  };
}

export function collectBranchTopologyEdges(
  layoutNode: BranchTopologyLayoutNode,
): BranchTopologyEdge[] {
  const edges: BranchTopologyEdge[] = [];
  for (const child of layoutNode.children) {
    edges.push({
      x1: layoutNode.x + layoutNode.width / 2,
      y1: layoutNode.y + layoutNode.height,
      x2: child.x + child.width / 2,
      y2: child.y,
    });
    edges.push(...collectBranchTopologyEdges(child));
  }
  return edges;
}

export function collectBranchTopologyNodes(
  layoutNodes: readonly BranchTopologyLayoutNode[],
): BranchTopologyLayoutNode[] {
  const result: BranchTopologyLayoutNode[] = [];
  function collect(layoutNode: BranchTopologyLayoutNode) {
    result.push(layoutNode);
    for (const child of layoutNode.children) collect(child);
  }
  for (const layoutNode of layoutNodes) collect(layoutNode);
  return result;
}

export function buildBranchTopologyDiagramLayout({
  data,
  width,
  height,
}: {
  data: BranchTopologyResponse | null | undefined;
  width: number;
  height: number;
}): BranchTopologyDiagramLayout {
  if (!data?.nodes?.length) {
    return { layoutNodes: [], edges: [], allNodes: [], svgWidth: width, svgHeight: height };
  }

  const { layoutNodes, totalWidth, totalHeight } = layoutBranchTopologyTree(
    data.nodes,
    BRANCH_TOPOLOGY_PADDING,
    BRANCH_TOPOLOGY_PADDING,
  );
  const edges = layoutNodes.flatMap((layoutNode) => collectBranchTopologyEdges(layoutNode));
  const allNodes = collectBranchTopologyNodes(layoutNodes);

  return {
    layoutNodes,
    edges,
    allNodes,
    svgWidth: Math.max(totalWidth + BRANCH_TOPOLOGY_PADDING * 2, width),
    svgHeight: Math.max(totalHeight + BRANCH_TOPOLOGY_PADDING * 2, height),
  };
}

export function buildBranchTopologyEdgePath(edge: BranchTopologyEdge): string {
  return `M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + BRANCH_TOPOLOGY_VERTICAL_GAP / 2}, ${edge.x2} ${edge.y2 - BRANCH_TOPOLOGY_VERTICAL_GAP / 2}, ${edge.x2} ${edge.y2}`;
}

export function getBranchTopologySelectableChainIds(
  node: Pick<TopologyNode, 'chain_ids'> | undefined,
): string[] {
  return node?.chain_ids ?? [];
}

export function shouldShowBranchTopologyClickHint(
  node: Pick<TopologyNode, 'chain_ids'>,
): boolean {
  return node.chain_ids != null;
}

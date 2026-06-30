import { describe, expect, it } from 'vitest';

import {
  buildBranchTopologyDiagramLayout,
  buildBranchTopologyEdgePath,
  computeBranchTopologySubtreeWidth,
  getBranchTopologySelectableChainIds,
  shouldShowBranchTopologyClickHint,
} from '@/lib/inspector/branchTopologyData';
import type { BranchTopologyResponse, TopologyNode } from '@/types/inspector';

function node(overrides: Partial<TopologyNode> = {}): TopologyNode {
  return {
    id: 'root',
    label: 'Root',
    type: 'data',
    depth: 0,
    branch_path: [],
    ...overrides,
  };
}

function topology(nodes: TopologyNode[]): BranchTopologyResponse {
  return {
    nodes,
    pipeline_id: 'pipeline-a',
    pipeline_name: 'Pipeline A',
    has_stacking: false,
    has_branches: true,
    max_depth: 2,
  };
}

function sampleTree(): TopologyNode {
  return node({
    id: 'root',
    label: 'Data',
    type: 'data',
    children: [
      node({ id: 'transform', label: 'SNV', type: 'transform', depth: 1 }),
      node({
        id: 'branch',
        label: 'Branch',
        type: 'branch',
        depth: 1,
        children: [
          node({
            id: 'model',
            label: 'Model',
            type: 'model',
            depth: 2,
            metrics: { mean_score: 0.123456, chain_count: 2 },
            chain_ids: ['chain-a', 'chain-b'],
          }),
        ],
      }),
    ],
  });
}

describe('inspector branch topology data helpers', () => {
  it('computes subtree widths, diagram layout, collected nodes, and edge paths', () => {
    const root = sampleTree();
    const firstChild = root.children?.[0];
    expect(firstChild).toBeDefined();
    if (!firstChild) throw new Error('Expected first topology child');

    expect(computeBranchTopologySubtreeWidth(root)).toBe(270);
    expect(computeBranchTopologySubtreeWidth(firstChild)).toBe(120);

    const layout = buildBranchTopologyDiagramLayout({
      data: topology([root]),
      width: 300,
      height: 200,
    });

    expect(layout.svgWidth).toBe(310);
    expect(layout.svgHeight).toBe(268);
    expect(layout.allNodes.map((entry) => entry.node.id)).toEqual(['root', 'transform', 'branch', 'model']);
    expect(layout.edges).toEqual([
      { x1: 155, y1: 56, x2: 80, y2: 106 },
      { x1: 155, y1: 56, x2: 230, y2: 106 },
      { x1: 230, y1: 142, x2: 230, y2: 192 },
    ]);
    const firstEdge = layout.edges[0];
    expect(firstEdge).toBeDefined();
    if (!firstEdge) throw new Error('Expected first topology edge');
    expect(buildBranchTopologyEdgePath(firstEdge)).toBe('M 155 56 C 155 81, 80 81, 80 106');
    expect(buildBranchTopologyDiagramLayout({
      data: null,
      width: 300,
      height: 200,
    })).toEqual({ layoutNodes: [], edges: [], allNodes: [], svgWidth: 300, svgHeight: 200 });
  });

  it('keeps selectable ids and click-hint visibility explicit', () => {
    expect(getBranchTopologySelectableChainIds(node({ chain_ids: ['chain-a'] }))).toEqual(['chain-a']);
    expect(getBranchTopologySelectableChainIds(node())).toEqual([]);
    expect(shouldShowBranchTopologyClickHint(node({ chain_ids: [] }))).toBe(true);
    expect(shouldShowBranchTopologyClickHint(node())).toBe(false);
  });
});

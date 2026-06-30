import { describe, expect, it } from 'vitest';

import { buildBranchTopologyDiagramLayout } from '@/lib/inspector/branchTopologyData';
import {
  BRANCH_TOPOLOGY_FALLBACK_COLOR,
  buildBranchTopologyNodeView,
  formatBranchTopologyLabel,
  formatBranchTopologyPipelineLabel,
  formatBranchTopologyScore,
  getBranchTopologyEmptyMessage,
  getBranchTopologyNodeColor,
} from '@/lib/inspector/branchTopologyPresentation';
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
      node({
        id: 'model',
        label: 'Model',
        type: 'model',
        depth: 1,
        metrics: { mean_score: 0.123456, chain_count: 2 },
        chain_ids: ['chain-a', 'chain-b'],
      }),
    ],
  });
}

describe('inspector branch topology presentation helpers', () => {
  it('formats topology labels, scores, colors, and pipeline copy', () => {
    expect(getBranchTopologyEmptyMessage()).toBe('No branch topology data available.');
    expect(formatBranchTopologyLabel('short')).toBe('short');
    expect(formatBranchTopologyLabel('very-long-topology-label')).toBe('very-long-to\u2026');
    expect(formatBranchTopologyScore(0.123456)).toBe('0.1235');
    expect(formatBranchTopologyScore(null)).toBeNull();
    expect(formatBranchTopologyPipelineLabel('Pipeline A')).toBe('Pipeline: Pipeline A');
    expect(getBranchTopologyNodeColor('branch')).toBe('#ea580c');
    expect(BRANCH_TOPOLOGY_FALLBACK_COLOR).toBe('#64748b');
  });

  it('builds topology node view state from layout nodes', () => {
    const layout = buildBranchTopologyDiagramLayout({
      data: topology([sampleTree()]),
      width: 300,
      height: 200,
    });
    const modelNode = layout.allNodes.find((entry) => entry.node.id === 'model');
    expect(modelNode).toBeDefined();
    if (!modelNode) throw new Error('Expected model topology node');

    const view = buildBranchTopologyNodeView({
      layoutNode: modelNode,
      hoveredNodeId: 'model',
    });

    expect(view).toMatchObject({
      color: '#0d9488',
      isHovered: true,
      hasChains: true,
      hasScore: true,
      cursor: 'pointer',
      rectOpacity: 0.35,
      strokeWidth: 2,
      label: 'Model',
      scoreLabel: '0.1235',
    });
    expect(view.labelX).toBe(80);
    expect(view.labelY).toBeCloseTo(120.4);
    expect(view.scoreX).toBe(80);
    expect(view.scoreY).toBeCloseTo(131.92);
    expect(view.indicatorCx).toBe(30);
    expect(view.indicatorCy).toBe(124);
  });
});

import type { BranchTopologyLayoutNode } from '@/lib/inspector/branchTopologyData';
import type { TopologyNode } from '@/types/inspector';

export const BRANCH_TOPOLOGY_EMPTY_MESSAGE = 'No branch topology data available.';
export const BRANCH_TOPOLOGY_FALLBACK_COLOR = '#64748b';

export const BRANCH_TOPOLOGY_NODE_COLORS: Record<TopologyNode['type'], string> = {
  data: '#64748b',
  transform: '#2563eb',
  splitter: '#d97706',
  model: '#0d9488',
  merge: '#7c3aed',
  branch: '#ea580c',
};

export interface BranchTopologyNodeView {
  color: string;
  isHovered: boolean;
  hasChains: boolean;
  hasScore: boolean;
  cursor: 'pointer' | 'default';
  rectOpacity: number;
  strokeWidth: number;
  label: string;
  labelX: number;
  labelY: number;
  scoreLabel: string | null;
  scoreX: number;
  scoreY: number;
  indicatorCx: number;
  indicatorCy: number;
}

export function getBranchTopologyEmptyMessage(): string {
  return BRANCH_TOPOLOGY_EMPTY_MESSAGE;
}

export function getBranchTopologyNodeColor(type: TopologyNode['type']): string {
  return BRANCH_TOPOLOGY_NODE_COLORS[type] ?? BRANCH_TOPOLOGY_FALLBACK_COLOR;
}

export function formatBranchTopologyLabel(label: string, maxLength = 14): string {
  return label.length > maxLength ? `${label.slice(0, maxLength - 2)}\u2026` : label;
}

export function formatBranchTopologyScore(score: number | null | undefined): string | null {
  return score == null ? null : score.toFixed(4);
}

export function formatBranchTopologyPipelineLabel(pipelineName: string): string {
  return `Pipeline: ${pipelineName}`;
}

export function buildBranchTopologyNodeView({
  layoutNode,
  hoveredNodeId,
}: {
  layoutNode: BranchTopologyLayoutNode;
  hoveredNodeId: string | null;
}): BranchTopologyNodeView {
  const { node, x, y, width, height } = layoutNode;
  const color = getBranchTopologyNodeColor(node.type);
  const isHovered = hoveredNodeId === node.id;
  const hasChains = (node.chain_ids?.length ?? 0) > 0;
  const scoreLabel = formatBranchTopologyScore(node.metrics?.mean_score);
  const hasScore = scoreLabel != null;

  return {
    color,
    isHovered,
    hasChains,
    hasScore,
    cursor: hasChains ? 'pointer' : 'default',
    rectOpacity: isHovered ? 0.35 : 0.2,
    strokeWidth: isHovered ? 2 : 1.5,
    label: formatBranchTopologyLabel(node.label),
    labelX: x + width / 2,
    labelY: y + (hasScore ? height * 0.4 : height / 2),
    scoreLabel,
    scoreX: x + width / 2,
    scoreY: y + height * 0.72,
    indicatorCx: x + 10,
    indicatorCy: y + height / 2,
  };
}

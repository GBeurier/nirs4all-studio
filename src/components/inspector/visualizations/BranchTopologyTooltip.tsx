import {
  formatBranchTopologyScore,
} from '@/lib/inspector/branchTopologyPresentation';
import { shouldShowBranchTopologyClickHint } from '@/lib/inspector/branchTopologyData';
import type { TopologyNode } from '@/types/inspector';

export interface BranchTopologyHoveredNode {
  node: TopologyNode;
  mouseX: number;
  mouseY: number;
}

interface BranchTopologyTooltipProps {
  hovered: BranchTopologyHoveredNode | null;
}

export function BranchTopologyTooltip({ hovered }: BranchTopologyTooltipProps) {
  if (!hovered) {
    return null;
  }

  const { node } = hovered;

  return (
    <div
      className="fixed z-50 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md pointer-events-none"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 60 }}
    >
      <div className="font-medium">{node.label}</div>
      <div className="capitalize">Type: {node.type}</div>
      <div>Depth: {node.depth}</div>
      {node.metrics && (
        <>
          {node.metrics.mean_score != null && (
            <div>Mean score: {formatBranchTopologyScore(node.metrics.mean_score)}</div>
          )}
          <div>Chains: {node.metrics.chain_count}</div>
        </>
      )}
      {shouldShowBranchTopologyClickHint(node) && (
        <div className="mt-1 text-[10px] opacity-70">Click to select</div>
      )}
    </div>
  );
}

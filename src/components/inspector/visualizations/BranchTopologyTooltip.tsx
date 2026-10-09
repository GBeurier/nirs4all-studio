import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();

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
      <div>{t('inspector.charts.tooltip.type', { value: t(`inspector.charts.nodeTypes.${node.type}`) })}</div>
      <div>{t('inspector.charts.tooltip.depth', { value: node.depth })}</div>
      {node.metrics && (
        <>
          {node.metrics.mean_score != null && (
            <div>{t('inspector.charts.tooltip.meanScore', { value: formatBranchTopologyScore(node.metrics.mean_score) })}</div>
          )}
          <div>{t('inspector.charts.tooltip.chains', { value: node.metrics.chain_count })}</div>
        </>
      )}
      {shouldShowBranchTopologyClickHint(node) && (
        <div className="mt-1 text-[10px] opacity-70">{t('inspector.charts.tooltip.clickToSelect')}</div>
      )}
    </div>
  );
}

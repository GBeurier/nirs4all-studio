import { useTranslation } from 'react-i18next';
import {
  formatBranchComparisonChainCount,
  formatBranchComparisonConfidenceInterval,
  formatBranchComparisonScore,
} from '@/lib/inspector/branchComparisonPresentation';
import type { BranchComparisonEntry } from '@/types/inspector';

export interface BranchComparisonHoveredBar {
  branch: BranchComparisonEntry;
  mouseX: number;
  mouseY: number;
}

interface BranchComparisonTooltipProps {
  hovered: BranchComparisonHoveredBar | null;
}

export function BranchComparisonTooltip({ hovered }: BranchComparisonTooltipProps) {
  const { t } = useTranslation();

  if (!hovered) {
    return null;
  }

  const { branch } = hovered;

  return (
    <div
      className="fixed z-50 rounded border border-border bg-popover p-2 text-xs text-popover-foreground shadow-md pointer-events-none"
      style={{ left: hovered.mouseX + 12, top: hovered.mouseY - 80 }}
    >
      <div className="font-medium">{branch.label}</div>
      <div>{t('inspector.charts.tooltip.mean', { value: formatBranchComparisonScore(branch.mean) })}</div>
      <div>{t('inspector.charts.tooltip.std', { value: formatBranchComparisonScore(branch.std) })}</div>
      <div>{formatBranchComparisonConfidenceInterval(branch.ci_lower, branch.ci_upper, t)}</div>
      <div>{t('inspector.charts.tooltip.min', { value: formatBranchComparisonScore(branch.min) })}</div>
      <div>{t('inspector.charts.tooltip.max', { value: formatBranchComparisonScore(branch.max) })}</div>
      <div>{formatBranchComparisonChainCount(branch.count, t)}</div>
    </div>
  );
}

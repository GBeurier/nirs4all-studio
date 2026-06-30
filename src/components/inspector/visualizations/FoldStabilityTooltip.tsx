import { findFoldStabilityLine, type FoldStabilityLine } from '@/lib/inspector/foldStabilityData';
import {
  formatFoldStabilityChainPreview,
  formatFoldStabilityFoldLabel,
  formatFoldStabilityScore,
} from '@/lib/inspector/foldStabilityPresentation';

export interface FoldStabilityHoveredLine {
  chainId: string;
  modelClass: string;
  mouseX: number;
  mouseY: number;
}

interface FoldStabilityTooltipProps {
  hoveredLine: FoldStabilityHoveredLine | null;
  lines: FoldStabilityLine[];
}

export function FoldStabilityTooltip({
  hoveredLine,
  lines,
}: FoldStabilityTooltipProps) {
  if (!hoveredLine) return null;

  return (
    <div
      className="fixed z-50 bg-popover text-popover-foreground text-xs p-2 rounded shadow-md border border-border pointer-events-none"
      style={{ left: hoveredLine.mouseX + 12, top: hoveredLine.mouseY - 60 }}
    >
      <div className="font-medium">{hoveredLine.modelClass}</div>
      <div className="text-[10px] opacity-70 mb-1">{formatFoldStabilityChainPreview(hoveredLine.chainId)}</div>
      {findFoldStabilityLine(lines, hoveredLine.chainId)?.points.map(pt => (
        <div key={pt.foldIndex}>
          {formatFoldStabilityFoldLabel(pt.foldIndex)}: {formatFoldStabilityScore(pt.score)}
        </div>
      ))}
    </div>
  );
}

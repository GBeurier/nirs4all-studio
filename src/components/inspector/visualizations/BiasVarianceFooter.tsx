import { MousePointerClick } from 'lucide-react';
import { formatBiasVarianceSelectionStatus } from '@/lib/inspector/biasVariancePresentation';

interface BiasVarianceFooterProps {
  hasSelection: boolean;
  selectedCount: number;
}

export function BiasVarianceFooter({
  hasSelection,
  selectedCount,
}: BiasVarianceFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
      <span className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-muted/20 px-2 py-0.5">
        <MousePointerClick className="h-3 w-3" />
        {formatBiasVarianceSelectionStatus(hasSelection, selectedCount)}
      </span>
      <span>Needs the same sample to appear in multiple folds or repeated validation predictions.</span>
    </div>
  );
}

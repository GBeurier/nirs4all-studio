import { memo } from 'react';
import { Filter, MousePointer2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSelection } from '@/context/useSelection';
import type { FoldsInfo } from '@/types/playground';
import { SavedSelections } from './SavedSelections';
import { SelectionFilters } from './SelectionFilters';
import { SelectionModeToggle } from './SelectionTools';
import { RibbonGroup } from './CanvasToolbarRibbonGroup';

export interface CanvasToolbarSelectionGroupProps {
  selectedCount: number;
  onFilterToSelection?: () => void;
  folds: FoldsInfo | null;
  metadata?: Record<string, unknown[]>;
  sampleIds?: string[];
  totalSamples: number;
}

export const CanvasToolbarSelectionGroup = memo(function CanvasToolbarSelectionGroup({
  selectedCount,
  onFilterToSelection,
  folds,
  metadata,
  sampleIds,
  totalSamples,
}: CanvasToolbarSelectionGroupProps) {
  const selectionCtx = useSelection();

  return (
    <RibbonGroup label="Selection" icon={<MousePointer2 className="w-2.5 h-2.5" />}>
      <SelectionModeToggle
        mode={selectionCtx.selectionToolMode}
        onChange={selectionCtx.setSelectionToolMode}
      />
      {selectionCtx.selectionToolMode !== 'click' && (
        <span className="text-[9px] text-primary font-medium px-1 py-0.5 bg-primary/10 rounded">
          {selectionCtx.selectionToolMode === 'box' ? 'Box' : 'Lasso'}
        </span>
      )}

      <SelectionFilters
        folds={folds}
        metadata={metadata}
        totalSamples={totalSamples}
        compact
      />

      {selectedCount > 0 && (
        <>
          <Separator orientation="vertical" className="h-4 mx-1" />
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="secondary" className="h-4 px-1.5 text-[10px] font-medium cursor-help">
                  {selectedCount} sel.
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {selectedCount} sample{selectedCount !== 1 ? 's' : ''} currently selected. Press Esc to clear.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          {onFilterToSelection && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-5 text-[10px] gap-1 px-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400"
                    onClick={onFilterToSelection}
                  >
                    <Filter className="w-3 h-3" />
                    Keep
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs">
                  <p className="text-xs">
                    Add a filter that keeps only the {selectedCount} selected sample{selectedCount !== 1 ? 's' : ''}.
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </>
      )}

      <SavedSelections compact sampleIds={sampleIds} />
    </RibbonGroup>
  );
});

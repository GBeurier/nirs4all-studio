/**
 * InspectorSelectionTools — Selection mode toggle, actions bar for Inspector.
 *
 * Provides Inspector-specific wrappers that work with chain_ids (strings)
 * instead of sample indices (numbers).
 */

import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { MousePointer2, Square, Lasso, Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import type { InspectorSelectionToolMode } from '@/types/inspector';

// ============= Inspector Selection Mode Toggle =============

interface InspectorSelectionModeToggleProps {
  className?: string;
}

export function InspectorSelectionModeToggle({ className }: InspectorSelectionModeToggleProps) {
  const { t } = useTranslation();
  const { selectionToolMode, setSelectionToolMode } = useInspectorSelection();

  const tools: { type: InspectorSelectionToolMode; icon: typeof MousePointer2; label: string; shortcut: string }[] = [
    { type: 'click', icon: MousePointer2, label: t('inspector.selection.tools.click'), shortcut: 'V' },
    { type: 'box', icon: Square, label: t('inspector.selection.tools.box'), shortcut: 'B' },
    { type: 'lasso', icon: Lasso, label: t('inspector.selection.tools.lasso'), shortcut: 'L' },
  ];

  // Keyboard shortcuts for tool mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) return;

      switch (e.key.toLowerCase()) {
        case 'v': setSelectionToolMode('click'); break;
        case 'b': setSelectionToolMode('box'); break;
        case 'l': setSelectionToolMode('lasso'); break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setSelectionToolMode]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className={cn('flex items-center gap-0.5 p-0.5 bg-muted rounded-md', className)}>
        {tools.map(({ type, icon: Icon, label, shortcut }) => (
          <Tooltip key={type}>
            <TooltipTrigger asChild>
              <Button
                variant={selectionToolMode === type ? 'secondary' : 'ghost'}
                size="sm"
                className={cn(
                  'h-6 w-6 p-0',
                  selectionToolMode === type && 'bg-background shadow-sm'
                )}
                onClick={() => setSelectionToolMode(type)}
                aria-label={`${label} (${shortcut})`}
                aria-pressed={selectionToolMode === type}
              >
                <Icon className="w-3.5 h-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs">
              {label} ({shortcut})
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}

// ============= Inspector Selection Actions Bar =============

interface InspectorSelectionActionsBarProps {
  totalCount: number;
  allChainIds: string[];
  onSave?: () => void;
  className?: string;
}

export function InspectorSelectionActionsBar({
  totalCount,
  allChainIds,
  onSave,
  className,
}: InspectorSelectionActionsBarProps) {
  const { t } = useTranslation();
  const {
    selectedCount,
    clear,
    invert,
    selectAll,
    pin,
    selectedChains,
    hasSelection,
  } = useInspectorSelection();

  const handlePin = useCallback(() => {
    pin(Array.from(selectedChains));
  }, [pin, selectedChains]);

  if (!hasSelection) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          'flex items-center gap-2 px-2 py-1 bg-primary/10 border border-primary/20 rounded-md text-xs',
          className
        )}
      >
        <span className="font-medium text-primary">
          {t('inspector.selection.selectedOfTotal', { selected: selectedCount, total: totalCount })}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={clear}>
            {t('common.clear')}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => invert(allChainIds)}>
            {t('inspector.selection.invert')}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => selectAll(allChainIds)}>
            {t('common.all')}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handlePin}>
            <Pin className="w-3 h-3 mr-1" />
            {t('inspector.selection.pin')}
          </Button>
          {onSave && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onSave}>
              {t('common.save')}
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}

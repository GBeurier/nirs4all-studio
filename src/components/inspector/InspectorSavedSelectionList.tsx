import { Bookmark, BookmarkPlus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DEFAULT_INSPECTOR_SELECTION_COLOR } from '@/lib/inspector/savedSelections';
import { cn } from '@/lib/utils';
import type { InspectorSavedSelection } from '@/types/inspector';

interface InspectorSavedSelectionListProps {
  savedSelections: InspectorSavedSelection[];
  activeSelectionId?: string;
  showEmptyState?: boolean;
  onLoad: (selection: InspectorSavedSelection) => void;
  onDelete: (selection: InspectorSavedSelection) => void;
}

export function InspectorSavedSelectionList({
  savedSelections,
  activeSelectionId,
  showEmptyState = false,
  onLoad,
  onDelete,
}: InspectorSavedSelectionListProps) {
  if (savedSelections.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="text-center py-4 text-muted-foreground">
        <Bookmark className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
        <p className="text-xs">No saved selections</p>
        <p className="text-[10px] mt-0.5">
          Select chains, then click <BookmarkPlus className="w-3 h-3 inline-block" /> to save
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-48">
      <div className="space-y-0.5 group">
        {savedSelections.map((selection) => (
          <InspectorSavedSelectionItem
            key={selection.id}
            selection={selection}
            isActive={selection.id === activeSelectionId}
            onLoad={() => onLoad(selection)}
            onDelete={() => onDelete(selection)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function InspectorSavedSelectionItem({
  selection,
  isActive,
  onLoad,
  onDelete,
}: {
  selection: InspectorSavedSelection;
  isActive: boolean;
  onLoad: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors',
        'hover:bg-accent/50',
        isActive && 'bg-accent',
      )}
      onClick={onLoad}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => event.key === 'Enter' && onLoad()}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: selection.color ?? DEFAULT_INSPECTOR_SELECTION_COLOR }}
        />
        <span className="text-sm truncate">{selection.name}</span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
          {selection.chain_ids.length}
        </Badge>
      </div>

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            <p className="text-xs">Delete selection</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

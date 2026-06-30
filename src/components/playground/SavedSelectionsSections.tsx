import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Check,
  Download,
  MoreHorizontal,
  Palette,
  Trash2,
  Upload,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { SavedSelection } from '@/context/useSelection';
import { cn } from '@/lib/utils';
import {
  buildCompactSaveTooltipDescription,
  buildSaveSelectionDialogDescription,
} from './SavedSelectionsData';
import { toast } from 'sonner';

const SELECTION_COLORS = [
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Yellow', value: '#eab308' },
  { name: 'Red', value: '#ef4444' },
];

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
}

function ColorPicker({ value, onChange }: ColorPickerProps) {
  return (
    <div className="flex flex-wrap gap-1">
      {SELECTION_COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          className={cn(
            'w-5 h-5 rounded-full border-2 transition-all',
            value === color.value
              ? 'border-foreground scale-110'
              : 'border-transparent hover:border-muted-foreground/50'
          )}
          style={{ backgroundColor: color.value }}
          onClick={() => onChange(color.value)}
          title={color.name}
        />
      ))}
    </div>
  );
}

interface SelectionActionsMenuProps {
  variant: 'compact' | 'full';
  selectedCount: number;
  savedSelectionCount: number;
  onExportCurrentCsv: () => void;
  onExportJson: () => void;
  onImport: () => void;
  onDeleteAll?: () => void;
}

function SelectionActionsMenu({
  variant,
  selectedCount,
  savedSelectionCount,
  onExportCurrentCsv,
  onExportJson,
  onImport,
  onDeleteAll,
}: SelectionActionsMenuProps) {
  const isCompact = variant === 'compact';
  const triggerClassName = isCompact ? 'h-5 w-5 p-0' : 'h-7 w-7 p-0';
  const triggerIconClassName = isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4';
  const itemIconClassName = isCompact ? 'w-3.5 h-3.5 mr-2' : 'w-4 h-4 mr-2';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={triggerClassName}>
          <MoreHorizontal className={triggerIconClassName} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onExportCurrentCsv} disabled={selectedCount === 0}>
          <Download className={itemIconClassName} />
          {isCompact ? 'Export current (CSV)' : 'Export current selection (CSV)'}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onExportJson} disabled={savedSelectionCount === 0}>
          <Download className={itemIconClassName} />
          {isCompact ? 'Export all (JSON)' : 'Export all saved (JSON)'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImport}>
          <Upload className={itemIconClassName} />
          {isCompact ? 'Import (CSV/JSON)' : 'Import from file (CSV/JSON)'}
        </DropdownMenuItem>
        {onDeleteAll && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              disabled={savedSelectionCount === 0}
              onClick={onDeleteAll}
            >
              <Trash2 className={itemIconClassName} />
              Delete all
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface SaveSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSave: (name: string, color: string) => void;
}

export function SaveSelectionDialog({
  open,
  onOpenChange,
  selectedCount,
  onSave,
}: SaveSelectionDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SELECTION_COLORS[0].value);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback(() => {
    if (!name.trim()) {
      toast.error('Please enter a name for the selection');
      return;
    }
    onSave(name.trim(), color);
    setName('');
    setColor(SELECTION_COLORS[0].value);
    onOpenChange(false);
  }, [name, color, onSave, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && name.trim()) {
        e.preventDefault();
        handleSave();
      }
    },
    [handleSave, name]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5" />
            Save Selection
          </DialogTitle>
          <DialogDescription>{buildSaveSelectionDialogDescription(selectedCount)}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="selection-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="selection-name"
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g., Outliers, High variance, Batch A..."
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5" />
              Color
            </label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!name.trim()}>
            <Check className="w-4 h-4 mr-1.5" />
            Save Selection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SelectionItemProps {
  selection: SavedSelection;
  isActive: boolean;
  onLoad: () => void;
  onDelete: () => void;
}

function SelectionItem({ selection, isActive, onLoad, onDelete }: SelectionItemProps) {
  const handleDeleteClick = useCallback(
    (e: MouseEvent) => {
      e.stopPropagation();
      onDelete();
    },
    [onDelete]
  );

  return (
    <div
      className={cn(
        'flex items-center justify-between px-3 py-2 rounded-md cursor-pointer transition-colors',
        'hover:bg-accent/50',
        isActive && 'bg-accent'
      )}
      onClick={onLoad}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onLoad()}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: selection.color ?? SELECTION_COLORS[0].value }}
        />
        <span className="text-sm truncate">{selection.name}</span>
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">
          {selection.indices.length}
        </Badge>
      </div>

      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDeleteClick}
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

interface SelectionListProps {
  savedSelections: SavedSelection[];
  activeSelectionId?: string;
  maxHeightClassName: string;
  itemSpacingClassName: string;
  onLoadSelection: (selection: SavedSelection) => void;
  onDeleteSelection: (selection: SavedSelection) => void;
}

function SelectionList({
  savedSelections,
  activeSelectionId,
  maxHeightClassName,
  itemSpacingClassName,
  onLoadSelection,
  onDeleteSelection,
}: SelectionListProps) {
  return (
    <ScrollArea className={maxHeightClassName}>
      <div className={cn(itemSpacingClassName, 'group')}>
        {savedSelections.map((selection) => (
          <SelectionItem
            key={selection.id}
            selection={selection}
            isActive={selection.id === activeSelectionId}
            onLoad={() => onLoadSelection(selection)}
            onDelete={() => onDeleteSelection(selection)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

export function SavedSelectionsEmptyState() {
  return (
    <div className="text-center py-6 text-muted-foreground">
      <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-40" />
      <p className="text-sm">No saved selections</p>
      <p className="text-xs mt-1">
        Select samples in a chart, then click{' '}
        <BookmarkPlus className="w-3 h-3 inline-block" /> to save
      </p>
    </div>
  );
}

export interface SavedSelectionsSectionProps {
  savedSelections: SavedSelection[];
  activeSelectionId?: string;
  selectedCount: number;
  onOpenSaveDialog: () => void;
  onExportCurrentCsv: () => void;
  onExportJson: () => void;
  onImport: () => void;
  onLoadSelection: (selection: SavedSelection) => void;
  onDeleteSelection: (selection: SavedSelection) => void;
}

export interface CompactSavedSelectionsSectionProps extends SavedSelectionsSectionProps {
  className?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children?: ReactNode;
}

export function CompactSavedSelectionsSection({
  className,
  savedSelections,
  activeSelectionId,
  selectedCount,
  isOpen,
  onOpenChange,
  children,
  onOpenSaveDialog,
  onExportCurrentCsv,
  onExportJson,
  onImport,
  onLoadSelection,
  onDeleteSelection,
}: CompactSavedSelectionsSectionProps) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 gap-1 text-[10px]"
              onClick={onOpenSaveDialog}
              disabled={selectedCount === 0}
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              Save
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="text-xs font-medium">Save current selection</p>
            <p className="text-xs text-muted-foreground">
              {buildCompactSaveTooltipDescription(selectedCount)}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {savedSelections.length > 0 && (
        <Popover open={isOpen} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]">
              <Bookmark className="w-3 h-3" />
              Saved ({savedSelections.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">
                Saved Selections
              </span>
              <SelectionActionsMenu
                variant="compact"
                selectedCount={selectedCount}
                savedSelectionCount={savedSelections.length}
                onExportCurrentCsv={onExportCurrentCsv}
                onExportJson={onExportJson}
                onImport={onImport}
              />
            </div>

            <SelectionList
              savedSelections={savedSelections}
              activeSelectionId={activeSelectionId}
              maxHeightClassName="max-h-48"
              itemSpacingClassName="space-y-0.5"
              onLoadSelection={onLoadSelection}
              onDeleteSelection={onDeleteSelection}
            />
          </PopoverContent>
        </Popover>
      )}

      {children}
    </div>
  );
}

export interface FullSavedSelectionsSectionProps extends SavedSelectionsSectionProps {
  className?: string;
  children?: ReactNode;
  onDeleteAll: () => void;
}

export function FullSavedSelectionsSection({
  className,
  children,
  savedSelections,
  activeSelectionId,
  selectedCount,
  onOpenSaveDialog,
  onExportCurrentCsv,
  onExportJson,
  onImport,
  onDeleteAll,
  onLoadSelection,
  onDeleteSelection,
}: FullSavedSelectionsSectionProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Bookmark className="w-4 h-4" />
          Saved Selections
        </h3>

        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={onOpenSaveDialog}
                  disabled={selectedCount === 0}
                >
                  <BookmarkPlus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Save current selection (Ctrl+S)</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <SelectionActionsMenu
            variant="full"
            selectedCount={selectedCount}
            savedSelectionCount={savedSelections.length}
            onExportCurrentCsv={onExportCurrentCsv}
            onExportJson={onExportJson}
            onImport={onImport}
            onDeleteAll={onDeleteAll}
          />
        </div>
      </div>

      {savedSelections.length === 0 ? (
        <SavedSelectionsEmptyState />
      ) : (
        <SelectionList
          savedSelections={savedSelections}
          activeSelectionId={activeSelectionId}
          maxHeightClassName="max-h-64"
          itemSpacingClassName="space-y-1"
          onLoadSelection={onLoadSelection}
          onDeleteSelection={onDeleteSelection}
        />
      )}

      {children}
    </div>
  );
}

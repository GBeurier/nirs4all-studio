/**
 * InspectorSavedSelections — Saved selections UI for Inspector.
 *
 * Adapted from Playground's SavedSelections.tsx but uses chain_ids (strings)
 * instead of sample indices (numbers). Supports save, load, delete, export/import.
 */

import { useState, useCallback, useRef } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Trash2,
  Download,
  Upload,
  MoreHorizontal,
  Check,
  Palette,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInspectorSelection } from '@/context/InspectorSelectionContext';
import type { InspectorSavedSelection } from '@/types/inspector';
import { toast } from 'sonner';

// ============= Color Palette =============

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

// ============= Sub-Components =============

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
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

function SaveSelectionDialog({
  open,
  onOpenChange,
  selectedCount,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSave: (name: string, color: string) => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(SELECTION_COLORS[0].value);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookmarkPlus className="w-5 h-5" />
            Save Selection
          </DialogTitle>
          <DialogDescription>
            Save the current {selectedCount} selected chain{selectedCount !== 1 ? 's' : ''} for
            later use.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="space-y-2">
            <label htmlFor="inspector-selection-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="inspector-selection-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && handleSave()}
              placeholder="e.g., Best PLS models, Branch A chains..."
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

function SelectionItem({
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
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
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

// ============= Main Component =============

interface InspectorSavedSelectionsProps {
  compact?: boolean;
  className?: string;
}

export function InspectorSavedSelections({ compact = false, className }: InspectorSavedSelectionsProps) {
  const {
    savedSelections,
    selectedChains,
    selectedCount,
    saveSelection,
    loadSelection,
    deleteSavedSelection,
  } = useInspectorSelection();

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSave = useCallback((name: string, color: string) => {
    saveSelection(name, color);
    toast.success('Selection saved', { description: `"${name}" with ${selectedCount} chains` });
  }, [saveSelection, selectedCount]);

  const handleLoad = useCallback((selection: InspectorSavedSelection) => {
    loadSelection(selection.id);
    toast.success('Selection loaded', { description: `"${selection.name}" — ${selection.chain_ids.length} chains` });
    setIsOpen(false);
  }, [loadSelection]);

  const handleDelete = useCallback((selection: InspectorSavedSelection) => {
    deleteSavedSelection(selection.id);
    toast.success('Selection deleted', { description: `"${selection.name}" removed` });
  }, [deleteSavedSelection]);

  const handleExportJson = useCallback(() => {
    if (savedSelections.length === 0) {
      toast.warning('No selections to export');
      return;
    }
    const data = JSON.stringify(savedSelections, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'inspector-selections.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Selections exported', { description: `${savedSelections.length} selection(s) saved` });
  }, [savedSelections]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = JSON.parse(text) as InspectorSavedSelection[];
      if (!Array.isArray(imported)) throw new Error('Invalid format');
      let count = 0;
      for (const sel of imported) {
        if (sel.name && Array.isArray(sel.chain_ids) && sel.chain_ids.length > 0) {
          saveSelection(sel.name, sel.color);
          count++;
        }
      }
      toast.success('Selections imported', { description: `${count} selection(s) added` });
    } catch {
      toast.error('Import failed', { description: 'Invalid JSON file format' });
    }
    e.target.value = '';
  }, [saveSelection]);

  // Check if current selection matches any saved
  const activeSelectionId = savedSelections.find((s) => {
    if (s.chain_ids.length !== selectedCount) return false;
    return s.chain_ids.every((id) => selectedChains.has(id));
  })?.id;

  if (compact) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 gap-1 text-[10px]"
                onClick={() => setSaveDialogOpen(true)}
                disabled={selectedCount === 0}
              >
                <BookmarkPlus className="w-3.5 h-3.5" />
                Save
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">Save the {selectedCount} selected chain{selectedCount !== 1 ? 's' : ''}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {savedSelections.length > 0 && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]">
                <Bookmark className="w-3 h-3" />
                Saved ({savedSelections.length})
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <ScrollArea className="max-h-48">
                <div className="space-y-0.5 group">
                  {savedSelections.map((selection) => (
                    <SelectionItem
                      key={selection.id}
                      selection={selection}
                      isActive={selection.id === activeSelectionId}
                      onLoad={() => handleLoad(selection)}
                      onDelete={() => handleDelete(selection)}
                    />
                  ))}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        )}

        <SaveSelectionDialog
          open={saveDialogOpen}
          onOpenChange={setSaveDialogOpen}
          selectedCount={selectedCount}
          onSave={handleSave}
        />
      </div>
    );
  }

  // Full mode
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5" />
          Saved Selections
        </span>
        <div className="flex items-center gap-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setSaveDialogOpen(true)}
                  disabled={selectedCount === 0}
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">Save current selection</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportJson} disabled={savedSelections.length === 0}>
                <Download className="w-3.5 h-3.5 mr-2" />
                Export all (JSON)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleImport}>
                <Upload className="w-3.5 h-3.5 mr-2" />
                Import (JSON)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {savedSelections.length === 0 ? (
        <div className="text-center py-4 text-muted-foreground">
          <Bookmark className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
          <p className="text-xs">No saved selections</p>
          <p className="text-[10px] mt-0.5">
            Select chains, then click <BookmarkPlus className="w-3 h-3 inline-block" /> to save
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-48">
          <div className="space-y-0.5 group">
            {savedSelections.map((selection) => (
              <SelectionItem
                key={selection.id}
                selection={selection}
                isActive={selection.id === activeSelectionId}
                onLoad={() => handleLoad(selection)}
                onDelete={() => handleDelete(selection)}
              />
            ))}
          </div>
        </ScrollArea>
      )}

      <SaveSelectionDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        selectedCount={selectedCount}
        onSave={handleSave}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

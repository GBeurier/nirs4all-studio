/**
 * SavedSelections - UI component for managing named selections
 *
 * Features:
 * - Save current selection with name/color
 * - List, load, delete saved selections
 * - Export/import selections as JSON
 * - Color-coded selection badges
 * - Keyboard shortcuts support
 *
 * Phase 6: Performance & Polish
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
  X,
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
import { useSelection, type SavedSelection } from '@/context/SelectionContext';
import {
  exportSelectionsToJson,
  exportSelectionToCsv,
  importSelectionsFromJson,
  importSelectionFromCsv,
} from '@/lib/playground/export';
import { toast } from 'sonner';

// ============= Types =============

export interface SavedSelectionsProps {
  /** Whether to use compact mode */
  compact?: boolean;
  /** Class name for container */
  className?: string;
  /** Sample IDs for export with names (not just indices) */
  sampleIds?: string[];
  /** Callback when selection is loaded */
  onSelectionLoaded?: (selection: SavedSelection) => void;
}

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

interface SaveSelectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  onSave: (name: string, color: string) => void;
}

function SaveSelectionDialog({
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
    (e: React.KeyboardEvent) => {
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
          <DialogDescription>
            Save the current {selectedCount} selected sample{selectedCount !== 1 ? 's' : ''} for
            later use.
          </DialogDescription>
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
    (e: React.MouseEvent) => {
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

// ============= Main Component =============

export function SavedSelections({
  compact = false,
  className,
  sampleIds,
  onSelectionLoaded,
}: SavedSelectionsProps) {
  const {
    savedSelections,
    selectedSamples,
    selectedCount,
    saveSelection,
    loadSelection,
    deleteSavedSelection,
    select,
  } = useSelection();

  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle save
  const handleSave = useCallback(
    (name: string, color: string) => {
      saveSelection(name, color);
      toast.success('Selection saved', {
        description: `"${name}" with ${selectedCount} samples`,
      });
    },
    [saveSelection, selectedCount]
  );

  // Handle load
  const handleLoad = useCallback(
    (selection: SavedSelection) => {
      loadSelection(selection.id);
      onSelectionLoaded?.(selection);
      toast.success('Selection loaded', {
        description: `"${selection.name}" - ${selection.indices.length} samples`,
      });
      setIsOpen(false);
    },
    [loadSelection, onSelectionLoaded]
  );

  // Handle delete
  const handleDelete = useCallback(
    (selection: SavedSelection) => {
      deleteSavedSelection(selection.id);
      toast.success('Selection deleted', {
        description: `"${selection.name}" removed`,
      });
    },
    [deleteSavedSelection]
  );

  // Handle export all selections to JSON
  const handleExportJson = useCallback(() => {
    if (savedSelections.length === 0) {
      toast.warning('No selections to export');
      return;
    }

    const result = exportSelectionsToJson(savedSelections, { sampleIds });
    if (result.success) {
      toast.success('Selections exported', {
        description: `${savedSelections.length} selection(s) saved to ${result.filename}`,
      });
    } else {
      toast.error('Export failed', {
        description: result.error,
      });
    }
  }, [savedSelections, sampleIds]);

  // Handle export current selection to CSV
  const handleExportCurrentCsv = useCallback(() => {
    if (selectedCount === 0) {
      toast.warning('No samples selected');
      return;
    }

    const result = exportSelectionToCsv(Array.from(selectedSamples), {
      sampleIds,
      includeBoth: true,
      filename: 'current-selection',
    });
    if (result.success) {
      toast.success('Selection exported', {
        description: `${selectedCount} sample(s) saved to ${result.filename}`,
      });
    } else {
      toast.error('Export failed', {
        description: result.error,
      });
    }
  }, [selectedSamples, selectedCount, sampleIds]);

  // Handle import
  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const isJson = file.name.endsWith('.json');
        const isCsv = file.name.endsWith('.csv');

        if (isJson) {
          // Import saved selections from JSON
          const { selections, warnings, unmappedCount } = importSelectionsFromJson(text, sampleIds);

          // Save each imported selection
          selections.forEach((s) => {
            saveSelection(s.name, s.color);
          });

          if (warnings.length > 0 || unmappedCount > 0) {
            toast.warning('Import completed with warnings', {
              description: warnings[0] || `${unmappedCount} sample IDs could not be mapped`,
            });
          } else {
            toast.success('Selections imported', {
              description: `${selections.length} selection(s) added`,
            });
          }
        } else if (isCsv) {
          // Import single selection from CSV
          const { indices, warnings, unmappedCount } = importSelectionFromCsv(text, sampleIds);

          if (indices.length === 0) {
            toast.error('Import failed', {
              description: 'No valid samples found in CSV',
            });
            return;
          }

          // Apply the imported selection
          select(indices, 'replace');

          if (warnings.length > 0 || unmappedCount > 0) {
            toast.warning('Selection imported with warnings', {
              description: `${indices.length} samples loaded, ${unmappedCount} unmapped`,
            });
          } else {
            toast.success('Selection imported', {
              description: `${indices.length} samples selected`,
            });
          }
        } else {
          toast.error('Invalid file format', {
            description: 'Please use .json or .csv files',
          });
        }
      } catch (error) {
        toast.error('Import failed', {
          description: error instanceof Error ? error.message : 'Invalid file format',
        });
      }

      // Reset input
      e.target.value = '';
    },
    [saveSelection, select, sampleIds]
  );

  // Check if current selection matches any saved
  const activeSelectionId = savedSelections.find((s) => {
    if (s.indices.length !== selectedCount) return false;
    const savedSet = new Set(s.indices);
    return [...selectedSamples].every((i) => savedSet.has(i));
  })?.id;

  // Compact mode - just show save button
  if (compact) {
    return (
      <div className={cn('flex items-center gap-1', className)}>
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
            <TooltipContent side="bottom">
              <p className="text-xs">Save selection (Ctrl+S)</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {savedSelections.length > 0 && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]">
                <Bookmark className="w-3 h-3" />
                {savedSelections.length}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 p-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Saved Selections
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0">
                      <MoreHorizontal className="w-3.5 h-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={handleExportCurrentCsv} disabled={selectedCount === 0}>
                      <Download className="w-3.5 h-3.5 mr-2" />
                      Export current (CSV)
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportJson} disabled={savedSelections.length === 0}>
                      <Download className="w-3.5 h-3.5 mr-2" />
                      Export all (JSON)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleImport}>
                      <Upload className="w-3.5 h-3.5 mr-2" />
                      Import (CSV/JSON)
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

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

        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>
    );
  }

  // Full mode
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
                  onClick={() => setSaveDialogOpen(true)}
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

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportCurrentCsv} disabled={selectedCount === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export current selection (CSV)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExportJson} disabled={savedSelections.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export all saved (JSON)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleImport}>
                <Upload className="w-4 h-4 mr-2" />
                Import from file (CSV/JSON)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                disabled={savedSelections.length === 0}
                onClick={() => {
                  if (confirm('Delete all saved selections?')) {
                    savedSelections.forEach((s) => deleteSavedSelection(s.id));
                    toast.success('All selections deleted');
                  }
                }}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete all
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {savedSelections.length === 0 ? (
        <div className="text-center py-6 text-muted-foreground">
          <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No saved selections</p>
          <p className="text-xs mt-1">
            Select samples in a chart, then click{' '}
            <BookmarkPlus className="w-3 h-3 inline-block" /> to save
          </p>
        </div>
      ) : (
        <ScrollArea className="max-h-64">
          <div className="space-y-1 group">
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
        accept=".json,.csv"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

export default SavedSelections;

/**
 * InspectorSavedSelections — Saved selections UI for Inspector.
 *
 * Adapted from Playground's SavedSelections.tsx but uses chain_ids (strings)
 * instead of sample indices (numbers). Supports save, load, delete, export/import.
 */

import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import {
  Bookmark,
  BookmarkPlus,
  Download,
  Upload,
  MoreHorizontal,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import type { InspectorSavedSelection } from '@/types/inspector';
import { toast } from 'sonner';
import {
  buildInspectorSavedSelectionsJson,
  findActiveInspectorSavedSelectionId,
  parseImportableInspectorSavedSelections,
} from '@/lib/inspector/savedSelections';
import { InspectorSaveSelectionDialog } from './InspectorSaveSelectionDialog';
import { InspectorSavedSelectionList } from './InspectorSavedSelectionList';

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
    const data = buildInspectorSavedSelectionsJson(savedSelections);
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

  const handleFileChange = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const imported = parseImportableInspectorSavedSelections(text);
      let count = 0;
      for (const sel of imported) {
        saveSelection(sel.name, sel.color);
        count++;
      }
      toast.success('Selections imported', { description: `${count} selection(s) added` });
    } catch {
      toast.error('Import failed', { description: 'Invalid JSON file format' });
    }
    e.target.value = '';
  }, [saveSelection]);

  const activeSelectionId = findActiveInspectorSavedSelectionId({
    savedSelections,
    selectedChains,
    selectedCount,
  });

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
              <InspectorSavedSelectionList
                savedSelections={savedSelections}
                activeSelectionId={activeSelectionId}
                onLoad={handleLoad}
                onDelete={handleDelete}
              />
            </PopoverContent>
          </Popover>
        )}

        <InspectorSaveSelectionDialog
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

      <InspectorSavedSelectionList
        savedSelections={savedSelections}
        activeSelectionId={activeSelectionId}
        showEmptyState
        onLoad={handleLoad}
        onDelete={handleDelete}
      />

      <InspectorSaveSelectionDialog
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

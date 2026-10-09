/**
 * InspectorSavedSelections — Saved selections UI for Inspector.
 *
 * Adapted from Playground's SavedSelections.tsx but uses chain_ids (strings)
 * instead of sample indices (numbers). Supports save, load, delete, export/import.
 */

import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
    toast.success(t('inspector.saved.savedTitle'), { description: t('inspector.saved.savedDescription', { name, count: selectedCount }) });
  }, [saveSelection, selectedCount, t]);

  const handleLoad = useCallback((selection: InspectorSavedSelection) => {
    loadSelection(selection.id);
    toast.success(t('inspector.saved.loadedTitle'), { description: t('inspector.saved.loadedDescription', { name: selection.name, count: selection.chain_ids.length }) });
    setIsOpen(false);
  }, [loadSelection, t]);

  const handleDelete = useCallback((selection: InspectorSavedSelection) => {
    deleteSavedSelection(selection.id);
    toast.success(t('inspector.saved.deletedTitle'), { description: t('inspector.saved.deletedDescription', { name: selection.name }) });
  }, [deleteSavedSelection, t]);

  const handleExportJson = useCallback(() => {
    if (savedSelections.length === 0) {
      toast.warning(t('inspector.saved.noneToExport'));
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
    toast.success(t('inspector.saved.exportedTitle'), { description: t('inspector.saved.exportedDescription', { count: savedSelections.length }) });
  }, [savedSelections, t]);

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
      toast.success(t('inspector.saved.importedTitle'), { description: t('inspector.saved.importedDescription', { count }) });
    } catch {
      toast.error(t('inspector.saved.importFailedTitle'), { description: t('inspector.saved.importFailedDescription') });
    }
    e.target.value = '';
  }, [saveSelection, t]);

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
                {t('common.save')}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-xs">
              <p className="text-xs">{t('inspector.saved.saveTooltip', { count: selectedCount })}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {savedSelections.length > 0 && (
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 gap-1 px-2 text-[10px]">
                <Bookmark className="w-3 h-3" />
                {t('inspector.saved.savedButton', { count: savedSelections.length })}
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
          {t('inspector.sidebar.savedSelections')}
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
                  aria-label={t('inspector.saved.saveCurrent')}
                >
                  <BookmarkPlus className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs">{t('inspector.saved.saveCurrent')}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" aria-label={t('inspector.saved.moreActions')}>
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleExportJson} disabled={savedSelections.length === 0}>
                <Download className="w-3.5 h-3.5 mr-2" />
                {t('inspector.saved.exportAll')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleImport}>
                <Upload className="w-3.5 h-3.5 mr-2" />
                {t('inspector.saved.import')}
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

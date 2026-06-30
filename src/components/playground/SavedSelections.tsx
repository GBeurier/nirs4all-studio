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

import { useState, useCallback, useRef, type ChangeEvent } from 'react';
import { useSelection, type SavedSelection } from '@/context/useSelection';
import {
  exportSelectionsToJson,
  exportSelectionToCsv,
  importSelectionsFromJson,
  importSelectionFromCsv,
} from '@/lib/playground/export';
import { toast } from 'sonner';
import {
  buildCsvImportNotification,
  buildCurrentSelectionExportedToastDescription,
  buildInvalidImportFileNotification,
  buildJsonImportNotification,
  buildSelectionDeletedToastDescription,
  buildSelectionLoadedToastDescription,
  buildSelectionSavedToastDescription,
  buildSelectionsExportedToastDescription,
  classifySelectionImportFile,
  getActiveSavedSelectionId,
  type SavedSelectionNotification,
} from './SavedSelectionsData';
import {
  CompactSavedSelectionsSection,
  FullSavedSelectionsSection,
  SaveSelectionDialog,
} from './SavedSelectionsSections';

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

// ============= Helpers =============

function showSavedSelectionNotification(notification: SavedSelectionNotification) {
  const options = { description: notification.description };

  if (notification.level === 'success') {
    toast.success(notification.title, options);
  } else if (notification.level === 'warning') {
    toast.warning(notification.title, options);
  } else {
    toast.error(notification.title, options);
  }
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
        description: buildSelectionSavedToastDescription(name, selectedCount),
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
        description: buildSelectionLoadedToastDescription(selection),
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
        description: buildSelectionDeletedToastDescription(selection),
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
      const filename = result.filename ?? 'selections.json';
      toast.success('Selections exported', {
        description: buildSelectionsExportedToastDescription(savedSelections.length, filename),
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
      const filename = result.filename ?? 'current-selection.csv';
      toast.success('Selection exported', {
        description: buildCurrentSelectionExportedToastDescription(selectedCount, filename),
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
    async (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const importFileType = classifySelectionImportFile(file.name);

        if (importFileType === 'json') {
          // Import saved selections from JSON
          const { selections, warnings, unmappedCount } = importSelectionsFromJson(text, sampleIds);

          // Save each imported selection
          selections.forEach((s) => {
            saveSelection(s.name, s.color);
          });

          showSavedSelectionNotification(buildJsonImportNotification({
            selectionCount: selections.length,
            warnings,
            unmappedCount,
          }));
        } else if (importFileType === 'csv') {
          // Import single selection from CSV
          const { indices, warnings, unmappedCount } = importSelectionFromCsv(text, sampleIds);
          const notification = buildCsvImportNotification({
            selectedCount: indices.length,
            warnings,
            unmappedCount,
          });

          if (indices.length === 0) {
            showSavedSelectionNotification(notification);
            return;
          }

          // Apply the imported selection
          select(indices, 'replace');
          showSavedSelectionNotification(notification);
        } else {
          showSavedSelectionNotification(buildInvalidImportFileNotification());
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

  const handleOpenSaveDialog = useCallback(() => {
    setSaveDialogOpen(true);
  }, []);

  const handleDeleteAll = useCallback(() => {
    if (confirm('Delete all saved selections?')) {
      savedSelections.forEach((s) => deleteSavedSelection(s.id));
      toast.success('All selections deleted');
    }
  }, [deleteSavedSelection, savedSelections]);

  // Check if current selection matches any saved
  const activeSelectionId = getActiveSavedSelectionId(savedSelections, selectedSamples, selectedCount);

  const sharedControls = (
    <>
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
    </>
  );

  // Compact mode - just show save button
  if (compact) {
    return (
      <CompactSavedSelectionsSection
        className={className}
        savedSelections={savedSelections}
        activeSelectionId={activeSelectionId}
        selectedCount={selectedCount}
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        onOpenSaveDialog={handleOpenSaveDialog}
        onExportCurrentCsv={handleExportCurrentCsv}
        onExportJson={handleExportJson}
        onImport={handleImport}
        onLoadSelection={handleLoad}
        onDeleteSelection={handleDelete}
      >
        {sharedControls}
      </CompactSavedSelectionsSection>
    );
  }

  // Full mode
  return (
    <FullSavedSelectionsSection
      className={className}
      savedSelections={savedSelections}
      activeSelectionId={activeSelectionId}
      selectedCount={selectedCount}
      onOpenSaveDialog={handleOpenSaveDialog}
      onExportCurrentCsv={handleExportCurrentCsv}
      onExportJson={handleExportJson}
      onImport={handleImport}
      onDeleteAll={handleDeleteAll}
      onLoadSelection={handleLoad}
      onDeleteSelection={handleDelete}
    >
      {sharedControls}
    </FullSavedSelectionsSection>
  );
}

export default SavedSelections;

/**
 * Playground - Interactive spectral data preprocessing and visualization
 *
 * Features:
 * - Unified operator format (preprocessing + splitting)
 * - Backend processing via /api/playground/execute
 * - Real-time pipeline execution with caching
 * - Workspace dataset loading
 * - Export to Pipeline Editor and JSON/CSV
 * - Step comparison mode
 * - Fold visualization for cross-validation
 */

import { useCallback, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PlaygroundSidebar, MainCanvas } from '@/components/playground';
import { useSpectralData } from '@/hooks/useSpectralData';
import { usePlaygroundPipeline } from '@/hooks/usePlaygroundPipeline';
import { usePrefetchOperators } from '@/hooks/usePlaygroundQuery';
import {
  exportToPipelineEditor,
  prepareExportToPipelineEditor,
  importFromPipelineEditor,
  getPlaygroundExportData,
  clearPlaygroundExportData,
  PLAYGROUND_EXPORT_KEY,
} from '@/lib/playground/operatorFormat';
import type { OperatorDefinition } from '@/types/playground';

export default function Playground() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Prefetch operators on mount
  usePrefetchOperators();

  // Data loading (now includes workspace support)
  const {
    rawData,
    isLoading: dataLoading,
    error: dataError,
    dataSource,
    currentDatasetInfo,
    loadFile,
    loadDemoData,
    loadFromWorkspace,
    clearData,
  } = useSpectralData();

  // Pipeline with backend integration
  const {
    operators,
    result,
    isProcessing,
    isFetching,
    isDebouncing,
    executionError,
    addOperator,
    addOperatorByName,
    removeOperator,
    updateOperator,
    updateOperatorParams,
    toggleOperator,
    reorderOperators,
    clearPipeline,
    undo,
    redo,
    canUndo,
    canRedo,
    hasSplitter,
    refetch,
    // Step comparison mode
    stepComparisonEnabled,
    setStepComparisonEnabled,
    activeStep,
    setActiveStep,
    maxSteps,
  } = usePlaygroundPipeline(rawData, {
    enableBackend: true,
    sampling: {
      method: 'random',
      n_samples: 100,
    },
  });

  // Handle add operator from definition
  const handleAddOperator = useCallback((definition: OperatorDefinition) => {
    addOperator(definition);
  }, [addOperator]);

  // ============= Export Handlers =============

  // Export pipeline to Pipeline Editor (navigation)
  const handleExportToPipelineEditor = useCallback(() => {
    if (operators.length === 0) {
      toast.warning('No operators to export');
      return;
    }

    // Prepare export data and store in sessionStorage
    const exportData = prepareExportToPipelineEditor(
      operators,
      `Playground Export ${new Date().toLocaleDateString()}`
    );

    toast.success('Pipeline exported', {
      description: `Opening Pipeline Editor with ${exportData.steps.length} operators`,
    });

    // Navigate to Pipeline Editor with source parameter
    navigate('/pipelines/new?source=playground');
  }, [operators, navigate]);

  // Export pipeline as JSON download
  const handleExportPipelineJson = useCallback(() => {
    const editorSteps = exportToPipelineEditor(operators);

    const exportData = {
      name: 'Playground Export',
      description: 'Exported from Playground',
      pipeline: editorSteps.map(step => ({
        [step.type === 'splitting' ? 'split' : 'preprocessing']: step.name,
        ...step.params,
      })),
      exported_at: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playground-pipeline.json';
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Pipeline exported', {
      description: `${operators.length} operators saved to playground-pipeline.json`,
    });
  }, [operators]);

  // Export processed data as CSV
  const handleExportDataCsv = useCallback(() => {
    if (!result?.processed?.spectra || !result.processed.wavelengths) {
      toast.warning('No processed data to export');
      return;
    }

    const { spectra, wavelengths } = result.processed;
    const yValues = rawData?.y ?? [];
    const sampleIds = rawData?.sampleIds ?? [];

    // Build CSV header
    const hasY = yValues.length === spectra.length;
    const hasSampleIds = sampleIds.length === spectra.length;

    const headers: string[] = [];
    if (hasSampleIds) headers.push('sample_id');
    headers.push(...wavelengths.map(w => String(w)));
    if (hasY) headers.push('target');

    // Build CSV rows
    const rows = spectra.map((spectrum, idx) => {
      const row: (string | number)[] = [];
      if (hasSampleIds) row.push(sampleIds[idx]);
      row.push(...spectrum.map(v => v.toFixed(6)));
      if (hasY) row.push(yValues[idx]);
      return row.join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'processed-spectra.csv';
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Data exported', {
      description: `${spectra.length} samples × ${wavelengths.length} wavelengths saved to CSV`,
    });
  }, [result, rawData]);

  // ============= Import Handler =============

  // Import from Pipeline Editor (via URL params)
  const handleImportFromPipelineEditor = useCallback(() => {
    // Check if there's data to import from sessionStorage (reverse flow)
    const importData = getPlaygroundExportData();
    if (importData && importData.source === 'playground') {
      // This is our own export data, clear it
      clearPlaygroundExportData();
      return;
    }

    // Check for pipeline-editor key (different from playground export)
    const editorData = sessionStorage.getItem('pipeline-editor-export-to-playground');
    if (editorData) {
      try {
        const parsed = JSON.parse(editorData);
        if (parsed.steps && Array.isArray(parsed.steps)) {
          const { operators: importedOps, warnings } = importFromPipelineEditor(parsed.steps);

          // Clear pipeline and add imported operators
          clearPipeline();
          importedOps.forEach(op => {
            addOperatorByName(op.name, op.type, op.params);
          });

          // Show warnings if any
          if (warnings.length > 0) {
            toast.warning('Some steps were skipped', {
              description: warnings.slice(0, 2).join('. '),
            });
          } else {
            toast.success('Pipeline imported', {
              description: `${importedOps.length} operators added from Pipeline Editor`,
            });
          }

          // Clear the import data
          sessionStorage.removeItem('pipeline-editor-export-to-playground');
        }
      } catch (e) {
        toast.error('Failed to import pipeline', {
          description: e instanceof Error ? e.message : 'Invalid format',
        });
      }
    } else {
      toast.info('Import from Pipeline Editor', {
        description: 'Open a pipeline in the Pipeline Editor and use "Send to Playground" to import it here.',
      });
    }
  }, [clearPipeline, addOperatorByName]);

  // Check for import data on mount
  useEffect(() => {
    const source = searchParams.get('source');
    if (source === 'pipeline-editor') {
      handleImportFromPipelineEditor();
      // Clean up URL
      navigate('/playground', { replace: true });
    }
  }, [searchParams, handleImportFromPipelineEditor, navigate]);

  // ============= Keyboard Shortcuts =============

  // Keyboard shortcut handler
  const handleKeyboardShortcuts = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }

    // Undo: Ctrl+Z
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }

    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
    }

    // Clear pipeline: Ctrl+Backspace (with confirmation via toast)
    if ((e.ctrlKey || e.metaKey) && e.key === 'Backspace' && operators.length > 0) {
      e.preventDefault();
      toast.warning(`Clear all ${operators.length} operators?`, {
        action: {
          label: 'Clear',
          onClick: clearPipeline,
        },
        duration: 5000,
      });
    }
  }, [undo, redo, clearPipeline, operators.length]);

  // Register keyboard shortcuts
  useEffect(() => {
    window.addEventListener('keydown', handleKeyboardShortcuts);
    return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
  }, [handleKeyboardShortcuts]);

  // Sample selection state for cross-chart highlighting
  const [selectedSample, setSelectedSample] = useState<number | null>(null);

  return (
    <div className="h-full flex -m-6">
      <PlaygroundSidebar
        // Data
        data={rawData}
        isLoading={dataLoading}
        error={dataError}
        dataSource={dataSource}
        currentDatasetInfo={currentDatasetInfo}

        // Pipeline state
        operators={operators}
        hasSplitter={hasSplitter}
        canUndo={canUndo}
        canRedo={canRedo}

        // Execution state
        isProcessing={isProcessing}
        isFetching={isFetching}
        isDebouncing={isDebouncing}
        executionTimeMs={result?.executionTimeMs}
        stepErrors={result?.errors}

        // Data handlers
        onLoadFile={loadFile}
        onLoadDemo={loadDemoData}
        onLoadFromWorkspace={loadFromWorkspace}
        onClearData={clearData}

        // Pipeline handlers
        onAddOperator={handleAddOperator}
        onUpdateOperator={updateOperator}
        onUpdateOperatorParams={updateOperatorParams}
        onRemoveOperator={removeOperator}
        onToggleOperator={toggleOperator}
        onReorderOperators={reorderOperators}
        onClearPipeline={clearPipeline}
        onUndo={undo}
        onRedo={redo}

        // Export handlers
        onExportToPipelineEditor={operators.length > 0 ? handleExportToPipelineEditor : undefined}
        onExportPipelineJson={operators.length > 0 ? handleExportPipelineJson : undefined}
        onExportDataCsv={result?.processed?.spectra ? handleExportDataCsv : undefined}
        onImportPipeline={handleImportFromPipelineEditor}
      />
      <MainCanvas
        rawData={rawData}
        result={result}
        isLoading={isProcessing}
        isFetching={isFetching}
        selectedSample={selectedSample}
        onSelectSample={setSelectedSample}
        operators={operators}
        stepComparisonEnabled={stepComparisonEnabled}
        onStepComparisonEnabledChange={setStepComparisonEnabled}
        activeStep={activeStep}
        onActiveStepChange={setActiveStep}
      />
    </div>
  );
}

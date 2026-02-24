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
 * - Phase 6: Keyboard shortcuts, saved selections, render optimization
 */

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { PlaygroundSidebar, MainCanvas, KeyboardShortcutsHelp } from '@/components/playground';
import { SelectionProvider } from '@/context/SelectionContext';
import { PlaygroundViewProvider } from '@/context/PlaygroundViewContext';
import { FilterProvider } from '@/context/FilterContext';
import { ReferenceDatasetProvider } from '@/context/ReferenceDatasetContext';
import { OutliersProvider } from '@/context/OutliersContext';
import {
  PlaygroundSessionProvider,
  usePlaygroundSession,
  serializeOperators,
  type PlaygroundSessionState,
} from '@/context/PlaygroundSessionContext';
import { NodeRegistryProvider, PipelineEditorPreferencesProvider } from '@/components/pipeline-editor/contexts';
import { useSpectralData } from '@/hooks/useSpectralData';
import { usePlaygroundPipeline } from '@/hooks/usePlaygroundPipeline';
import { usePrefetchOperators } from '@/hooks/usePlaygroundQuery';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import {
  exportToPipelineEditor,
  prepareExportToPipelineEditor,
  importFromPipelineEditor,
  getPlaygroundExportData,
  clearPlaygroundExportData,
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
    loadDemoData,
    loadFromWorkspace,
    clearData,
  } = useSpectralData();

  // Chart visibility toggles — declared before usePlaygroundPipeline so we can
  // derive executeOptions that skip hidden-chart computations on the backend.
  const [chartVisibility, setChartVisibility] = useState({
    spectra: true,
    histogram: true,
    pca: true,
    folds: true,
    repetitions: false,
  });

  const toggleChartVisibility = useCallback((chart: keyof typeof chartVisibility) => {
    setChartVisibility(prev => ({ ...prev, [chart]: !prev[chart] }));
  }, []);

  // Derive execute options from chart visibility — skip PCA/repetitions when hidden
  const visibilityExecuteOptions = useMemo(() => ({
    compute_pca: chartVisibility.pca,
    compute_repetitions: chartVisibility.repetitions,
  }), [chartVisibility.pca, chartVisibility.repetitions]);

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
    computeUmap,
    setComputeUmap,
    isUmapLoading,
    subsetMode,
    setSubsetMode,
    chartLoadingStates,
  } = usePlaygroundPipeline(rawData, {
    enableBackend: true,
    sampling: {
      method: 'all',
    },
    datasetId: currentDatasetInfo?.datasetId,
    executeOptions: visibilityExecuteOptions,
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

  // ============= Keyboard Shortcuts (Phase 6) =============

  // State for shortcuts help dialog
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Render mode state (Phase 6)
  const [renderMode, setRenderMode] = useState<RenderMode>('auto');

  // chartVisibility and toggleChartVisibility are declared above usePlaygroundPipeline
  // so visibility flags can be passed as executeOptions to skip hidden-chart computations.

  // Sample selection state for cross-chart highlighting (legacy - kept for backward compatibility)
  const [selectedSample, setSelectedSample] = useState<number | null>(null);

  // ============= Dataset Selector State =============

  // Whether to show the dataset selector (for changing datasets)
  const [showDatasetSelector, setShowDatasetSelector] = useState(false);

  const handleToggleDatasetSelector = useCallback(() => {
    setShowDatasetSelector(prev => !prev);
  }, []);

  // When a dataset is loaded, hide the selector
  useEffect(() => {
    if (rawData && showDatasetSelector) {
      setShowDatasetSelector(false);
    }
  }, [rawData, showDatasetSelector]);

  // ============= Session Persistence =============

  const sessionRestoredRef = useRef(false);

  // Restore session on mount
  useEffect(() => {
    if (sessionRestoredRef.current) return;

    const stored = sessionStorage.getItem('playground-session-state');
    if (!stored) return;

    try {
      const session: PlaygroundSessionState = JSON.parse(stored);

      // Check if session is still valid (not older than 24 hours)
      if (Date.now() - session.savedAt > 24 * 60 * 60 * 1000) {
        sessionStorage.removeItem('playground-session-state');
        return;
      }

      sessionRestoredRef.current = true;

      // Restore view preferences
      if (session.chartVisibility) {
        setChartVisibility(session.chartVisibility);
      }
      if (session.renderMode) {
        setRenderMode(session.renderMode);
      }
      if (session.stepComparisonEnabled !== undefined) {
        setStepComparisonEnabled(session.stepComparisonEnabled);
      }
      if (session.activeStep !== undefined) {
        setActiveStep(session.activeStep);
      }

      // Restore dataset
      if (session.datasetId && session.datasetName && session.dataSource === 'workspace') {
        loadFromWorkspace(session.datasetId, session.datasetName);
      } else if (session.dataSource === 'demo') {
        loadDemoData();
      }

      // Restore operators (after a small delay to ensure data is loaded)
      if (session.operators && session.operators.length > 0) {
        setTimeout(() => {
          session.operators.forEach(op => {
            addOperatorByName(op.name, op.type, op.params);
          });
        }, 100);
      }
    } catch (e) {
      console.warn('Failed to restore playground session:', e);
      sessionStorage.removeItem('playground-session-state');
    }
  }, [loadFromWorkspace, loadDemoData, addOperatorByName, setStepComparisonEnabled, setActiveStep]);

  // Persist session on state changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      const session: PlaygroundSessionState = {
        datasetId: currentDatasetInfo?.datasetId || null,
        datasetName: currentDatasetInfo?.datasetName || null,
        dataSource: dataSource,
        operators: serializeOperators(operators),
        chartVisibility,
        renderMode,
        stepComparisonEnabled,
        activeStep,
        savedAt: Date.now(),
      };
      sessionStorage.setItem('playground-session-state', JSON.stringify(session));
    }, 500);

    return () => clearTimeout(timeout);
  }, [
    currentDatasetInfo,
    dataSource,
    operators,
    chartVisibility,
    renderMode,
    stepComparisonEnabled,
    activeStep,
  ]);

  // ============= Filter to Selection Handler =============

  /**
   * Handle "Filter to Selection" action from MainCanvas
   * Adds a SampleIndexFilter operator that keeps only the selected sample indices
   */
  const handleFilterToSelection = useCallback((selectedIndices: number[]) => {
    if (selectedIndices.length === 0) {
      toast.warning('No samples selected', {
        description: 'Select samples in a chart first, then click "Filter to Selection".',
      });
      return;
    }

    // Add a SampleIndexFilter operator with the selected indices
    addOperatorByName('SampleIndexFilter', 'filter', {
      indices: selectedIndices,
      mode: 'keep',  // Keep only these indices (vs 'remove')
    });

    toast.success('Filter applied', {
      description: `Keeping ${selectedIndices.length} selected sample${selectedIndices.length !== 1 ? 's' : ''}`,
    });
  }, [addOperatorByName]);

  return (
    <MlLoadingOverlay>
    <PipelineEditorPreferencesProvider>
      <NodeRegistryProvider useJsonRegistry>
        <PlaygroundViewProvider>
          <SelectionProvider>
            <FilterProvider>
              <OutliersProvider>
                <ReferenceDatasetProvider primaryData={rawData} operators={operators}>
                  <PlaygroundContent
                    // Data
                    rawData={rawData}
                    dataLoading={dataLoading}
                    dataError={dataError}
                    dataSource={dataSource}
                    currentDatasetInfo={currentDatasetInfo}
                    // Data handlers
                    loadDemoData={loadDemoData}
                    loadFromWorkspace={loadFromWorkspace}
                    clearData={clearData}
                    // Dataset selector
                    showDatasetSelector={showDatasetSelector}
                    onToggleDatasetSelector={handleToggleDatasetSelector}
                    // Pipeline state
                    operators={operators}
                    result={result}
                    isProcessing={isProcessing}
                    isFetching={isFetching}
                    isDebouncing={isDebouncing}
                    hasSplitter={hasSplitter}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    // Pipeline handlers
                    addOperator={handleAddOperator}
                    updateOperator={updateOperator}
                    updateOperatorParams={updateOperatorParams}
                    removeOperator={removeOperator}
                    toggleOperator={toggleOperator}
                    reorderOperators={reorderOperators}
                    clearPipeline={clearPipeline}
                    undo={undo}
                    redo={redo}
                    // Step comparison
                    stepComparisonEnabled={stepComparisonEnabled}
                    setStepComparisonEnabled={setStepComparisonEnabled}
                    activeStep={activeStep}
                    setActiveStep={setActiveStep}
                    // UMAP
                    computeUmap={computeUmap}
                    setComputeUmap={setComputeUmap}
                    isUmapLoading={isUmapLoading}
                    chartLoadingStates={chartLoadingStates}
                    subsetMode={subsetMode}
                    setSubsetMode={setSubsetMode}
                    // Export handlers
                    exportToPipelineEditor={operators.length > 0 ? handleExportToPipelineEditor : undefined}
                    exportPipelineJson={operators.length > 0 ? handleExportPipelineJson : undefined}
                    exportDataCsv={result?.processed?.spectra ? handleExportDataCsv : undefined}
                    importPipeline={handleImportFromPipelineEditor}
                    // Filter
                    filterToSelection={handleFilterToSelection}
                    addOperatorByName={addOperatorByName}
                    // Shortcuts state
                    showShortcutsHelp={showShortcutsHelp}
                    setShowShortcutsHelp={setShowShortcutsHelp}
                    renderMode={renderMode}
                    setRenderMode={setRenderMode}
                    chartVisibility={chartVisibility}
                    toggleChartVisibility={toggleChartVisibility}
                    selectedSample={selectedSample}
                    setSelectedSample={setSelectedSample}
                  />
                </ReferenceDatasetProvider>
              </OutliersProvider>
            </FilterProvider>
          </SelectionProvider>
        </PlaygroundViewProvider>
      </NodeRegistryProvider>
    </PipelineEditorPreferencesProvider>
    </MlLoadingOverlay>
  );
}

// ============= Inner Component (uses SelectionContext) =============

interface PlaygroundContentProps {
  rawData: ReturnType<typeof useSpectralData>['rawData'];
  dataLoading: boolean;
  dataError: ReturnType<typeof useSpectralData>['error'];
  dataSource: ReturnType<typeof useSpectralData>['dataSource'];
  currentDatasetInfo: ReturnType<typeof useSpectralData>['currentDatasetInfo'];
  loadDemoData: ReturnType<typeof useSpectralData>['loadDemoData'];
  loadFromWorkspace: ReturnType<typeof useSpectralData>['loadFromWorkspace'];
  clearData: ReturnType<typeof useSpectralData>['clearData'];
  showDatasetSelector: boolean;
  onToggleDatasetSelector: () => void;
  operators: ReturnType<typeof usePlaygroundPipeline>['operators'];
  result: ReturnType<typeof usePlaygroundPipeline>['result'];
  isProcessing: boolean;
  isFetching: boolean;
  isDebouncing: boolean;
  hasSplitter: boolean;
  canUndo: boolean;
  canRedo: boolean;
  addOperator: (definition: OperatorDefinition) => void;
  updateOperator: ReturnType<typeof usePlaygroundPipeline>['updateOperator'];
  updateOperatorParams: ReturnType<typeof usePlaygroundPipeline>['updateOperatorParams'];
  removeOperator: ReturnType<typeof usePlaygroundPipeline>['removeOperator'];
  toggleOperator: ReturnType<typeof usePlaygroundPipeline>['toggleOperator'];
  reorderOperators: ReturnType<typeof usePlaygroundPipeline>['reorderOperators'];
  clearPipeline: ReturnType<typeof usePlaygroundPipeline>['clearPipeline'];
  undo: ReturnType<typeof usePlaygroundPipeline>['undo'];
  redo: ReturnType<typeof usePlaygroundPipeline>['redo'];
  stepComparisonEnabled: boolean;
  setStepComparisonEnabled: (enabled: boolean) => void;
  activeStep: number;
  setActiveStep: (step: number) => void;
  computeUmap: boolean;
  setComputeUmap: (compute: boolean) => void;
  isUmapLoading: boolean;
  chartLoadingStates: ReturnType<typeof usePlaygroundPipeline>['chartLoadingStates'];
  subsetMode: 'all' | 'visible';
  setSubsetMode: (mode: 'all' | 'visible') => void;
  exportToPipelineEditor?: () => void;
  exportPipelineJson?: () => void;
  exportDataCsv?: () => void;
  importPipeline: () => void;
  filterToSelection: (indices: number[]) => void;
  addOperatorByName: ReturnType<typeof usePlaygroundPipeline>['addOperatorByName'];
  showShortcutsHelp: boolean;
  setShowShortcutsHelp: (show: boolean) => void;
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;
  chartVisibility: { spectra: boolean; histogram: boolean; pca: boolean; folds: boolean; repetitions: boolean };
  toggleChartVisibility: (chart: 'spectra' | 'histogram' | 'pca' | 'folds' | 'repetitions') => void;
  selectedSample: number | null;
  setSelectedSample: (sample: number | null) => void;
}

import { usePlaygroundShortcuts } from '@/hooks/usePlaygroundShortcuts';
import { usePlaygroundReset } from '@/hooks/usePlaygroundReset';
import { useOutliers } from '@/context/OutliersContext';

function PlaygroundContent({
  rawData,
  dataLoading,
  dataError,
  dataSource,
  currentDatasetInfo,
  loadDemoData,
  loadFromWorkspace,
  clearData,
  showDatasetSelector,
  onToggleDatasetSelector,
  operators,
  result,
  isProcessing,
  isFetching,
  isDebouncing,
  hasSplitter,
  canUndo,
  canRedo,
  addOperator,
  updateOperator,
  updateOperatorParams,
  removeOperator,
  toggleOperator,
  reorderOperators,
  clearPipeline,
  undo,
  redo,
  stepComparisonEnabled,
  setStepComparisonEnabled,
  activeStep,
  setActiveStep,
  computeUmap,
  setComputeUmap,
  isUmapLoading,
  chartLoadingStates,
  subsetMode,
  setSubsetMode,
  exportToPipelineEditor,
  exportPipelineJson,
  exportDataCsv,
  importPipeline,
  filterToSelection,
  showShortcutsHelp,
  setShowShortcutsHelp,
  renderMode,
  setRenderMode,
  chartVisibility,
  toggleChartVisibility,
  selectedSample,
  setSelectedSample,
}: PlaygroundContentProps) {
  // Phase 8: Outliers context for mark-as-outliers functionality
  const { toggleOutliers } = useOutliers();

  // Phase 8: Playground reset hook
  const { resetPlayground, hasStateToReset } = usePlaygroundReset({
    onResetStepComparison: () => {
      setStepComparisonEnabled(false);
      setActiveStep(0);
    },
  });

  // Handle mark as outliers (Ctrl+O)
  const handleMarkAsOutliers = useCallback((indices: number[]) => {
    toggleOutliers(indices);
    toast.success(`Toggled ${indices.length} sample${indices.length !== 1 ? 's' : ''} as outliers`);
  }, [toggleOutliers]);

  // Handle reset playground
  const handleResetPlayground = useCallback(() => {
    resetPlayground();
    toast.success('Playground reset', {
      description: 'All selections, filters, and settings have been cleared',
    });
  }, [resetPlayground]);

  // Use the centralized keyboard shortcuts hook (now inside SelectionProvider)
  const { shortcutsByCategory } = usePlaygroundShortcuts({
    totalSamples: rawData?.spectra?.length ?? 0,
    onUndo: undo,
    onRedo: redo,
    onClearPipeline: () => {
      if (operators.length > 0) {
        toast.warning(`Clear all ${operators.length} operators?`, {
          action: { label: 'Clear', onClick: clearPipeline },
          duration: 5000,
        });
      }
    },
    onSaveSelection: () => toast.info('Save Selection: Use toolbar button'),
    onExportPng: () => toast.info('Export PNG: Use Export menu'),
    onExportData: () => toast.info('Export Data: Use Export menu'),
    onToggleChart: (index: number) => {
      const charts = ['spectra', 'histogram', 'pca', 'folds', 'repetitions'] as const;
      if (index >= 0 && index < charts.length) {
        toggleChartVisibility(charts[index]);
      }
    },
    onShowHelp: () => setShowShortcutsHelp(true),
    onMarkAsOutliers: handleMarkAsOutliers,
    onResetPlayground: handleResetPlayground,
    canUndo,
    canRedo,
  });

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
        filterInfo={result?.filterInfo}

        // Data handlers
        onLoadDemo={loadDemoData}
        onLoadFromWorkspace={loadFromWorkspace}
        onClearData={clearData}

        // Dataset selector
        showDatasetSelector={showDatasetSelector}
        onToggleDatasetSelector={onToggleDatasetSelector}

        // Pipeline handlers
        onAddOperator={addOperator}
        onUpdateOperator={updateOperator}
        onUpdateOperatorParams={updateOperatorParams}
        onRemoveOperator={removeOperator}
        onToggleOperator={toggleOperator}
        onReorderOperators={reorderOperators}
        onClearPipeline={clearPipeline}
        onUndo={undo}
        onRedo={redo}

        // Export handlers
        onExportToPipelineEditor={exportToPipelineEditor}
        onExportPipelineJson={exportPipelineJson}
        onExportDataCsv={exportDataCsv}
        onImportPipeline={importPipeline}
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
        onFilterToSelection={filterToSelection}
        computeUmap={computeUmap}
        onComputeUmapChange={setComputeUmap}
        isUmapLoading={isUmapLoading}
        subsetMode={subsetMode}
        onSubsetModeChange={setSubsetMode}
        // Phase 6 props
        renderMode={renderMode}
        onRenderModeChange={setRenderMode}
        datasetId={currentDatasetInfo?.datasetId ?? 'playground'}
        // Phase 8 props
        onResetPlayground={handleResetPlayground}
        hasStateToReset={hasStateToReset}
        // Granular chart loading
        chartLoadingStates={chartLoadingStates}
      />

      {/* Phase 6: Keyboard shortcuts help dialog */}
      <KeyboardShortcutsHelp
        open={showShortcutsHelp}
        onOpenChange={setShowShortcutsHelp}
        shortcutsByCategory={shortcutsByCategory}
      />
    </div>
  );
}

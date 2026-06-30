/**
 * Playground - Interactive spectral data preprocessing and visualization
 *
 * Features:
 * - Unified operator format (preprocessing + splitting)
 * - Backend processing via /api/playground/execute
 * - Real-time pipeline execution with caching
 * - Workspace dataset loading
 * - Export to Pipeline Editor and JSON/CSV
 * - Fold visualization for cross-validation
 * - Phase 6: Keyboard shortcuts, saved selections, render optimization
 */

import { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { useSpectralData } from '@/hooks/useSpectralData';
import { usePlaygroundPipeline } from '@/hooks/usePlaygroundPipeline';
import { usePrefetchOperators } from '@/hooks/usePlaygroundQuery';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import { buildPlaygroundDataView } from '@/lib/playground/dataView';
import {
  clientStorageKeys,
  readClientStorageString,
  removeClientStorageItem,
  writeClientStorageJson,
} from '@/lib/clientStorage';
import { exportSpectraToCsv } from '@/lib/playground/export';
import {
  prepareExportToPipelineEditor,
  importFromPipelineEditor,
  getPlaygroundExportData,
  clearPlaygroundExportData,
} from '@/lib/playground/operatorFormat';
import {
  PLAYGROUND_PIPELINE_JSON_FILENAME,
  buildPlaygroundPipelineJsonExportPayload,
  buildPlaygroundSessionStatePayload,
  chartVisibilityToExecuteOptions,
  formatPlaygroundPipelineEditorExportName,
  formatPlaygroundPipelineJsonExportDescription,
  parsePipelineEditorImportData,
  parsePlaygroundRouteAction,
  parseStoredPlaygroundSessionState,
  shouldClearOwnPlaygroundExportData,
} from '@/lib/playground/playgroundRouteData';
import type { OperatorDefinition } from '@/types/playground';
import { PlaygroundProviders } from './PlaygroundProviders';
import { PlaygroundContent } from './PlaygroundSections';

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

  const [selectedSourceIndex, setSelectedSourceIndex] = useState<number | null>(null);
  const [selectedTargetIndex, setSelectedTargetIndex] = useState<number | null>(null);
  const datasetSelectionKey = currentDatasetInfo
    ? `${currentDatasetInfo.datasetId}:${currentDatasetInfo.partition}`
    : dataSource;
  const previousDatasetSelectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (previousDatasetSelectionKeyRef.current === datasetSelectionKey) {
      return;
    }
    previousDatasetSelectionKeyRef.current = datasetSelectionKey;
    setSelectedSourceIndex(null);
    setSelectedTargetIndex(null);
  }, [datasetSelectionKey]);

  const playgroundDatasetInfo = useMemo(() => {
    if (!currentDatasetInfo) {
      return null;
    }

    return {
      ...currentDatasetInfo,
      selectedSourceIndex,
      selectedTargetIndex,
      onSelectedSourceIndexChange: setSelectedSourceIndex,
      onSelectedTargetIndexChange: setSelectedTargetIndex,
    };
  }, [currentDatasetInfo, selectedSourceIndex, selectedTargetIndex]);
  const loadedDatasetViewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentDatasetInfo || dataSource !== 'workspace') {
      loadedDatasetViewKeyRef.current = null;
      return;
    }

    const sourceIndex = selectedSourceIndex ?? 0;
    const targetIndex = selectedTargetIndex ?? 0;
    const viewKey = `${currentDatasetInfo.datasetId}:${currentDatasetInfo.partition}:${sourceIndex}:${targetIndex}`;

    if (selectedSourceIndex === null && selectedTargetIndex === null) {
      loadedDatasetViewKeyRef.current = viewKey;
      return;
    }
    if (loadedDatasetViewKeyRef.current === viewKey) {
      return;
    }

    loadedDatasetViewKeyRef.current = viewKey;
    void loadFromWorkspace(
      currentDatasetInfo.datasetId,
      currentDatasetInfo.datasetName,
      currentDatasetInfo.partition,
      {
        trainSamples: currentDatasetInfo.trainSamples,
        testSamples: currentDatasetInfo.testSamples,
        schemaRef: currentDatasetInfo.schemaRef,
      },
      { sourceIndex, targetIndex },
    );
  }, [
    currentDatasetInfo,
    dataSource,
    loadFromWorkspace,
    selectedSourceIndex,
    selectedTargetIndex,
  ]);

  // Derive execute options from chart visibility — skip PCA/repetitions when hidden
  const { pca: pcaChartVisible, repetitions: repetitionsChartVisible } = chartVisibility;
  const visibilityExecuteOptions = useMemo(
    () => chartVisibilityToExecuteOptions({
      pca: pcaChartVisible,
      repetitions: repetitionsChartVisible,
    }),
    [pcaChartVisible, repetitionsChartVisible]
  );

  // Pipeline with backend integration
  const {
    operators,
    result,
    isProcessing,
    isFetching,
    isDebouncing,
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
    datasetPartition: currentDatasetInfo?.partition,
    datasetSourceIndex: currentDatasetInfo ? selectedSourceIndex : null,
    datasetTargetIndex: currentDatasetInfo ? selectedTargetIndex : null,
    executeOptions: visibilityExecuteOptions,
  });

  // Handle add operator from definition
  const handleAddOperator = useCallback((definition: OperatorDefinition) => {
    addOperator(definition);
  }, [addOperator]);

  const dataView = useMemo(
    () => buildPlaygroundDataView(rawData, result, currentDatasetInfo?.schemaRef),
    [currentDatasetInfo?.schemaRef, rawData, result]
  );

  // ============= Export Handlers =============

  // Export pipeline to Pipeline Editor (navigation)
  const handleExportToPipelineEditor = useCallback(() => {
    if (operators.length === 0) {
      toast.warning('No operators to export');
      return;
    }

    // Prepare export data for the Pipeline Editor handoff.
    const exportData = prepareExportToPipelineEditor(
      operators,
      formatPlaygroundPipelineEditorExportName()
    );

    toast.success('Pipeline exported', {
      description: `Opening Pipeline Editor with ${exportData.steps.length} operators`,
    });

    // Navigate to Pipeline Editor with source parameter
    navigate('/pipelines/new?source=playground');
  }, [operators, navigate]);

  // Export pipeline as JSON download
  const handleExportPipelineJson = useCallback(() => {
    const exportData = buildPlaygroundPipelineJsonExportPayload(operators);

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = PLAYGROUND_PIPELINE_JSON_FILENAME;
    a.click();
    URL.revokeObjectURL(url);

    toast.success('Pipeline exported', {
      description: formatPlaygroundPipelineJsonExportDescription(operators.length),
    });
  }, [operators]);

  // Export processed data as CSV
  const handleExportDataCsv = useCallback(() => {
    if (!dataView.processedSpectraExport) {
      toast.warning('No processed data to export');
      return;
    }

    const exportResult = exportSpectraToCsv(dataView.processedSpectraExport, {
      filename: 'processed-spectra',
      includeTimestamp: false,
    });

    if (!exportResult.success) {
      toast.error('Data export failed', {
        description: exportResult.error ?? 'Unable to export processed spectra',
      });
      return;
    }

    toast.success('Data exported', {
      description: `${dataView.processedSampleCount} samples × ${dataView.processedFeatureCount} wavelengths saved to CSV`,
    });
  }, [dataView]);

  // ============= Import Handler =============

  // Import from Pipeline Editor (via URL params)
  const handleImportFromPipelineEditor = useCallback(() => {
    // Check if there's data to import from the reverse Playground export flow.
    const importData = getPlaygroundExportData();
    if (shouldClearOwnPlaygroundExportData(importData)) {
      // This is our own export data, clear it
      clearPlaygroundExportData();
      return;
    }

    // Check for pipeline-editor key (different from playground export)
    const editorData = readClientStorageString(clientStorageKeys.pipelineEditorExportToPlayground);
    const importResult = parsePipelineEditorImportData(editorData);
    if (importResult.status === 'missing') {
      toast.info('Import from Pipeline Editor', {
        description: 'Open a pipeline in the Pipeline Editor and use "Send to Playground" to import it here.',
      });
      return;
    }

    if (importResult.status === 'invalid') {
      toast.error('Failed to import pipeline', {
        description: importResult.error instanceof Error ? importResult.error.message : 'Invalid format',
      });
      return;
    }

    if (importResult.status === 'unsupported') {
      return;
    }

    const { operators: importedOps, warnings } = importFromPipelineEditor(importResult.steps);

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
    removeClientStorageItem(clientStorageKeys.pipelineEditorExportToPlayground);
  }, [clearPipeline, addOperatorByName]);

  // Check for import data or incoming dataset selection on mount
  useEffect(() => {
    const routeAction = parsePlaygroundRouteAction(searchParams);

    if (routeAction.type === 'load-workspace-dataset') {
      // URL-provided dataset wins over any persisted session state.
      sessionRestoredRef.current = true;
      loadFromWorkspace(routeAction.datasetId, routeAction.datasetName);
      navigate('/playground', { replace: true });
      return;
    }

    if (routeAction.type === 'import-from-pipeline-editor') {
      handleImportFromPipelineEditor();
      // Clean up URL
      navigate('/playground', { replace: true });
    }
  }, [searchParams, handleImportFromPipelineEditor, navigate, loadFromWorkspace]);

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

    const stored = readClientStorageString(clientStorageKeys.playgroundSessionState);
    const restoreResult = parseStoredPlaygroundSessionState(stored);

    if (restoreResult.status === 'missing') return;

    if (restoreResult.status === 'expired') {
      removeClientStorageItem(clientStorageKeys.playgroundSessionState);
      return;
    }

    if (restoreResult.status === 'invalid') {
      console.warn('Failed to restore playground session:', restoreResult.error);
      removeClientStorageItem(clientStorageKeys.playgroundSessionState);
      return;
    }

    const { session } = restoreResult;
    sessionRestoredRef.current = true;

    // Restore view preferences
    if (session.chartVisibility) {
      setChartVisibility(session.chartVisibility);
    }
    if (session.renderMode) {
      setRenderMode(session.renderMode);
    }
    // Restore dataset
    if (session.datasetId && session.datasetName && session.dataSource === 'workspace') {
      loadFromWorkspace(session.datasetId, session.datasetName);
    } else if (session.dataSource === 'demo') {
      loadDemoData();
    }
  }, [loadFromWorkspace, loadDemoData]);

  // Persist session on state changes
  useEffect(() => {
    const timeout = setTimeout(() => {
      const session = buildPlaygroundSessionStatePayload({
        datasetId: currentDatasetInfo?.datasetId || null,
        datasetName: currentDatasetInfo?.datasetName || null,
        dataSource: dataSource,
        chartVisibility,
        renderMode,
      });
      writeClientStorageJson(clientStorageKeys.playgroundSessionState, session);
    }, 500);

    return () => clearTimeout(timeout);
  }, [
    currentDatasetInfo,
    dataSource,
    chartVisibility,
    renderMode,
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
      <PlaygroundProviders primaryData={rawData} operators={operators}>
        <PlaygroundContent
          // Data
          rawData={rawData}
          dataLoading={dataLoading}
          dataError={dataError}
          dataSource={dataSource}
          currentDatasetInfo={playgroundDatasetInfo}
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
          exportDataCsv={dataView.processedSpectraExport ? handleExportDataCsv : undefined}
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
      </PlaygroundProviders>
    </MlLoadingOverlay>
  );
}

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
import { useDatasetsQuery } from '@/hooks/useDatasetQueries';
import { buildDatasetSchemaRef } from '@/lib/datasetSchema';
import { buildPlaygroundTargetChoices } from '@/lib/playground/datasetSelectionOptions';
import { formatApiErrorDetail } from '@/api/transport';
import type { Dataset, PartitionKey } from '@/types/datasets';
import { usePlaygroundPipeline } from '@/hooks/usePlaygroundPipeline';
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
  parsePipelineEditorImportData,
  parsePlaygroundRouteAction,
  parseStoredPlaygroundSessionState,
  shouldClearOwnPlaygroundExportData,
} from '@/lib/playground/playgroundRouteData';
import type { OperatorDefinition } from '@/types/playground';
import { PlaygroundProviders } from './PlaygroundProviders';
import { PlaygroundContent } from './PlaygroundSections';
import { useTranslation } from 'react-i18next';

export default function Playground() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Data loading (now includes workspace support)
  const {
    rawData,
    isLoading: dataLoading,
    isSwitchingView,
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

  // The workspace catalogue (shared, persisted cache) describes every dataset's
  // targets, whatever route opened the Playground: its own picker, a dataset's
  // detail page, or a restored session.
  const datasetsQuery = useDatasetsQuery();
  const catalogueDatasets = datasetsQuery.data?.datasets;
  const catalogueSettled = datasetsQuery.data !== undefined || !datasetsQuery.isLoading;
  const currentCatalogueDataset = useMemo<Dataset | null>(
    () => (currentDatasetInfo && dataSource === 'workspace'
      ? catalogueDatasets?.find(dataset => dataset.id === currentDatasetInfo.datasetId) ?? null
      : null),
    [catalogueDatasets, currentDatasetInfo, dataSource],
  );
  const targetChoices = useMemo(
    () => (currentCatalogueDataset ? buildPlaygroundTargetChoices(currentCatalogueDataset) : null),
    [currentCatalogueDataset],
  );
  const currentSchemaRef = useMemo(
    () => (currentCatalogueDataset ? buildDatasetSchemaRef(currentCatalogueDataset) : currentDatasetInfo?.schemaRef),
    [currentCatalogueDataset, currentDatasetInfo?.schemaRef],
  );

  /** Open a workspace dataset on its saved default target. */
  const openWorkspaceDataset = useCallback((
    datasetId: string,
    datasetName: string,
    partition: PartitionKey = 'all',
  ) => {
    const dataset = catalogueDatasets?.find(candidate => candidate.id === datasetId);
    const choices = dataset ? buildPlaygroundTargetChoices(dataset) : null;
    void loadFromWorkspace(
      datasetId,
      dataset?.name ?? datasetName,
      partition,
      dataset
        ? { trainSamples: dataset.train_samples, testSamples: dataset.test_samples, schemaRef: buildDatasetSchemaRef(dataset) }
        : undefined,
      { targetIndex: choices && choices.choices.length > 0 ? choices.defaultIndex : undefined },
    );
  }, [catalogueDatasets, loadFromWorkspace]);

  // Switching the target (or source) keeps the current view on screen until the
  // dataset's values for the new selection arrive; every target-dependent view
  // (colours, histograms, legends, folds, metrics) follows the new values.
  const [pendingTargetIndex, setPendingTargetIndex] = useState<number | null>(null);
  const switchWorkspaceView = useCallback(async (selection: { sourceIndex?: number; targetIndex?: number }) => {
    if (!currentDatasetInfo) return;
    const targetIndex = selection.targetIndex ?? currentDatasetInfo.targetIndex;
    if (selection.targetIndex !== undefined) setPendingTargetIndex(selection.targetIndex);
    try {
      await loadFromWorkspace(
        currentDatasetInfo.datasetId,
        currentDatasetInfo.datasetName,
        currentDatasetInfo.partition,
        {
          trainSamples: currentDatasetInfo.trainSamples,
          testSamples: currentDatasetInfo.testSamples,
          schemaRef: currentDatasetInfo.schemaRef,
        },
        {
          sourceIndex: selection.sourceIndex ?? currentDatasetInfo.sourceIndex,
          targetIndex,
          keepCurrentData: true,
        },
      );
    } catch (error) {
      const target = targetChoices?.choices[targetIndex ?? 0]?.label;
      toast.error(
        selection.targetIndex !== undefined && target
          ? t('playground.upload.targetSwitchFailed', { target })
          : t('playground.upload.viewSwitchFailed'),
        { description: error instanceof Error ? error.message : formatApiErrorDetail((error as { detail?: unknown })?.detail) },
      );
    } finally {
      setPendingTargetIndex(null);
    }
  }, [currentDatasetInfo, loadFromWorkspace, targetChoices, t]);

  const playgroundDatasetInfo = useMemo(() => {
    if (!currentDatasetInfo) {
      return null;
    }

    return {
      ...currentDatasetInfo,
      schemaRef: currentSchemaRef,
      targetChoices: targetChoices?.choices,
      isSwitchingView,
      selectedSourceIndex: currentDatasetInfo.sourceIndex ?? null,
      selectedTargetIndex: pendingTargetIndex ?? currentDatasetInfo.targetIndex ?? (targetChoices ? 0 : null),
      onSelectedSourceIndexChange: (index: number | null) => {
        if (index !== null) void switchWorkspaceView({ sourceIndex: index });
      },
      onSelectedTargetIndexChange: (index: number | null) => {
        if (index !== null) void switchWorkspaceView({ targetIndex: index });
      },
    };
  }, [currentDatasetInfo, currentSchemaRef, targetChoices, isSwitchingView, pendingTargetIndex, switchWorkspaceView]);

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
    datasetSourceIndex: currentDatasetInfo?.sourceIndex,
    datasetTargetIndex: currentDatasetInfo?.targetIndex,
    executeOptions: visibilityExecuteOptions,
  });

  // Handle add operator from definition
  const handleAddOperator = useCallback((definition: OperatorDefinition) => {
    addOperator(definition);
  }, [addOperator]);

  const dataView = useMemo(
    () => buildPlaygroundDataView(rawData, result, currentSchemaRef),
    [currentSchemaRef, rawData, result]
  );

  // ============= Export Handlers =============

  // Export pipeline to Pipeline Editor (navigation)
  const handleExportToPipelineEditor = useCallback(() => {
    if (operators.length === 0) {
      toast.warning(t('playground.page.noOperatorsToExport'));
      return;
    }

    // Prepare export data for the Pipeline Editor handoff.
    const exportData = prepareExportToPipelineEditor(
      operators,
      formatPlaygroundPipelineEditorExportName()
    );

    toast.success(t('playground.page.pipelineExported'), {
      description: t('playground.page.openingEditor', { count: exportData.steps.length }),
    });

    // Navigate to Pipeline Editor with source parameter
    navigate('/pipelines/new?source=playground');
  }, [operators, navigate, t]);

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

    toast.success(t('playground.page.pipelineExported'), {
      description: t('playground.page.pipelineJsonSaved', { count: operators.length, filename: PLAYGROUND_PIPELINE_JSON_FILENAME }),
    });
  }, [operators, t]);

  // Export processed data as CSV
  const handleExportDataCsv = useCallback(() => {
    if (!dataView.processedSpectraExport) {
      toast.warning(t('playground.page.noProcessedData'));
      return;
    }

    const exportResult = exportSpectraToCsv(dataView.processedSpectraExport, {
      filename: 'processed-spectra',
      includeTimestamp: false,
    });

    if (!exportResult.success) {
      toast.error(t('playground.page.dataExportFailed'), {
        description: exportResult.error ?? t('playground.page.dataExportFailedDetail'),
      });
      return;
    }

    toast.success(t('playground.page.dataExported'), {
      description: t('playground.page.dataExportedDetail', { samples: dataView.processedSampleCount, wavelengths: dataView.processedFeatureCount }),
    });
  }, [dataView, t]);

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
      toast.info(t('playground.page.importFromEditor'), {
        description: t('playground.page.importFromEditorHint'),
      });
      return;
    }

    if (importResult.status === 'invalid') {
      toast.error(t('playground.page.importFailed'), {
        description: importResult.error instanceof Error ? importResult.error.message : t('playground.page.invalidFormat'),
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
      addOperatorByName(op.name, op.type, op.params, op.classPath);
    });

    // Show warnings if any
    if (warnings.length > 0) {
      toast.warning(t('playground.page.stepsSkipped'), {
        description: warnings.slice(0, 2).join('. '),
      });
    } else {
      toast.success(t('playground.page.pipelineImported'), {
        description: t('playground.page.operatorsAdded', { count: importedOps.length }),
      });
    }

    // Clear the import data
    removeClientStorageItem(clientStorageKeys.pipelineEditorExportToPlayground);
  }, [clearPipeline, addOperatorByName, t]);

  // Check for import data or incoming dataset selection on mount
  useEffect(() => {
    const routeAction = parsePlaygroundRouteAction(searchParams);

    if (routeAction.type === 'load-workspace-dataset') {
      // URL-provided dataset wins over any persisted session state. Wait for
      // the catalogue so the dataset opens on its saved default target.
      sessionRestoredRef.current = true;
      sessionRestoreAttemptedRef.current = true;
      if (!catalogueSettled) return;
      openWorkspaceDataset(routeAction.datasetId, routeAction.datasetName);
      navigate('/playground', { replace: true });
      return;
    }

    if (routeAction.type === 'import-from-pipeline-editor') {
      handleImportFromPipelineEditor();
      // Clean up URL
      navigate('/playground', { replace: true });
    }
  }, [searchParams, handleImportFromPipelineEditor, navigate, openWorkspaceDataset, catalogueSettled]);

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
  // The stored session is read once the catalogue is known; until then the
  // empty initial state must not overwrite it.
  const sessionRestoreAttemptedRef = useRef(false);

  // Restore session on mount
  useEffect(() => {
    if (sessionRestoredRef.current || !catalogueSettled) return;
    sessionRestoreAttemptedRef.current = true;

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
      openWorkspaceDataset(session.datasetId, session.datasetName);
    } else if (session.dataSource === 'demo') {
      loadDemoData();
    }
  }, [openWorkspaceDataset, loadDemoData, catalogueSettled]);

  // Persist session on state changes
  useEffect(() => {
    if (!sessionRestoreAttemptedRef.current) return;
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
      toast.warning(t('playground.page.noSamplesSelected'), {
        description: t('playground.page.noSamplesSelectedHint'),
      });
      return;
    }

    // Add a SampleIndexFilter operator with the selected indices
    addOperatorByName('SampleIndexFilter', 'filter', {
      indices: selectedIndices,
      mode: 'keep',  // Keep only these indices (vs 'remove')
    });

    toast.success(t('playground.page.filterApplied'), {
      description: t('playground.page.keepingSelected', { count: selectedIndices.length }),
    });
  }, [addOperatorByName, t]);

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
          loadFromWorkspace={openWorkspaceDataset}
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

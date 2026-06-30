import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { toast } from 'sonner';
import { PlaygroundSidebar, MainCanvas, KeyboardShortcutsHelp } from '@/components/playground';
import type { PlaygroundDatasetInfo } from '@/components/playground/DataUpload';
import { useOutliers } from '@/context/useOutliers';
import { usePlaygroundView } from '@/context/usePlaygroundView';
import { usePlaygroundReset } from '@/hooks/usePlaygroundReset';
import { usePlaygroundShortcuts } from '@/hooks/usePlaygroundShortcuts';
import type { usePlaygroundPipeline } from '@/hooks/usePlaygroundPipeline';
import type { useSpectralData, WorkspaceDatasetInfo } from '@/hooks/useSpectralData';
import { buildPlaygroundDataView } from '@/lib/playground/dataView';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { PartitionKey } from '@/types/datasets';
import type { OperatorDefinition } from '@/types/playground';

type ChartVisibility = {
  spectra: boolean;
  histogram: boolean;
  pca: boolean;
  folds: boolean;
  repetitions: boolean;
};

type ChartKey = keyof ChartVisibility;

export interface PlaygroundContentProps {
  rawData: ReturnType<typeof useSpectralData>['rawData'];
  dataLoading: boolean;
  dataError: ReturnType<typeof useSpectralData>['error'];
  dataSource: ReturnType<typeof useSpectralData>['dataSource'];
  currentDatasetInfo: PlaygroundDatasetInfo | null;
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
  chartVisibility: ChartVisibility;
  toggleChartVisibility: (chart: ChartKey) => void;
  selectedSample: number | null;
  setSelectedSample: (sample: number | null) => void;
}

interface PlaygroundLayoutProps {
  sidebar: ReactNode;
  canvas: ReactNode;
  shortcuts: ReactNode;
}

function PlaygroundLayout({ sidebar, canvas, shortcuts }: PlaygroundLayoutProps) {
  return (
    <div className="h-full flex -m-6">
      {sidebar}
      {canvas}
      {shortcuts}
    </div>
  );
}

interface PlaygroundSidebarSectionProps {
  rawData: PlaygroundContentProps['rawData'];
  dataLoading: boolean;
  dataError: PlaygroundContentProps['dataError'];
  dataSource: PlaygroundContentProps['dataSource'];
  currentDatasetInfo: PlaygroundContentProps['currentDatasetInfo'];
  operators: PlaygroundContentProps['operators'];
  result: PlaygroundContentProps['result'];
  isProcessing: boolean;
  isFetching: boolean;
  isDebouncing: boolean;
  hasSplitter: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onLoadDemo: () => void;
  onLoadFromWorkspace: (
    datasetId: string,
    datasetName: string,
    partition?: PartitionKey,
    datasetInfo?: Pick<WorkspaceDatasetInfo, 'trainSamples' | 'testSamples' | 'schemaRef'>,
  ) => void;
  onClearData: () => void;
  showDatasetSelector: boolean;
  onToggleDatasetSelector: () => void;
  onAddOperator: PlaygroundContentProps['addOperator'];
  onUpdateOperator: PlaygroundContentProps['updateOperator'];
  onUpdateOperatorParams: PlaygroundContentProps['updateOperatorParams'];
  onRemoveOperator: PlaygroundContentProps['removeOperator'];
  onToggleOperator: PlaygroundContentProps['toggleOperator'];
  onReorderOperators: PlaygroundContentProps['reorderOperators'];
  onClearPipeline: PlaygroundContentProps['clearPipeline'];
  onUndo: PlaygroundContentProps['undo'];
  onRedo: PlaygroundContentProps['redo'];
  onExportToPipelineEditor?: () => void;
  onExportPipelineJson?: () => void;
  onExportDataCsv?: () => void;
  onImportPipeline: () => void;
}

function PlaygroundSidebarSection({
  rawData,
  dataLoading,
  dataError,
  dataSource,
  currentDatasetInfo,
  operators,
  result,
  isProcessing,
  isFetching,
  isDebouncing,
  hasSplitter,
  canUndo,
  canRedo,
  onLoadDemo,
  onLoadFromWorkspace,
  onClearData,
  showDatasetSelector,
  onToggleDatasetSelector,
  onAddOperator,
  onUpdateOperator,
  onUpdateOperatorParams,
  onRemoveOperator,
  onToggleOperator,
  onReorderOperators,
  onClearPipeline,
  onUndo,
  onRedo,
  onExportToPipelineEditor,
  onExportPipelineJson,
  onExportDataCsv,
  onImportPipeline,
}: PlaygroundSidebarSectionProps) {
  return (
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
      warnings={result?.warnings}
      filterInfo={result?.filterInfo}

      // Data handlers
      onLoadDemo={onLoadDemo}
      onLoadFromWorkspace={onLoadFromWorkspace}
      onClearData={onClearData}

      // Dataset selector
      showDatasetSelector={showDatasetSelector}
      onToggleDatasetSelector={onToggleDatasetSelector}

      // Pipeline handlers
      onAddOperator={onAddOperator}
      onUpdateOperator={onUpdateOperator}
      onUpdateOperatorParams={onUpdateOperatorParams}
      onRemoveOperator={onRemoveOperator}
      onToggleOperator={onToggleOperator}
      onReorderOperators={onReorderOperators}
      onClearPipeline={onClearPipeline}
      onUndo={onUndo}
      onRedo={onRedo}

      // Export handlers
      onExportToPipelineEditor={onExportToPipelineEditor}
      onExportPipelineJson={onExportPipelineJson}
      onExportDataCsv={onExportDataCsv}
      onImportPipeline={onImportPipeline}
    />
  );
}

interface PlaygroundCanvasSectionProps {
  rawData: PlaygroundContentProps['rawData'];
  result: PlaygroundContentProps['result'];
  isProcessing: boolean;
  isFetching: boolean;
  selectedSample: number | null;
  onSelectSample: (sample: number | null) => void;
  operators: PlaygroundContentProps['operators'];
  onFilterToSelection: (indices: number[]) => void;
  computeUmap: boolean;
  onComputeUmapChange: (compute: boolean) => void;
  isUmapLoading: boolean;
  subsetMode: PlaygroundContentProps['subsetMode'];
  onSubsetModeChange: PlaygroundContentProps['setSubsetMode'];
  renderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  datasetId: string;
  datasetSchemaRef?: NonNullable<PlaygroundContentProps['currentDatasetInfo']>['schemaRef'];
  onChartToggle: PlaygroundContentProps['toggleChartVisibility'];
  chartLoadingStates: PlaygroundContentProps['chartLoadingStates'];
}

function PlaygroundCanvasSection({
  rawData,
  result,
  isProcessing,
  isFetching,
  selectedSample,
  onSelectSample,
  operators,
  onFilterToSelection,
  computeUmap,
  onComputeUmapChange,
  isUmapLoading,
  subsetMode,
  onSubsetModeChange,
  renderMode,
  onRenderModeChange,
  datasetId,
  datasetSchemaRef,
  onChartToggle,
  chartLoadingStates,
}: PlaygroundCanvasSectionProps) {
  return (
    <MainCanvas
      rawData={rawData}
      result={result}
      metrics={result?.metrics ?? null}
      isLoading={isProcessing}
      isFetching={isFetching}
      selectedSample={selectedSample}
      onSelectSample={onSelectSample}
      operators={operators}
      onFilterToSelection={onFilterToSelection}
      computeUmap={computeUmap}
      onComputeUmapChange={onComputeUmapChange}
      isUmapLoading={isUmapLoading}
      subsetMode={subsetMode}
      onSubsetModeChange={onSubsetModeChange}
      // Phase 6 props
      renderMode={renderMode}
      onRenderModeChange={onRenderModeChange}
      datasetId={datasetId}
      datasetSchemaRef={datasetSchemaRef}
      // Sync execute options (compute_repetitions, compute_pca) when toolbar toggles a chart
      onChartToggle={onChartToggle}
      // Granular chart loading
      chartLoadingStates={chartLoadingStates}
    />
  );
}

interface PlaygroundShortcutsSectionProps {
  showShortcutsHelp: boolean;
  setShowShortcutsHelp: (show: boolean) => void;
  shortcutsByCategory: ReturnType<typeof usePlaygroundShortcuts>['shortcutsByCategory'];
}

function PlaygroundShortcutsSection({
  showShortcutsHelp,
  setShowShortcutsHelp,
  shortcutsByCategory,
}: PlaygroundShortcutsSectionProps) {
  return (
    <KeyboardShortcutsHelp
      open={showShortcutsHelp}
      onOpenChange={setShowShortcutsHelp}
      shortcutsByCategory={shortcutsByCategory}
    />
  );
}

// Uses providers mounted by PlaygroundProviders in Playground.tsx.
export function PlaygroundContent({
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
  toggleChartVisibility,
  selectedSample,
  setSelectedSample,
}: PlaygroundContentProps) {
  // View context is needed to sync keyboard shortcut chart toggles with view state.
  const viewContext = usePlaygroundView();

  const resetPipelineForDatasetChange = useCallback(() => {
    if (operators.length > 0) {
      clearPipeline();
    }
  }, [operators.length, clearPipeline]);

  const handleLoadDemoData = useCallback(() => {
    resetPipelineForDatasetChange();
    loadDemoData();
  }, [resetPipelineForDatasetChange, loadDemoData]);

  const handleLoadFromWorkspace = useCallback((
    datasetId: string,
    datasetName: string,
    partition?: PartitionKey,
    datasetInfo?: Pick<WorkspaceDatasetInfo, 'trainSamples' | 'testSamples' | 'schemaRef'>,
  ) => {
    resetPipelineForDatasetChange();
    loadFromWorkspace(datasetId, datasetName, partition, datasetInfo);
  }, [resetPipelineForDatasetChange, loadFromWorkspace]);

  const handleClearData = useCallback(() => {
    resetPipelineForDatasetChange();
    clearData();
  }, [resetPipelineForDatasetChange, clearData]);

  // Phase 8: Outliers context for mark-as-outliers functionality
  const { toggleOutliers, setDetectedOutliers, clearDetectedOutliers } = useOutliers();

  // Feed tagged samples from filter "tag" mode into OutliersContext
  useEffect(() => {
    const taggedSamples = result?.filterInfo?.tagged_samples;
    if (taggedSamples && Object.keys(taggedSamples).length > 0) {
      const allTagged = Object.values(taggedSamples).flat();
      setDetectedOutliers(allTagged);
    } else {
      clearDetectedOutliers();
    }
  }, [result?.filterInfo?.tagged_samples, setDetectedOutliers, clearDetectedOutliers]);

  const dataView = useMemo(
    () => buildPlaygroundDataView(rawData, result, currentDatasetInfo?.schemaRef),
    [currentDatasetInfo?.schemaRef, rawData, result]
  );

  // Phase 8: Playground reset hook
  const { resetPlayground } = usePlaygroundReset();

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
    totalSamples: dataView.sampleCount,
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
        viewContext.toggleChart(charts[index]);
      }
    },
    onShowHelp: () => setShowShortcutsHelp(true),
    onMarkAsOutliers: handleMarkAsOutliers,
    onResetPlayground: handleResetPlayground,
    canUndo,
    canRedo,
  });

  return (
    <PlaygroundLayout
      sidebar={
        <PlaygroundSidebarSection
          rawData={rawData}
          dataLoading={dataLoading}
          dataError={dataError}
          dataSource={dataSource}
          currentDatasetInfo={currentDatasetInfo}
          operators={operators}
          result={result}
          isProcessing={isProcessing}
          isFetching={isFetching}
          isDebouncing={isDebouncing}
          hasSplitter={hasSplitter}
          canUndo={canUndo}
          canRedo={canRedo}
          onLoadDemo={handleLoadDemoData}
          onLoadFromWorkspace={handleLoadFromWorkspace}
          onClearData={handleClearData}
          showDatasetSelector={showDatasetSelector}
          onToggleDatasetSelector={onToggleDatasetSelector}
          onAddOperator={addOperator}
          onUpdateOperator={updateOperator}
          onUpdateOperatorParams={updateOperatorParams}
          onRemoveOperator={removeOperator}
          onToggleOperator={toggleOperator}
          onReorderOperators={reorderOperators}
          onClearPipeline={clearPipeline}
          onUndo={undo}
          onRedo={redo}
          onExportToPipelineEditor={exportToPipelineEditor}
          onExportPipelineJson={exportPipelineJson}
          onExportDataCsv={exportDataCsv}
          onImportPipeline={importPipeline}
        />
      }
      canvas={
        <PlaygroundCanvasSection
          rawData={rawData}
          result={result}
          isProcessing={isProcessing}
          isFetching={isFetching}
          selectedSample={selectedSample}
          onSelectSample={setSelectedSample}
          operators={operators}
          onFilterToSelection={filterToSelection}
          computeUmap={computeUmap}
          onComputeUmapChange={setComputeUmap}
          isUmapLoading={isUmapLoading}
          subsetMode={subsetMode}
          onSubsetModeChange={setSubsetMode}
          renderMode={renderMode}
          onRenderModeChange={setRenderMode}
          datasetId={currentDatasetInfo?.datasetId ?? 'playground'}
          datasetSchemaRef={currentDatasetInfo?.schemaRef}
          onChartToggle={toggleChartVisibility}
          chartLoadingStates={chartLoadingStates}
        />
      }
      shortcuts={
        <PlaygroundShortcutsSection
          showShortcutsHelp={showShortcutsHelp}
          setShowShortcutsHelp={setShowShortcutsHelp}
          shortcutsByCategory={shortcutsByCategory}
        />
      }
    />
  );
}

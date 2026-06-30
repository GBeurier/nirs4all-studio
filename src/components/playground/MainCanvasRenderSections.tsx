import { CanvasToolbar, type CanvasToolbarProps } from './CanvasToolbar';
import { MainCanvasDimensionReductionPanel } from './MainCanvasDimensionReductionPanel';
import { MainCanvasEmbeddingOverlay } from './MainCanvasEmbeddingOverlay';
import { MainCanvasFoldDistributionPanel } from './MainCanvasFoldDistributionPanel';
import { MainCanvasHistogramPanel } from './MainCanvasHistogramPanel';
import { MainCanvasMinimizedChartsBar } from './MainCanvasMinimizedChartsBar';
import { MainCanvasRawDataModeBanner } from './MainCanvasRawDataModeBanner';
import { MainCanvasRepetitionsPanel } from './MainCanvasRepetitionsPanel';
import { MainCanvasSpectraPanel } from './MainCanvasSpectraPanel';
import { SampleDetails } from './SampleDetails';
import { cn } from '@/lib/utils';
import type { ChartType } from '@/context/usePlaygroundView';
import type { CanvasChartRenderStates } from '@/lib/playground/canvasLayout';
import type {
  DimensionReductionChartDataInput,
  EmbeddingOverlayInput,
  FoldDistributionChartDataInput,
  HistogramChartDataInput,
  RepetitionsChartDataInput,
  SpectraChartDataInput,
} from '@/lib/playground/chartInputs';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { DataSection, UnifiedOperator } from '@/types/playground';
import type { ProcessedData } from '@/types/spectral';
import type { ChartRefs } from './hooks/usePlaygroundExport';
import type { MainCanvasChartActions } from './hooks/useMainCanvasViewState';

interface MainCanvasSampleDetailsMountProps {
  data: ProcessedData | null;
  selectedSample: number | null;
  onClose: () => void;
}

function MainCanvasSampleDetailsMount({
  data,
  selectedSample,
  onClose,
}: MainCanvasSampleDetailsMountProps) {
  if (selectedSample === null || !data) {
    return null;
  }

  return (
    <SampleDetails
      data={data}
      sampleIndex={selectedSample}
      onClose={onClose}
    />
  );
}

function MainCanvasToolbarSection(props: CanvasToolbarProps) {
  return <CanvasToolbar {...props} />;
}

export interface MainCanvasChartGridProps {
  gridCols: string;
  gridRows: string;
  chartRefs: ChartRefs;
  chartRenderStates: CanvasChartRenderStates;
  spectraChartInput: SpectraChartDataInput | null;
  embeddingOverlayInput: EmbeddingOverlayInput | null;
  histogramChartInput: HistogramChartDataInput;
  foldDistributionChartInput: FoldDistributionChartDataInput;
  dimensionReductionChartInput: DimensionReductionChartDataInput | null;
  repetitionsChartInput: RepetitionsChartDataInput;
  totalSamples: number;
  histogramSampleCount: number;
  selectedCount: number;
  pinnedCount: number;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  onInteractionStart: () => void;
  operators: UnifiedOperator[];
  renderMode: RenderMode;
  displayRenderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  spectraOutlierIndices?: Set<number>;
  referenceDataset?: DataSection | null;
  referenceLabel?: string;
  spectraConfigResult: UseSpectraChartConfigResult;
  showAbsoluteDifference: boolean;
  showEmbeddingOverlay: boolean;
  onToggleEmbeddingOverlay?: () => void;
  isSecondaryChartsStale: boolean;
  isUmapLoading: boolean;
  onRequestUMAP?: () => void;
  chartActions: Record<ChartType, MainCanvasChartActions>;
  minimizedCharts: ChartType[];
  onRestore: (chart: ChartType) => void;
  onHide: (chart: ChartType) => void;
}

function MainCanvasChartGrid({
  gridCols,
  gridRows,
  chartRefs,
  chartRenderStates,
  spectraChartInput,
  embeddingOverlayInput,
  histogramChartInput,
  foldDistributionChartInput,
  dimensionReductionChartInput,
  repetitionsChartInput,
  totalSamples,
  histogramSampleCount,
  selectedCount,
  pinnedCount,
  colorConfig,
  colorContext,
  onInteractionStart,
  operators,
  renderMode,
  displayRenderMode,
  onRenderModeChange,
  spectraOutlierIndices,
  referenceDataset,
  referenceLabel,
  spectraConfigResult,
  showAbsoluteDifference,
  showEmbeddingOverlay,
  onToggleEmbeddingOverlay,
  isSecondaryChartsStale,
  isUmapLoading,
  onRequestUMAP,
  chartActions,
  minimizedCharts,
  onRestore,
  onHide,
}: MainCanvasChartGridProps) {
  return (
    <div
      className={cn(
        'flex-1 p-3 overflow-auto grid gap-3',
        'transition-all duration-200 ease-in-out',
        gridCols,
        gridRows
      )}
      role="region"
      aria-label="Data visualization charts"
    >
      <MainCanvasSpectraPanel
        ref={chartRefs.spectra}
        renderState={chartRenderStates.spectra}
        input={spectraChartInput}
        sampleCount={totalSamples}
        selectedCount={selectedCount}
        pinnedCount={pinnedCount}
        colorConfig={colorConfig}
        colorContext={colorContext}
        onInteractionStart={onInteractionStart}
        operators={operators}
        renderMode={renderMode}
        displayRenderMode={displayRenderMode}
        onRenderModeChange={onRenderModeChange}
        outlierIndices={spectraOutlierIndices}
        referenceDataset={referenceDataset}
        referenceLabel={referenceLabel}
        configResult={spectraConfigResult}
        showAbsoluteDifference={showAbsoluteDifference}
        {...chartActions.spectra}
      />

      <MainCanvasEmbeddingOverlay
        input={embeddingOverlayInput}
        visible={showEmbeddingOverlay}
        onToggleExpanded={onToggleEmbeddingOverlay}
      />

      <MainCanvasHistogramPanel
        ref={chartRefs.histogram}
        renderState={chartRenderStates.histogram}
        input={histogramChartInput}
        stale={isSecondaryChartsStale}
        sampleCount={histogramSampleCount}
        selectedCount={selectedCount}
        colorConfig={colorConfig}
        colorContext={colorContext}
        {...chartActions.histogram}
      />

      <MainCanvasFoldDistributionPanel
        ref={chartRefs.folds}
        renderState={chartRenderStates.folds}
        input={foldDistributionChartInput}
        stale={isSecondaryChartsStale}
        sampleCount={totalSamples}
        colorConfig={colorConfig}
        colorContext={colorContext}
        {...chartActions.folds}
      />

      <MainCanvasDimensionReductionPanel
        ref={chartRefs.pca}
        renderState={chartRenderStates.pca}
        input={dimensionReductionChartInput}
        stale={isSecondaryChartsStale}
        sampleCount={totalSamples}
        selectedCount={selectedCount}
        isUmapLoading={isUmapLoading}
        colorConfig={colorConfig}
        colorContext={colorContext}
        onRequestUMAP={onRequestUMAP}
        {...chartActions.pca}
      />

      <MainCanvasRepetitionsPanel
        ref={chartRefs.repetitions}
        renderState={chartRenderStates.repetitions}
        input={repetitionsChartInput}
        stale={isSecondaryChartsStale}
        sampleCount={totalSamples}
        colorConfig={colorConfig}
        colorContext={colorContext}
        configResult={spectraConfigResult}
        {...chartActions.repetitions}
      />

      <MainCanvasMinimizedChartsBar
        minimizedCharts={minimizedCharts}
        onRestore={onRestore}
        onHide={onHide}
      />
    </div>
  );
}

export interface MainCanvasRenderSectionsProps {
  sampleDetailsData: ProcessedData | null;
  selectedSample: number | null;
  onCloseSampleDetails: () => void;
  showRawDataModeBanner: boolean;
  toolbarProps: CanvasToolbarProps;
  chartGridProps: MainCanvasChartGridProps;
}

export function MainCanvasRenderSections({
  sampleDetailsData,
  selectedSample,
  onCloseSampleDetails,
  showRawDataModeBanner,
  toolbarProps,
  chartGridProps,
}: MainCanvasRenderSectionsProps) {
  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      <MainCanvasSampleDetailsMount
        data={sampleDetailsData}
        selectedSample={selectedSample}
        onClose={onCloseSampleDetails}
      />

      {showRawDataModeBanner && <MainCanvasRawDataModeBanner />}

      <MainCanvasToolbarSection {...toolbarProps} />

      <MainCanvasChartGrid {...chartGridProps} />
    </div>
  );
}

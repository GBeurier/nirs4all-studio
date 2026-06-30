import { forwardRef } from 'react';

import { ChartPanel } from './ChartPanel';
import { ChartSkeleton, SpectraChart } from './visualizations';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { SpectraChartDataInput } from '@/lib/playground/chartInputs';
import type { RenderMode } from '@/lib/playground/renderOptimizer';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';
import type { DataSection, UnifiedOperator } from '@/types/playground';

export interface MainCanvasSpectraPanelProps {
  renderState: CanvasChartRenderState;
  input: SpectraChartDataInput | null;
  sampleCount: number;
  selectedCount: number;
  pinnedCount: number;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  onInteractionStart: () => void;
  operators: UnifiedOperator[];
  renderMode: RenderMode;
  displayRenderMode: RenderMode;
  onRenderModeChange: (mode: RenderMode) => void;
  outlierIndices?: Set<number>;
  referenceDataset?: DataSection | null;
  referenceLabel?: string;
  configResult: UseSpectraChartConfigResult;
  showAbsoluteDifference: boolean;
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export const MainCanvasSpectraPanel = forwardRef<HTMLDivElement, MainCanvasSpectraPanelProps>(
  function MainCanvasSpectraPanel(
    {
      renderState,
      input,
      sampleCount,
      selectedCount,
      pinnedCount,
      colorConfig,
      colorContext,
      onInteractionStart,
      operators,
      renderMode,
      displayRenderMode,
      onRenderModeChange,
      outlierIndices,
      referenceDataset,
      referenceLabel,
      configResult,
      showAbsoluteDifference,
      onMaximize,
      onMinimize,
      onRestore,
      onHide,
    },
    ref
  ) {
    if (!renderState.shouldRender) {
      return null;
    }

    return (
      <ChartPanel
        ref={ref}
        chartType="spectra"
        viewState={renderState.viewState}
        isMaximized={renderState.isMaximized}
        isLoading={renderState.isLoading}
        onMaximize={onMaximize}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onHide={onHide}
        sampleCount={sampleCount}
        selectedCount={selectedCount}
        pinnedCount={pinnedCount}
        className=""
      >
        {renderState.showSkeleton ? (
          <ChartSkeleton type="spectra" />
        ) : input ? (
          <SpectraChart
            original={input.original}
            processed={input.processed}
            y={input.y}
            sampleIds={input.sampleIds}
            folds={input.folds}
            globalColorConfig={colorConfig}
            colorContext={colorContext}
            onInteractionStart={onInteractionStart}
            isLoading={renderState.isLoading}
            operators={operators}
            metadata={input.metadata}
            metadataColumns={input.metadataColumns}
            renderMode={renderMode}
            displayRenderMode={displayRenderMode}
            onRenderModeChange={onRenderModeChange}
            outlierIndices={outlierIndices}
            referenceDataset={referenceDataset}
            referenceLabel={referenceLabel}
            externalConfig={configResult}
            showAbsoluteDifference={showAbsoluteDifference}
          />
        ) : (
          <ChartSkeleton type="spectra" />
        )}
      </ChartPanel>
    );
  }
);

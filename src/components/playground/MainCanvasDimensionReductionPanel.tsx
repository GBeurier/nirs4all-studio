import { forwardRef } from 'react';

import { ChartPanel } from './ChartPanel';
import { MainCanvasStaleChartContent } from './MainCanvasStaleChartContent';
import { ChartSkeleton, DimensionReductionChart } from './visualizations';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { DimensionReductionChartDataInput } from '@/lib/playground/chartInputs';

export interface MainCanvasDimensionReductionPanelProps {
  renderState: CanvasChartRenderState;
  input: DimensionReductionChartDataInput | null;
  stale: boolean;
  sampleCount: number;
  selectedCount: number;
  isUmapLoading: boolean;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  onRequestUMAP?: () => void;
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export const MainCanvasDimensionReductionPanel = forwardRef<HTMLDivElement, MainCanvasDimensionReductionPanelProps>(
  function MainCanvasDimensionReductionPanel(
    {
      renderState,
      input,
      stale,
      sampleCount,
      selectedCount,
      isUmapLoading,
      colorConfig,
      colorContext,
      onRequestUMAP,
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
        chartType="pca"
        viewState={renderState.viewState}
        isMaximized={renderState.isMaximized}
        isLoading={renderState.isLoading}
        onMaximize={onMaximize}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onHide={onHide}
        sampleCount={sampleCount}
        selectedCount={selectedCount}
      >
        {renderState.showSkeleton ? (
          <ChartSkeleton type="pca" />
        ) : input ? (
          <MainCanvasStaleChartContent stale={stale}>
            <DimensionReductionChart
              pca={input.pca}
              umap={input.umap}
              y={input.y}
              folds={input.folds}
              sampleIds={input.sampleIds}
              metadata={input.metadata}
              useSelectionContext
              onRequestUMAP={onRequestUMAP}
              isUMAPLoading={isUmapLoading}
              globalColorConfig={colorConfig}
              colorContext={colorContext}
              referencePca={input.referencePca}
              referenceLabel={input.referenceLabel}
            />
          </MainCanvasStaleChartContent>
        ) : (
          <ChartSkeleton type="pca" />
        )}
      </ChartPanel>
    );
  }
);

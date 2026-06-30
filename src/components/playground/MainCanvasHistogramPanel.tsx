import { forwardRef } from 'react';

import { ChartPanel } from './ChartPanel';
import { MainCanvasStaleChartContent } from './MainCanvasStaleChartContent';
import { ChartSkeleton, YHistogram } from './visualizations';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { HistogramChartDataInput } from '@/lib/playground/chartInputs';

export interface MainCanvasHistogramPanelProps {
  renderState: CanvasChartRenderState;
  input: HistogramChartDataInput;
  stale: boolean;
  sampleCount: number;
  selectedCount: number;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export const MainCanvasHistogramPanel = forwardRef<HTMLDivElement, MainCanvasHistogramPanelProps>(
  function MainCanvasHistogramPanel(
    {
      renderState,
      input,
      stale,
      sampleCount,
      selectedCount,
      colorConfig,
      colorContext,
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
        chartType="histogram"
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
          <ChartSkeleton type="histogram" />
        ) : input.hasYValues ? (
          <MainCanvasStaleChartContent stale={stale}>
            <YHistogram
              y={input.y}
              folds={input.folds}
              metadata={input.metadata}
              useSelectionContext
              globalColorConfig={colorConfig}
              colorContext={colorContext}
            />
          </MainCanvasStaleChartContent>
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
            No Y values available
          </div>
        )}
      </ChartPanel>
    );
  }
);

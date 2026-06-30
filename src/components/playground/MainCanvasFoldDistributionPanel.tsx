import { forwardRef } from 'react';

import { ChartPanel } from './ChartPanel';
import { MainCanvasStaleChartContent } from './MainCanvasStaleChartContent';
import { ChartSkeleton, FoldDistributionChart } from './visualizations';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { FoldDistributionChartDataInput } from '@/lib/playground/chartInputs';

export interface MainCanvasFoldDistributionPanelProps {
  renderState: CanvasChartRenderState;
  input: FoldDistributionChartDataInput;
  stale: boolean;
  sampleCount: number;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export const MainCanvasFoldDistributionPanel = forwardRef<HTMLDivElement, MainCanvasFoldDistributionPanelProps>(
  function MainCanvasFoldDistributionPanel(
    {
      renderState,
      input,
      stale,
      sampleCount,
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
        chartType="folds"
        viewState={renderState.viewState}
        isMaximized={renderState.isMaximized}
        isLoading={renderState.isLoading}
        onMaximize={onMaximize}
        onMinimize={onMinimize}
        onRestore={onRestore}
        onHide={onHide}
        sampleCount={sampleCount}
      >
        {renderState.showSkeleton ? (
          <ChartSkeleton type="folds" />
        ) : (
          <MainCanvasStaleChartContent stale={stale}>
            <FoldDistributionChart
              folds={input.folds}
              y={input.y}
              metadata={input.metadata}
              useSelectionContext
              globalColorConfig={colorConfig}
              colorContext={colorContext}
            />
          </MainCanvasStaleChartContent>
        )}
      </ChartPanel>
    );
  }
);

import { forwardRef } from 'react';

import { ChartPanel } from './ChartPanel';
import { MainCanvasStaleChartContent } from './MainCanvasStaleChartContent';
import { ChartSkeleton, RepetitionsChart } from './visualizations';
import type { CanvasChartRenderState } from '@/lib/playground/canvasLayout';
import type { ColorContext, GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { RepetitionsChartDataInput } from '@/lib/playground/chartInputs';
import type { UseSpectraChartConfigResult } from '@/lib/playground/useSpectraChartConfig';

export interface MainCanvasRepetitionsPanelProps {
  renderState: CanvasChartRenderState;
  input: RepetitionsChartDataInput;
  stale: boolean;
  sampleCount: number;
  colorConfig: GlobalColorConfig;
  colorContext: ColorContext;
  configResult: UseSpectraChartConfigResult;
  onMaximize: () => void;
  onMinimize: () => void;
  onRestore: () => void;
  onHide: () => void;
}

export const MainCanvasRepetitionsPanel = forwardRef<HTMLDivElement, MainCanvasRepetitionsPanelProps>(
  function MainCanvasRepetitionsPanel(
    {
      renderState,
      input,
      stale,
      sampleCount,
      colorConfig,
      colorContext,
      configResult,
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
        chartType="repetitions"
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
          <ChartSkeleton type="histogram" />
        ) : (
          <MainCanvasStaleChartContent stale={stale}>
            <RepetitionsChart
              repetitionData={input.repetitionData}
              spectraData={input.spectraData}
              y={input.y}
              useSelectionContext
              globalColorConfig={colorConfig}
              colorContext={colorContext}
              configResult={configResult}
              metadata={input.metadata}
              metadataColumns={input.metadataColumns}
              sampleIds={input.sampleIds}
            />
          </MainCanvasStaleChartContent>
        )}
      </ChartPanel>
    );
  }
);

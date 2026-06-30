import type { MouseEvent, MouseEventHandler, RefObject } from 'react';

import { SelectionContainer } from '@/components/playground/SelectionTools';
import type { SelectionResult } from '@/components/playground/selectionGeometry';
import type { SelectionToolType } from '@/context/useSelection';
import type {
  RepetitionQuantileValue,
  RepetitionsPlotDataPoint,
  RepetitionsWebglData,
} from '@/lib/playground/repetitionsChartData';
import type { DataBounds } from './scatter';
import { ChartLoadingOverlay } from './ChartLoadingOverlay';
import { RepetitionsRechartsPlot } from './RepetitionsRechartsPlot';
import { RepetitionsWebglOverlays } from './RepetitionsWebglOverlays';
import { RepetitionsWebglPlot } from './RepetitionsWebglPlot';
import { WebglIndicatorBadge } from './WebglIndicatorBadge';

interface RepetitionsRendererSurfaceProps {
  chartRef: RefObject<HTMLDivElement | null>;
  rendererType: 'recharts' | 'webgl';
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  useSelectionContext: boolean;
  isPanning: boolean;
  isComputing: boolean;
  onRechartsSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onWebglSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onBackgroundClick: (modifiers: { shift: boolean; ctrl: boolean }) => void;
  onPanMouseDown: MouseEventHandler<HTMLDivElement>;
  onPanMouseMove: MouseEventHandler<HTMLDivElement>;
  onPanMouseUp: MouseEventHandler<HTMLDivElement>;
  onPanMouseLeave: MouseEventHandler<HTMLDivElement>;
  onDoubleClick: MouseEventHandler<HTMLDivElement>;
  onContextMenu: MouseEventHandler<HTMLDivElement>;
  webglBounds: DataBounds;
  scaleType: 'linear' | 'log';
  xTicks: number[];
  bioSampleCount: number;
  showGrid: boolean;
  enableHover: boolean;
  quantileValues: RepetitionQuantileValue[];
  formatXAxisTick: (value: number) => string;
  plotData: RepetitionsPlotDataPoint[];
  effectiveXDomain: [number, number];
  yDomain: [number, number];
  getPointColor: (point: RepetitionsPlotDataPoint) => string;
  onPointClick: (point: RepetitionsPlotDataPoint, event?: MouseEvent) => void;
  webglData: RepetitionsWebglData;
  clearWebglOnBackgroundClick: boolean;
}

export function RepetitionsRendererSurface({
  chartRef,
  rendererType,
  selectionTool,
  selectionEnabled,
  useSelectionContext,
  isPanning,
  isComputing,
  onRechartsSelectionComplete,
  onWebglSelectionComplete,
  onBackgroundClick,
  onPanMouseDown,
  onPanMouseMove,
  onPanMouseUp,
  onPanMouseLeave,
  onDoubleClick,
  onContextMenu,
  webglBounds,
  scaleType,
  xTicks,
  bioSampleCount,
  showGrid,
  enableHover,
  quantileValues,
  formatXAxisTick,
  plotData,
  effectiveXDomain,
  yDomain,
  getPointColor,
  onPointClick,
  webglData,
  clearWebglOnBackgroundClick,
}: RepetitionsRendererSurfaceProps) {
  return (
    <SelectionContainer
      mode={selectionTool}
      onSelectionComplete={rendererType === 'recharts' ? onRechartsSelectionComplete : onWebglSelectionComplete}
      onBackgroundClick={onBackgroundClick}
      enabled={selectionEnabled}
      className="flex-1 min-h-0"
    >
      <div
        ref={chartRef}
        className="h-full relative"
        onMouseDown={onPanMouseDown}
        onMouseMove={onPanMouseMove}
        onMouseUp={onPanMouseUp}
        onMouseLeave={onPanMouseLeave}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        style={{
          cursor: isPanning
            ? 'grabbing'
            : (selectionTool === 'box' || selectionTool === 'lasso')
              ? 'crosshair'
              : undefined,
        }}
      >
        {isComputing && (
          <ChartLoadingOverlay
            label="Computing distances..."
            showLabel
            overlayClassName="bg-background/60 z-10"
          />
        )}

        {rendererType === 'webgl' && (
          <WebglIndicatorBadge position="top-left" />
        )}

        {rendererType === 'webgl' && (
          <RepetitionsWebglOverlays
            bounds={webglBounds}
            scaleType={scaleType}
            xTicks={xTicks}
            bioSampleCount={bioSampleCount}
            showGrid={showGrid}
            quantileValues={quantileValues}
            formatXAxisTick={formatXAxisTick}
          />
        )}

        {rendererType === 'recharts' && (
          <RepetitionsRechartsPlot
            plotData={plotData}
            effectiveXDomain={effectiveXDomain}
            xTicks={xTicks}
            yDomain={yDomain}
            scaleType={scaleType}
            showGrid={showGrid}
            enableHover={enableHover}
            quantileValues={quantileValues}
            formatXAxisTick={formatXAxisTick}
            getPointColor={getPointColor}
            onPointClick={onPointClick}
          />
        )}

        {rendererType === 'webgl' && (
          <RepetitionsWebglPlot
            data={webglData}
            useSelectionContext={useSelectionContext}
            clearOnBackgroundClick={clearWebglOnBackgroundClick}
            customBounds={webglBounds}
          />
        )}
      </div>
    </SelectionContainer>
  );
}

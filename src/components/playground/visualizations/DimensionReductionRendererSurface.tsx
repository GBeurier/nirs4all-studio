import type { MouseEvent, ReactNode, RefObject } from 'react';

import type {
  DimensionReductionDataPoint,
  DimensionReductionWebgl2DProps,
  DimensionReductionWebgl3DProps,
} from '@/lib/playground/dimensionReductionData';
import type { SelectionResult } from '../selectionGeometry';
import type { SelectionToolType } from '@/context/useSelection';
import {
  DimensionReduction2DRendererBranch,
  DimensionReduction3DRendererBranch,
  type DimensionReductionAxisLabels,
} from './DimensionReductionRendererBranches';
import { DimensionReductionFloatingTooltip } from './DimensionReductionTooltip';
import { WebglIndicatorBadge } from './WebglIndicatorBadge';
import {
  type Scatter3DHandle,
  type ScatterRendererType,
} from './scatter';

type DimensionReductionRendererViewMode = '2d' | '3d';

interface DimensionReductionRendererSurfaceProps {
  viewMode: DimensionReductionRendererViewMode;
  rendererType: ScatterRendererType;
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  useSelectionContext: boolean;
  webgl2DProps: DimensionReductionWebgl2DProps;
  webgl3DProps: DimensionReductionWebgl3DProps;
  scatter3DRef: RefObject<Scatter3DHandle | null>;
  recharts2DView: ReactNode;
  recharts3DView: ReactNode;
  pointSize: number;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  axisLabels: DimensionReductionAxisLabels;
  enableHover: boolean;
  hoveredPoint: DimensionReductionDataPoint | null;
  mousePosition: { x: number; y: number } | null;
  containerWidth?: number;
  onRechartsSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onWebglSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  on3DSelectionComplete: (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;
  onBackgroundClick: () => void;
  onRechartsBackgroundClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function DimensionReductionRendererSurface({
  viewMode,
  rendererType,
  selectionTool,
  selectionEnabled,
  useSelectionContext,
  webgl2DProps,
  webgl3DProps,
  scatter3DRef,
  recharts2DView,
  recharts3DView,
  pointSize,
  showGrid,
  preserveAspectRatio,
  axisLabels,
  enableHover,
  hoveredPoint,
  mousePosition,
  containerWidth,
  onRechartsSelectionComplete,
  onWebglSelectionComplete,
  on3DSelectionComplete,
  onBackgroundClick,
  onRechartsBackgroundClick,
}: DimensionReductionRendererSurfaceProps) {
  const clearOnBackgroundClick = selectionTool === 'click';

  return (
    <>
      {rendererType !== 'recharts' && (
        <WebglIndicatorBadge
          position="top-left"
          label={rendererType === 'webgl' ? 'WebGL' : 'Regl'}
        />
      )}

      {rendererType !== 'recharts' && (
        <DimensionReductionFloatingTooltip
          enableHover={enableHover}
          point={hoveredPoint}
          mousePosition={mousePosition}
          containerWidth={containerWidth}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          zLabel={axisLabels.z}
          showZ={viewMode === '3d'}
        />
      )}

      {viewMode === '3d'
        ? (
          <DimensionReduction3DRendererBranch
            rendererType={rendererType}
            selectionTool={selectionTool}
            selectionEnabled={selectionEnabled}
            useSelectionContext={useSelectionContext}
            webgl3DProps={webgl3DProps}
            scatter3DRef={scatter3DRef}
            recharts3DView={recharts3DView}
            pointSize={pointSize}
            showGrid={showGrid}
            axisLabels={axisLabels}
            clearOnBackgroundClick={clearOnBackgroundClick}
            onSelectionComplete={on3DSelectionComplete}
            onRechartsSelectionComplete={onRechartsSelectionComplete}
            onBackgroundClick={onBackgroundClick}
          />
        )
        : (
          <DimensionReduction2DRendererBranch
            rendererType={rendererType}
            selectionTool={selectionTool}
            selectionEnabled={selectionEnabled}
            useSelectionContext={useSelectionContext}
            webgl2DProps={webgl2DProps}
            recharts2DView={recharts2DView}
            pointSize={pointSize}
            showGrid={showGrid}
            preserveAspectRatio={preserveAspectRatio}
            axisLabels={axisLabels}
            clearOnBackgroundClick={clearOnBackgroundClick}
            onSelectionComplete={onWebglSelectionComplete}
            onRechartsSelectionComplete={onRechartsSelectionComplete}
            onBackgroundClick={onBackgroundClick}
            onRechartsBackgroundClick={onRechartsBackgroundClick}
          />
        )}
    </>
  );
}

import type { MouseEvent, ReactNode, RefObject } from 'react';

import type {
  DimensionReductionWebgl2DProps,
  DimensionReductionWebgl3DProps,
} from '@/lib/playground/dimensionReductionData';
import type { SelectionToolType } from '@/context/useSelection';
import { SelectionContainer } from '../SelectionTools';
import type { SelectionResult } from '../selectionGeometry';
import {
  ScatterPureWebGL2D,
  ScatterPureWebGL3D,
  ScatterRegl2D,
  ScatterRegl3D,
  type Scatter3DHandle,
  type ScatterRendererType,
} from './scatter';

export interface DimensionReductionAxisLabels {
  x: string;
  y: string;
  z: string;
}

type SelectionCompleteHandler = (result: SelectionResult, modifiers: { shift: boolean; ctrl: boolean }) => void;

interface DimensionReductionSelectionContainerProps {
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  onSelectionComplete: SelectionCompleteHandler;
  onBackgroundClick: () => void;
  children: ReactNode;
}

function DimensionReductionSelectionContainer({
  selectionTool,
  selectionEnabled,
  onSelectionComplete,
  onBackgroundClick,
  children,
}: DimensionReductionSelectionContainerProps) {
  return (
    <SelectionContainer
      mode={selectionTool}
      enabled={selectionEnabled}
      onSelectionComplete={onSelectionComplete}
      onPointClick={() => {}}
      onBackgroundClick={onBackgroundClick}
      className="h-full w-full"
    >
      {children}
    </SelectionContainer>
  );
}

export interface DimensionReduction3DRendererBranchProps {
  rendererType: ScatterRendererType;
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  useSelectionContext: boolean;
  webgl3DProps: DimensionReductionWebgl3DProps;
  scatter3DRef: RefObject<Scatter3DHandle | null>;
  recharts3DView: ReactNode;
  pointSize: number;
  showGrid: boolean;
  axisLabels: DimensionReductionAxisLabels;
  clearOnBackgroundClick: boolean;
  onSelectionComplete: SelectionCompleteHandler;
  onRechartsSelectionComplete: SelectionCompleteHandler;
  onBackgroundClick: () => void;
}

export function DimensionReduction3DRendererBranch({
  rendererType,
  selectionTool,
  selectionEnabled,
  useSelectionContext,
  webgl3DProps,
  scatter3DRef,
  recharts3DView,
  pointSize,
  showGrid,
  axisLabels,
  clearOnBackgroundClick,
  onSelectionComplete,
  onRechartsSelectionComplete,
  onBackgroundClick,
}: DimensionReduction3DRendererBranchProps) {
  if (rendererType === 'recharts') {
    return (
      <DimensionReductionSelectionContainer
        selectionTool={selectionTool}
        selectionEnabled={selectionEnabled}
        onSelectionComplete={onRechartsSelectionComplete}
        onBackgroundClick={onBackgroundClick}
      >
        {recharts3DView}
      </DimensionReductionSelectionContainer>
    );
  }

  if (rendererType === 'webgl') {
    return (
      <DimensionReductionSelectionContainer
        selectionTool={selectionTool}
        selectionEnabled={selectionEnabled}
        onSelectionComplete={onSelectionComplete}
        onBackgroundClick={onBackgroundClick}
      >
        <ScatterPureWebGL3D
          ref={scatter3DRef}
          points={webgl3DProps.points}
          indices={webgl3DProps.indices}
          colors={webgl3DProps.colors}
          values={webgl3DProps.values}
          useSelectionContext={useSelectionContext}
          pointSize={pointSize}
          showGrid={showGrid}
          showAxes={true}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          zLabel={axisLabels.z}
          className="h-full w-full"
          clearOnBackgroundClick={clearOnBackgroundClick}
        />
      </DimensionReductionSelectionContainer>
    );
  }

  return (
    <DimensionReductionSelectionContainer
      selectionTool={selectionTool}
      selectionEnabled={selectionEnabled}
      onSelectionComplete={onSelectionComplete}
      onBackgroundClick={onBackgroundClick}
    >
      <ScatterRegl3D
        ref={scatter3DRef}
        points={webgl3DProps.points}
        indices={webgl3DProps.indices}
        colors={webgl3DProps.colors}
        values={webgl3DProps.values}
        useSelectionContext={useSelectionContext}
        pointSize={pointSize}
        showGrid={showGrid}
        showAxes={true}
        xLabel={axisLabels.x}
        yLabel={axisLabels.y}
        zLabel={axisLabels.z}
        className="h-full w-full"
        clearOnBackgroundClick={clearOnBackgroundClick}
      />
    </DimensionReductionSelectionContainer>
  );
}

export interface DimensionReduction2DRendererBranchProps {
  rendererType: ScatterRendererType;
  selectionTool: SelectionToolType;
  selectionEnabled: boolean;
  useSelectionContext: boolean;
  webgl2DProps: DimensionReductionWebgl2DProps;
  recharts2DView: ReactNode;
  pointSize: number;
  showGrid: boolean;
  preserveAspectRatio: boolean;
  axisLabels: DimensionReductionAxisLabels;
  clearOnBackgroundClick: boolean;
  onSelectionComplete: SelectionCompleteHandler;
  onRechartsSelectionComplete: SelectionCompleteHandler;
  onBackgroundClick: () => void;
  onRechartsBackgroundClick: (event: MouseEvent<HTMLDivElement>) => void;
}

export function DimensionReduction2DRendererBranch({
  rendererType,
  selectionTool,
  selectionEnabled,
  useSelectionContext,
  webgl2DProps,
  recharts2DView,
  pointSize,
  showGrid,
  preserveAspectRatio,
  axisLabels,
  clearOnBackgroundClick,
  onSelectionComplete,
  onRechartsSelectionComplete,
  onBackgroundClick,
  onRechartsBackgroundClick,
}: DimensionReduction2DRendererBranchProps) {
  if (rendererType === 'recharts') {
    return (
      <DimensionReductionSelectionContainer
        selectionTool={selectionTool}
        selectionEnabled={selectionEnabled}
        onSelectionComplete={onRechartsSelectionComplete}
        onBackgroundClick={onBackgroundClick}
      >
        <div onClick={onRechartsBackgroundClick} className="h-full w-full">
          {recharts2DView}
        </div>
      </DimensionReductionSelectionContainer>
    );
  }

  if (rendererType === 'webgl') {
    return (
      <DimensionReductionSelectionContainer
        selectionTool={selectionTool}
        selectionEnabled={selectionEnabled}
        onSelectionComplete={onSelectionComplete}
        onBackgroundClick={onBackgroundClick}
      >
        <ScatterPureWebGL2D
          points={webgl2DProps.points}
          indices={webgl2DProps.indices}
          colors={webgl2DProps.colors}
          values={webgl2DProps.values}
          useSelectionContext={useSelectionContext}
          pointSize={pointSize}
          showGrid={showGrid}
          showAxes={true}
          xLabel={axisLabels.x}
          yLabel={axisLabels.y}
          className="h-full w-full"
          clearOnBackgroundClick={clearOnBackgroundClick}
          preserveAspectRatio={preserveAspectRatio}
        />
      </DimensionReductionSelectionContainer>
    );
  }

  return (
    <DimensionReductionSelectionContainer
      selectionTool={selectionTool}
      selectionEnabled={selectionEnabled}
      onSelectionComplete={onSelectionComplete}
      onBackgroundClick={onBackgroundClick}
    >
      <ScatterRegl2D
        points={webgl2DProps.points}
        indices={webgl2DProps.indices}
        colors={webgl2DProps.colors}
        values={webgl2DProps.values}
        useSelectionContext={useSelectionContext}
        pointSize={pointSize}
        showGrid={showGrid}
        showAxes={true}
        xLabel={axisLabels.x}
        yLabel={axisLabels.y}
        className="h-full w-full"
        clearOnBackgroundClick={clearOnBackgroundClick}
        preserveAspectRatio={preserveAspectRatio}
      />
    </DimensionReductionSelectionContainer>
  );
}

import type { MouseEvent as ReactMouseEvent } from 'react';

import type {
  ColorContext,
  GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import type {
  DimensionReductionDataPoint,
  DimensionReductionYRange,
} from '@/lib/playground/dimensionReductionData';
import type { DimensionReductionColorMode } from '@/lib/playground/dimensionReductionPresentation';
import { DimensionReductionRechartsPlot } from './DimensionReductionRechartsPlot';
import { ScatterPlot3D } from './ScatterPlot3D';

interface DimensionReductionAxisLabels {
  x: string;
  y: string;
  z: string;
}

interface DimensionReduction2DViewProps {
  data: DimensionReductionDataPoint[];
  referenceData: DimensionReductionDataPoint[];
  xAxis: string;
  yAxis: string;
  axisLabels: DimensionReductionAxisLabels;
  pointBaseSize: number;
  showGrid: boolean;
  showCrosshairs: boolean;
  enableHover: boolean;
  globalColorConfig?: GlobalColorConfig;
  colorContext: ColorContext;
  colorMode: DimensionReductionColorMode;
  metadataKey?: string;
  yRange: DimensionReductionYRange;
  selectedSamples: Set<number>;
  pinnedSamples: Set<number>;
  hoveredSample: number | null;
  onPointClick: (data: unknown, index: number, event: ReactMouseEvent) => void;
  onPointMouseEnter: (data: unknown) => void;
  onPointMouseLeave: () => void;
}

export function DimensionReduction2DView({
  data,
  referenceData,
  xAxis,
  yAxis,
  axisLabels,
  pointBaseSize,
  showGrid,
  showCrosshairs,
  enableHover,
  globalColorConfig,
  colorContext,
  colorMode,
  metadataKey,
  yRange,
  selectedSamples,
  pinnedSamples,
  hoveredSample,
  onPointClick,
  onPointMouseEnter,
  onPointMouseLeave,
}: DimensionReduction2DViewProps) {
  return (
    <DimensionReductionRechartsPlot
      data={data}
      referenceData={referenceData}
      xAxis={xAxis}
      yAxis={yAxis}
      xLabel={axisLabels.x}
      yLabel={axisLabels.y}
      pointBaseSize={pointBaseSize}
      showGrid={showGrid}
      showCrosshairs={showCrosshairs}
      enableHover={enableHover}
      globalColorConfig={globalColorConfig}
      colorContext={colorContext}
      colorMode={colorMode}
      metadataKey={metadataKey}
      yRange={yRange}
      selectedSamples={selectedSamples}
      pinnedSamples={pinnedSamples}
      hoveredSample={hoveredSample}
      onPointClick={onPointClick}
      onPointMouseEnter={onPointMouseEnter}
      onPointMouseLeave={onPointMouseLeave}
    />
  );
}

interface DimensionReduction3DViewProps {
  data: DimensionReductionDataPoint[];
  axisLabels: DimensionReductionAxisLabels;
  getColor: (point: DimensionReductionDataPoint) => string;
  selectedSamples: Set<number>;
  hoveredSample: number | null;
  onSelect: (data: DimensionReductionDataPoint, event?: MouseEvent) => void;
  onHover: (index: number | null) => void;
}

export function DimensionReduction3DView({
  data,
  axisLabels,
  getColor,
  selectedSamples,
  hoveredSample,
  onSelect,
  onHover,
}: DimensionReduction3DViewProps) {
  return (
    <ScatterPlot3D
      data={data}
      xLabel={axisLabels.x}
      yLabel={axisLabels.y}
      zLabel={axisLabels.z}
      getColor={getColor}
      selectedSamples={selectedSamples}
      hoveredSample={hoveredSample}
      onSelect={onSelect}
      onHover={onHover}
    />
  );
}

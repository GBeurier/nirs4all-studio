import type { SelectionResult } from '@/components/playground/selectionGeometry';
import type {
  RepetitionsDataBounds,
  RepetitionsPlotDataPoint,
} from '@/lib/playground/repetitionsChartData';
import {
  selectPointsInDataSpace,
  selectRechartsPointsInArea,
} from '@/lib/playground/selectionHandlers';

export interface RepetitionsContainerSize {
  width: number;
  height: number;
}

export interface RepetitionsWebglAxisOffsets {
  left: number;
  bottom: number;
}

export interface RepetitionsWebglPlotArea {
  axisLeftOffset: number;
  axisBottomOffset: number;
  width: number;
  height: number;
}

export const REPETITIONS_WEBGL_AXIS_OFFSETS: RepetitionsWebglAxisOffsets = {
  left: 40,
  bottom: 24,
};

export function getRepetitionsWebglPlotArea(
  containerSize: RepetitionsContainerSize,
  offsets: RepetitionsWebglAxisOffsets = REPETITIONS_WEBGL_AXIS_OFFSETS,
): RepetitionsWebglPlotArea {
  return {
    axisLeftOffset: offsets.left,
    axisBottomOffset: offsets.bottom,
    width: Math.max(containerSize.width - offsets.left, 1),
    height: Math.max(containerSize.height - offsets.bottom, 1),
  };
}

export function screenToRepetitionsData(
  screenX: number,
  screenY: number,
  plotArea: RepetitionsWebglPlotArea,
  bounds: RepetitionsDataBounds,
): { x: number; y: number } {
  const adjustedX = screenX - plotArea.axisLeftOffset;
  const dataX = bounds.minX + (adjustedX / plotArea.width) * (bounds.maxX - bounds.minX);
  const dataY = bounds.maxY - (screenY / plotArea.height) * (bounds.maxY - bounds.minY);

  return { x: dataX, y: dataY };
}

export function selectRepetitionsRechartsPoints(
  container: HTMLElement,
  plotData: ReadonlyArray<Pick<RepetitionsPlotDataPoint, 'sampleIndex'>>,
  result: SelectionResult,
): number[] {
  return selectRechartsPointsInArea(
    container,
    plotData.length,
    result,
    domIndex => plotData[domIndex]?.sampleIndex ?? domIndex,
  );
}

export function selectRepetitionsWebglPoints(
  plotData: ReadonlyArray<Pick<RepetitionsPlotDataPoint, 'x' | 'y' | 'sampleIndex'>>,
  result: SelectionResult,
  containerSize: RepetitionsContainerSize,
  bounds: RepetitionsDataBounds,
  offsets: RepetitionsWebglAxisOffsets = REPETITIONS_WEBGL_AXIS_OFFSETS,
): number[] {
  const plotArea = getRepetitionsWebglPlotArea(containerSize, offsets);

  return selectPointsInDataSpace(
    plotData.map(point => ({ x: point.x, y: point.y, index: point.sampleIndex })),
    result,
    (screenX, screenY) => screenToRepetitionsData(screenX, screenY, plotArea, bounds),
  );
}

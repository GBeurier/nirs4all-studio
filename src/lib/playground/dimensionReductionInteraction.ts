import type { SelectionResult } from '@/components/playground/selectionGeometry';
import {
  selectPointsInDataSpace,
  selectRechartsPointsInArea,
} from '@/lib/playground/selectionHandlers';
import {
  calculateDimensionReductionViewBounds,
  screenToDimensionReductionData,
  type DimensionReductionDataPoint,
} from '@/lib/playground/dimensionReductionData';

export interface DimensionReductionContainerRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface DimensionReductionScreenBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getDimensionReductionPointIndex(data: unknown): number | undefined {
  const point = data as { index?: number; payload?: { index?: number } } | null | undefined;
  return point?.payload?.index ?? point?.index;
}

export function getDimensionReductionMousePosition(
  clientX: number,
  clientY: number,
  containerRect: Pick<DimensionReductionContainerRect, 'left' | 'top'>,
): { x: number; y: number } {
  return {
    x: clientX - containerRect.left,
    y: clientY - containerRect.top,
  };
}

export function selectDimensionReductionWebglPoints(
  points: DimensionReductionDataPoint[],
  result: SelectionResult,
  containerSize: Pick<DimensionReductionContainerRect, 'width' | 'height'>,
  preserveAspectRatio: boolean,
): number[] {
  const bounds = calculateDimensionReductionViewBounds(
    points,
    containerSize.width,
    containerSize.height,
    preserveAspectRatio,
  );

  return selectPointsInDataSpace(
    points,
    result,
    (screenX, screenY) => screenToDimensionReductionData(
      screenX,
      screenY,
      containerSize.width,
      containerSize.height,
      bounds,
    ),
  );
}

export function selectDimensionReductionRechartsPoints(
  container: HTMLElement,
  points: DimensionReductionDataPoint[],
  result: SelectionResult,
): number[] {
  return selectRechartsPointsInArea(
    container,
    points.length,
    result,
    domIndex => points[domIndex]?.index ?? domIndex,
  );
}

export function getDimensionReduction3DSelectionBounds(result: SelectionResult): DimensionReductionScreenBounds {
  if ('path' in result) {
    const xs = result.path.map(point => point.x);
    const ys = result.path.map(point => point.y);
    return {
      minX: Math.min(...xs),
      minY: Math.min(...ys),
      maxX: Math.max(...xs),
      maxY: Math.max(...ys),
    };
  }

  return {
    minX: Math.min(result.start.x, result.end.x),
    minY: Math.min(result.start.y, result.end.y),
    maxX: Math.max(result.start.x, result.end.x),
    maxY: Math.max(result.start.y, result.end.y),
  };
}

export function selectDimensionReduction3DPoints(
  result: SelectionResult,
  getPointsInScreenRect: (minX: number, minY: number, maxX: number, maxY: number) => number[],
): number[] {
  const bounds = getDimensionReduction3DSelectionBounds(result);
  return getPointsInScreenRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
}

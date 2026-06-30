import { useCallback, type Dispatch, type MouseEvent, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import {
  findNearestCanvasScatterPoint,
  getCanvasScatterHoveredPoint,
  getCanvasScatterPointerPosition,
  type CanvasScatterPoint,
  type CanvasScatterSpatialGrid,
} from '@/lib/inspector/canvasScatterData';

export interface CanvasScatterTooltipPosition {
  x: number;
  y: number;
}

interface UseCanvasScatterInteractionInput {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  gridRef: MutableRefObject<CanvasScatterSpatialGrid | null>;
  screenPositionsRef: MutableRefObject<Float64Array>;
  points: readonly CanvasScatterPoint[];
  hoveredIndex: number | null;
  setHoveredIndex: Dispatch<SetStateAction<number | null>>;
  setTooltipPosition: Dispatch<SetStateAction<CanvasScatterTooltipPosition | null>>;
  onPointClick?: (point: CanvasScatterPoint, event: MouseEvent) => void;
  onPointHover?: (point: CanvasScatterPoint | null) => void;
}

function getCanvasScatterHitIndex({
  canvas,
  grid,
  screenPositions,
  event,
}: {
  canvas: HTMLCanvasElement;
  grid: CanvasScatterSpatialGrid;
  screenPositions: Float64Array;
  event: MouseEvent<HTMLCanvasElement>;
}): { index: number | null; tooltipPosition: CanvasScatterTooltipPosition } {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  const pointer = getCanvasScatterPointerPosition({
    clientX: event.clientX,
    clientY: event.clientY,
    rectLeft: rect.left,
    rectTop: rect.top,
    dpr,
  });

  return {
    index: findNearestCanvasScatterPoint(grid, screenPositions, pointer.x, pointer.y, 8 * dpr),
    tooltipPosition: { x: event.clientX - rect.left, y: event.clientY - rect.top },
  };
}

export function useCanvasScatterInteraction({
  canvasRef,
  gridRef,
  screenPositionsRef,
  points,
  hoveredIndex,
  setHoveredIndex,
  setTooltipPosition,
  onPointClick,
  onPointHover,
}: UseCanvasScatterInteractionInput) {
  const handleMouseMove = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;

    const { index, tooltipPosition } = getCanvasScatterHitIndex({
      canvas,
      grid,
      screenPositions: screenPositionsRef.current,
      event,
    });

    if (index !== hoveredIndex) {
      setHoveredIndex(index);
      if (index !== null) {
        const point = getCanvasScatterHoveredPoint(points, index);
        setTooltipPosition(tooltipPosition);
        onPointHover?.(point);
      } else {
        setTooltipPosition(null);
        onPointHover?.(null);
      }
    } else if (index !== null) {
      setTooltipPosition(tooltipPosition);
    }
  }, [canvasRef, gridRef, screenPositionsRef, points, hoveredIndex, setHoveredIndex, setTooltipPosition, onPointHover]);

  const handleMouseLeave = useCallback(() => {
    setHoveredIndex(null);
    setTooltipPosition(null);
    onPointHover?.(null);
  }, [setHoveredIndex, setTooltipPosition, onPointHover]);

  const handleClick = useCallback((event: MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const grid = gridRef.current;
    if (!canvas || !grid) return;

    const { index } = getCanvasScatterHitIndex({
      canvas,
      grid,
      screenPositions: screenPositionsRef.current,
      event,
    });
    const point = getCanvasScatterHoveredPoint(points, index);
    if (point) {
      onPointClick?.(point, event);
    }
  }, [canvasRef, gridRef, screenPositionsRef, points, onPointClick]);

  return {
    handleMouseMove,
    handleMouseLeave,
    handleClick,
  };
}

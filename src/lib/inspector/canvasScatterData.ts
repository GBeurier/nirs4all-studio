export interface CanvasScatterPoint {
  x: number;
  y: number;
  color: string;
  opacity: number;
  radius: number;
  chainId: string;
  /** Arbitrary data for tooltip rendering */
  meta?: Record<string, unknown>;
}

export interface CanvasReferenceLine {
  type: 'y-equals-x' | 'horizontal' | 'vertical';
  value?: number;
  color: string;
  dash?: number[];
  width?: number;
  label?: string;
}

export interface CanvasAnnotation {
  text: string;
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export interface CanvasScatterDomain {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export interface CanvasScatterSpatialGrid {
  cellSize: number;
  cells: Map<string, number[]>;
  offsetX: number;
  offsetY: number;
}

export interface CanvasScatterPointerPosition {
  x: number;
  y: number;
}

export const CANVAS_SCATTER_MARGIN = { top: 24, right: 20, bottom: 40, left: 56 } as const;

function niceCanvasScatterNumber(value: number, round: boolean): number {
  const exp = Math.floor(Math.log10(value));
  const frac = value / Math.pow(10, exp);
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else {
    if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
  }
  return nice * Math.pow(10, exp);
}

export function calculateCanvasScatterTicks(
  min: number,
  max: number,
  targetCount = 6,
): number[] {
  const range = niceCanvasScatterNumber(max - min, false);
  const step = niceCanvasScatterNumber(range / (targetCount - 1), true);
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let tick = start; tick <= max + step * 0.5; tick += step) {
    if (tick >= min - step * 0.01) {
      ticks.push(parseFloat(tick.toPrecision(10)));
    }
  }
  return ticks;
}

export function formatCanvasScatterTickValue(value: number): string {
  const abs = Math.abs(value);
  if (abs === 0) return '0';
  if (abs >= 1000) return value.toFixed(0);
  if (abs >= 1) return value.toPrecision(4);
  return value.toPrecision(3);
}

export function buildCanvasScatterDomain({
  points,
  xDomain,
  yDomain,
}: {
  points: readonly Pick<CanvasScatterPoint, 'x' | 'y'>[];
  xDomain?: [number, number];
  yDomain?: [number, number];
}): CanvasScatterDomain {
  if (points.length === 0) return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return {
    xMin: xDomain?.[0] ?? minX - rangeX * 0.05,
    xMax: xDomain?.[1] ?? maxX + rangeX * 0.05,
    yMin: yDomain?.[0] ?? minY - rangeY * 0.05,
    yMax: yDomain?.[1] ?? maxY + rangeY * 0.05,
  };
}

export function projectCanvasScatterPoints({
  points,
  plotW,
  plotH,
  xMin,
  xMax,
  yMin,
  yMax,
  target,
}: {
  points: readonly Pick<CanvasScatterPoint, 'x' | 'y'>[];
  plotW: number;
  plotH: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  target?: Float64Array;
}): Float64Array {
  const requiredLength = points.length * 2;
  const screenPositions = target?.length === requiredLength ? target : new Float64Array(requiredLength);
  const xScale = plotW / (xMax - xMin);
  const yScale = plotH / (yMax - yMin);

  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) continue;
    screenPositions[index * 2] = (point.x - xMin) * xScale;
    screenPositions[index * 2 + 1] = plotH - (point.y - yMin) * yScale;
  }
  return screenPositions;
}

export function buildCanvasScatterSpatialGrid(
  screenPositions: Float64Array,
  count: number,
  cellSize = 10,
): CanvasScatterSpatialGrid {
  const cells = new Map<string, number[]>();
  const grid: CanvasScatterSpatialGrid = { cellSize, cells, offsetX: 0, offsetY: 0 };

  for (let index = 0; index < count; index++) {
    const sx = screenPositions[index * 2];
    const sy = screenPositions[index * 2 + 1];
    const cx = Math.floor(sx / cellSize);
    const cy = Math.floor(sy / cellSize);
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key)?.push(index);
  }

  return grid;
}

export function findNearestCanvasScatterPoint(
  grid: CanvasScatterSpatialGrid,
  screenPositions: Float64Array,
  mouseX: number,
  mouseY: number,
  maxDistance = 8,
): number | null {
  const cx = Math.floor(mouseX / grid.cellSize);
  const cy = Math.floor(mouseY / grid.cellSize);
  const searchRadius = Math.ceil(maxDistance / grid.cellSize);

  let bestIndex: number | null = null;
  let bestDistance = maxDistance * maxDistance;

  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const indices = grid.cells.get(`${cx + dx},${cy + dy}`);
      if (!indices) continue;

      for (const index of indices) {
        const px = screenPositions[index * 2];
        const py = screenPositions[index * 2 + 1];
        const distance = (mouseX - px) * (mouseX - px) + (mouseY - py) * (mouseY - py);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      }
    }
  }

  return bestIndex;
}

export function getCanvasScatterPointerPosition({
  clientX,
  clientY,
  rectLeft,
  rectTop,
  dpr,
}: {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
  dpr: number;
}): CanvasScatterPointerPosition {
  return {
    x: (clientX - rectLeft) * dpr - CANVAS_SCATTER_MARGIN.left * dpr,
    y: (clientY - rectTop) * dpr - CANVAS_SCATTER_MARGIN.top * dpr,
  };
}

export function getCanvasScatterTooltipStyle({
  x,
  y,
  containerWidth,
}: {
  x: number;
  y: number;
  containerWidth: number;
}): { left: number; top: number } {
  return {
    left: Math.min(x + 12, containerWidth - 160),
    top: Math.max(y - 60, 4),
  };
}

export function getCanvasScatterHoveredPoint(
  points: readonly CanvasScatterPoint[],
  hoveredIndex: number | null,
): CanvasScatterPoint | null {
  return hoveredIndex == null ? null : points[hoveredIndex] ?? null;
}

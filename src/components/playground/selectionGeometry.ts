export interface Point {
  x: number;
  y: number;
}

export interface SelectionBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LassoSelectionResult {
  path: Point[];
  bounds: SelectionBounds;
}

export interface BoxSelectionResult {
  start: Point;
  end: Point;
  bounds: SelectionBounds;
}

export type SelectionResult = LassoSelectionResult | BoxSelectionResult;

/**
 * Check if a point is inside a polygon using ray casting algorithm.
 */
export function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const { x, y } = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if a point is inside a bounding box.
 */
export function isPointInBox(point: Point, bounds: SelectionBounds): boolean {
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY
  );
}

/**
 * Calculate bounding box from a set of points.
 */
export function getBoundsFromPoints(points: Point[]): SelectionBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  return {
    minX: Math.min(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxX: Math.max(...points.map((p) => p.x)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

/**
 * Calculate bounding box from two corners.
 */
export function getBoundsFromCorners(start: Point, end: Point): SelectionBounds {
  return {
    minX: Math.min(start.x, end.x),
    minY: Math.min(start.y, end.y),
    maxX: Math.max(start.x, end.x),
    maxY: Math.max(start.y, end.y),
  };
}

/**
 * Simplify a path by removing points that are too close together.
 */
export function simplifyPath(points: Point[], tolerance: number = 2): Point[] {
  if (points.length < 3) return points;

  const simplified: Point[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const current = points[i];
    const distance = Math.sqrt(
      Math.pow(current.x - prev.x, 2) + Math.pow(current.y - prev.y, 2)
    );

    if (distance >= tolerance) {
      simplified.push(current);
    }
  }

  simplified.push(points[points.length - 1]);
  return simplified;
}

/**
 * Convert path points to SVG path string.
 */
export function pointsToSvgPath(points: Point[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    path += ` L ${points[i].x} ${points[i].y}`;
  }
  path += ' Z';
  return path;
}

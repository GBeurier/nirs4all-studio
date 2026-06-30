// Inspector selection geometry reuses the Playground implementation.
export {
  isPointInPolygon,
  isPointInBox,
  getBoundsFromPoints,
  getBoundsFromCorners,
  simplifyPath,
  pointsToSvgPath,
} from '@/components/playground/selectionGeometry';

export type {
  Point,
  SelectionBounds,
  LassoSelectionResult,
  BoxSelectionResult,
  SelectionResult,
} from '@/components/playground/selectionGeometry';

export {
  SelectionOverlay,
  SelectionContainer,
} from '@/components/playground/SelectionTools';

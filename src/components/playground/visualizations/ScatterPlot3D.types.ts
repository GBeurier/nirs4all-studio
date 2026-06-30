/**
 * Shared types for the ScatterPlot3D view (Three.js-based 3D scatter plot).
 */

export interface DataPoint {
  x: number;
  y: number;
  z?: number;
  index: number;
  name: string;
  yValue?: number;
  foldLabel?: number;
  metadata?: Record<string, unknown>;
}

// DataPoint with z guaranteed to be a number (after normalization)
export interface NormalizedDataPoint extends DataPoint {
  z: number;
}

export interface ScatterPlot3DProps {
  data: DataPoint[];
  xLabel?: string;
  yLabel?: string;
  zLabel?: string;
  getColor: (point: DataPoint) => string;
  selectedSamples: Set<number>;
  hoveredSample: number | null;
  onSelect?: (data: DataPoint, event?: MouseEvent) => void;
  onHover?: (index: number | null) => void;
}

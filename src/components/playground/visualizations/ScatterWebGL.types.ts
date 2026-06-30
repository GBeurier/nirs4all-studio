/**
 * Shared types for the ScatterWebGL view (Three.js-based 2D scatter plot).
 */

import * as THREE from 'three';

export interface ScatterWebGLProps {
  /** Point coordinates [x, y] */
  points: [number, number][];
  /** Point values for coloring */
  values?: number[];
  /** Categorical labels for coloring */
  labels?: string[];
  /** Sample indices (for selection) */
  indices?: number[];
  /** X-axis label */
  xLabel?: string;
  /** Y-axis label */
  yLabel?: string;
  /** Point size */
  pointSize?: number;
  /** Selected point size */
  selectedPointSize?: number;
  /** Base color */
  baseColor?: string;
  /** Selected color */
  selectedColor?: string;
  /** Pinned color */
  pinnedColor?: string;
  /** Use SelectionContext */
  useSelectionContext?: boolean;
  /** Manual selected indices */
  selectedIndices?: number[];
  /** Manual pinned indices */
  pinnedIndices?: number[];
  /** Click handler */
  onClick?: (index: number, event: MouseEvent) => void;
  /** Selection change handler (lasso/box) */
  onSelectionChange?: (indices: number[]) => void;
  /** Container class name */
  className?: string;
  /** Show grid */
  showGrid?: boolean;
  /** Aspect ratio (default 1:1) */
  aspectRatio?: number;
  /** Loading state */
  isLoading?: boolean;
}

export interface PointData {
  position: THREE.Vector3;
  color: THREE.Color;
  size: number;
  index: number;
  isSelected: boolean;
  isPinned: boolean;
}

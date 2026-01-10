/**
 * Shared types for scatter plot renderers
 */

export interface ScatterPoint {
  x: number;
  y: number;
  z?: number;
  index: number;
  color: [number, number, number, number]; // RGBA 0-1
  size: number;
}

export interface ScatterRendererProps {
  /** Point coordinates - 2D: [x,y][], 3D: [x,y,z][] */
  points: [number, number][] | [number, number, number][];
  /** Map display index -> sample index (defaults to identity) */
  indices?: number[];
  /** Per-point CSS colors */
  colors?: string[];
  /** Continuous values for gradient coloring */
  values?: number[];
  /** Categorical labels for coloring */
  labels?: string[];
  /** Use SelectionContext for cross-chart sync */
  useSelectionContext?: boolean;
  /** Manually specified selected indices */
  selectedIndices?: number[];
  /** Manually specified pinned indices */
  pinnedIndices?: number[];
  /** CSS color for selected points */
  selectedColor?: string;
  /** CSS color for pinned points */
  pinnedColor?: string;
  /** CSS color for hovered point */
  hoveredColor?: string;
  /** Base point size in pixels */
  pointSize?: number;
  /** Selected point size multiplier */
  selectedSizeMultiplier?: number;
  /** Show grid lines */
  showGrid?: boolean;
  /** Show axes */
  showAxes?: boolean;
  /** X-axis label */
  xLabel?: string;
  /** Y-axis label */
  yLabel?: string;
  /** Z-axis label (3D only) */
  zLabel?: string;
  /** Click handler */
  onClick?: (index: number, event: MouseEvent) => void;
  /** Hover handler */
  onHover?: (index: number | null) => void;
  /** Box/lasso selection handler */
  onSelectionChange?: (indices: number[]) => void;
  /** Container class name */
  className?: string;
  /** Loading state */
  isLoading?: boolean;
  /** Preserve aspect ratio (equal scaling on X and Y) - default false for 2D */
  preserveAspectRatio?: boolean;
}

export type ScatterRendererType = 'recharts' | 'webgl' | 'regl';

/** WebGL shader program info */
export interface ShaderProgram {
  program: WebGLProgram;
  attribs: Record<string, number>;
  uniforms: Record<string, WebGLUniformLocation | null>;
}

/** Picking buffer for GPU-based point selection */
export interface PickingBuffer {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthBuffer?: WebGLRenderbuffer;
  width: number;
  height: number;
}

/** 3D orbit camera state */
export interface OrbitState {
  theta: number;      // Azimuthal angle (horizontal)
  phi: number;        // Polar angle (vertical)
  distance: number;   // Distance from target
  target: [number, number, number];
}

/** Continuous color palette names */
export type ContinuousPalette =
  | 'blue_red'
  | 'viridis'
  | 'plasma'
  | 'inferno'
  | 'coolwarm'
  | 'spectral';

/** Data bounds for normalization */
export interface DataBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ?: number;
  maxZ?: number;
}

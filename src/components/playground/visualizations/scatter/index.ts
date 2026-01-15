/**
 * Scatter plot renderers - barrel exports
 */

export * from './types';
export * from './ScatterPureWebGL2D';
export { ScatterPureWebGL3D, type Scatter3DHandle } from './ScatterPureWebGL3D';
export * from './ScatterRegl2D';
export { ScatterRegl3D } from './ScatterRegl3D';

// Re-export utilities for potential external use
export * from './utils/colorEncoding';
export * from './utils/picking';
export * from './utils/projectionMatrix';
export * from './utils/orbitControls';

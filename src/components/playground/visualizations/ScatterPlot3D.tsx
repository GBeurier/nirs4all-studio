/**
 * ScatterPlot3D - Three.js-based 3D scatter plot (Phase 3)
 *
 * Features:
 * - Orbit controls for rotation and zoom
 * - Instanced mesh for performance (handles >1000 points)
 * - Color mapping (continuous/categorical)
 * - Selection via raycasting
 * - Axis labels and grid
 * - Hover highlighting
 * - Keyboard navigation for accessibility
 * - Export as PNG
 *
 * This module owns data/bounds derivation, callback orchestration, camera reset
 * and PNG export. The render-only sub-views live in:
 * - ./ScatterPlot3D.scene    (Three.js elements: points, axes, grid, controls)
 * - ./ScatterPlot3D.overlays (DOM overlays: toolbar, info, empty state)
 * - ./ScatterPlot3D.helpers  (pure constants + data normalization)
 */

import { useRef, useMemo, useCallback, Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { DataPoint, ScatterPlot3DProps } from './ScatterPlot3D.types';
import { CAMERA_DISTANCE, normalizeData } from './ScatterPlot3D.helpers';
import {
  AxisLine,
  CameraController,
  Grid3D,
  InstancedPoints,
  LoadingFallback,
  PointTooltip,
} from './ScatterPlot3D.scene';
import {
  ScatterPlot3DEmptyState,
  ScatterPlot3DInfoOverlays,
  ScatterPlot3DToolbar,
} from './ScatterPlot3D.overlays';

// ============= Scene Orchestration =============

interface SceneContentProps {
  data: DataPoint[];
  xLabel: string;
  yLabel: string;
  zLabel: string;
  getColor: (point: DataPoint) => string;
  selectedSamples: Set<number>;
  hoveredSample: number | null;
  onSelect?: (data: DataPoint, event?: MouseEvent) => void;
  onHover?: (index: number | null) => void;
}

/**
 * Scene content - derives bounds/hover state and composes the 3D sub-views.
 */
function SceneContent({
  data,
  xLabel,
  yLabel,
  zLabel,
  getColor,
  selectedSamples,
  hoveredSample,
  onSelect,
  onHover,
}: SceneContentProps) {
  const { normalized, bounds } = useMemo(() => normalizeData(data), [data]);

  // Create safe bounds for axes - ensure all values are finite
  const safeBounds = useMemo(() => ({
    x: {
      min: Number.isFinite(bounds.min.x) ? bounds.min.x : -1,
      max: Number.isFinite(bounds.max.x) ? bounds.max.x : 1,
    },
    y: {
      min: Number.isFinite(bounds.min.y) ? bounds.min.y : -1,
      max: Number.isFinite(bounds.max.y) ? bounds.max.y : 1,
    },
    z: {
      min: Number.isFinite(bounds.min.z) ? bounds.min.z : -1,
      max: Number.isFinite(bounds.max.z) ? bounds.max.z : 1,
    },
  }), [bounds]);

  // Find hovered point position for tooltip
  const hoveredPoint = useMemo(() => {
    if (hoveredSample === null) return null;
    const point = normalized.find(p => p.index === hoveredSample);
    if (!point) return null;
    // Ensure position values are finite
    const px = Number.isFinite(point.x) ? point.x : 0;
    const py = Number.isFinite(point.y) ? point.y : 0;
    const pz = Number.isFinite(point.z) ? point.z : 0;
    return {
      point: data.find(p => p.index === hoveredSample)!,
      position: new THREE.Vector3(px, py, pz),
    };
  }, [hoveredSample, normalized, data]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.6} />
      <pointLight position={[10, 10, 10]} intensity={0.8} />
      <pointLight position={[-10, -10, -10]} intensity={0.3} />

      {/* Grid */}
      <Grid3D />

      {/* Axes */}
      <AxisLine
        start={[-1, -1, -1]}
        end={[1, -1, -1]}
        label={xLabel}
        bounds={safeBounds.x}
      />
      <AxisLine
        start={[-1, -1, -1]}
        end={[-1, 1, -1]}
        label={yLabel}
        bounds={safeBounds.y}
      />
      <AxisLine
        start={[-1, -1, -1]}
        end={[-1, -1, 1]}
        label={zLabel}
        bounds={safeBounds.z}
      />

      {/* Points */}
      <InstancedPoints
        data={data}
        getColor={getColor}
        selectedSamples={selectedSamples}
        hoveredSample={hoveredSample}
        onSelect={onSelect}
        onHover={onHover}
      />

      {/* Tooltip */}
      {hoveredPoint && (
        <PointTooltip
          point={hoveredPoint.point}
          position={hoveredPoint.position}
        />
      )}

      {/* Camera controls */}
      <CameraController />
    </>
  );
}

// ============= Main Component =============

export function ScatterPlot3D({
  data,
  xLabel = 'X',
  yLabel = 'Y',
  zLabel = 'Z',
  getColor,
  selectedSamples,
  hoveredSample,
  onSelect,
  onHover,
}: ScatterPlot3DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle reset camera
  const handleReset = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((window as any).__scatter3d_reset) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).__scatter3d_reset();
    }
  }, []);

  // Handle export as PNG
  const handleExport = useCallback(() => {
    if (!canvasRef.current) return;

    try {
      const dataUrl = canvasRef.current.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `scatter_3d_${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Failed to export 3D view:', error);
    }
  }, []);

  // Empty state
  if (data.length === 0) {
    return <ScatterPlot3DEmptyState />;
  }

  return (
    <div ref={containerRef} className="h-full w-full relative">
      {/* Control buttons */}
      <ScatterPlot3DToolbar onReset={handleReset} onExport={handleExport} />

      {/* Instructions + sample count overlays */}
      <ScatterPlot3DInfoOverlays pointCount={data.length} selectedCount={selectedSamples.size} />

      {/* 3D Canvas */}
      <Canvas
        ref={canvasRef}
        camera={{
          position: [CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE],
          fov: 50,
          near: 0.1,
          far: 100,
        }}
        gl={{ preserveDrawingBuffer: true }} // Required for export
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={<LoadingFallback />}>
          <SceneContent
            data={data}
            xLabel={xLabel}
            yLabel={yLabel}
            zLabel={zLabel}
            getColor={getColor}
            selectedSamples={selectedSamples}
            hoveredSample={hoveredSample}
            onSelect={onSelect}
            onHover={onHover}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}

export default ScatterPlot3D;

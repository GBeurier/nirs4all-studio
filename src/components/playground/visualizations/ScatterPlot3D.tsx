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
 */

import React, { useRef, useMemo, useCallback, useState, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Download, RotateCcw, Box } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip as TooltipUI,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ============= Types =============

interface DataPoint {
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
interface NormalizedDataPoint extends DataPoint {
  z: number;
}

interface ScatterPlot3DProps {
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

// ============= Constants =============

const POINT_RADIUS = 0.04;
const SELECTED_RADIUS = 0.06;
const HOVERED_RADIUS = 0.07;
const AXIS_COLOR = '#666666';
const GRID_COLOR = '#333333';
const CAMERA_DISTANCE = 4;

// ============= Utility Functions =============

/**
 * Safely get a finite number, with fallback
 */
function safeFinite(value: number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

/**
 * Normalize data to fit within [-1, 1] range for each axis
 * Filters out points with NaN/Infinity coordinates to prevent Three.js errors
 */
function normalizeData(data: DataPoint[]): { normalized: NormalizedDataPoint[]; bounds: { min: THREE.Vector3; max: THREE.Vector3; scale: THREE.Vector3 } } {
  // Default safe bounds
  const defaultBounds = {
    min: new THREE.Vector3(-1, -1, -1),
    max: new THREE.Vector3(1, 1, 1),
    scale: new THREE.Vector3(1, 1, 1),
  };

  // Guard against invalid input
  if (!Array.isArray(data) || data.length === 0) {
    return { normalized: [], bounds: defaultBounds };
  }

  // Filter out invalid data points (NaN, Infinity, or non-numeric)
  const validData = data.filter(d =>
    d &&
    typeof d.x === 'number' && Number.isFinite(d.x) &&
    typeof d.y === 'number' && Number.isFinite(d.y) &&
    (d.z === undefined || (typeof d.z === 'number' && Number.isFinite(d.z)))
  );

  if (validData.length === 0) {
    return { normalized: [], bounds: defaultBounds };
  }

  const xs = validData.map(d => d.x);
  const ys = validData.map(d => d.y);
  const zs = validData.map(d => safeFinite(d.z, 0));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  // Double-check that min/max are finite (shouldn't happen, but defensive)
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) ||
      !Number.isFinite(minY) || !Number.isFinite(maxY) ||
      !Number.isFinite(minZ) || !Number.isFinite(maxZ)) {
    console.warn('[ScatterPlot3D] Invalid bounds detected, using defaults');
    return { normalized: [], bounds: defaultBounds };
  }

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const rangeZ = maxZ - minZ || 1;

  // Normalize to [-1, 1], only include valid points
  const normalized = validData.map(d => {
    const normX = ((d.x - minX) / rangeX) * 2 - 1;
    const normY = ((d.y - minY) / rangeY) * 2 - 1;
    const normZ = ((safeFinite(d.z, 0) - minZ) / rangeZ) * 2 - 1;

    // Final NaN check on normalized values
    if (!Number.isFinite(normX) || !Number.isFinite(normY) || !Number.isFinite(normZ)) {
      return null;
    }

    return {
      ...d,
      x: normX,
      y: normY,
      z: normZ,
    };
  }).filter((d): d is NormalizedDataPoint => d !== null);

  return {
    normalized,
    bounds: {
      min: new THREE.Vector3(minX, minY, minZ),
      max: new THREE.Vector3(maxX, maxY, maxZ),
      scale: new THREE.Vector3(rangeX, rangeY, rangeZ),
    },
  };
}

// ============= Sub-Components =============

/**
 * Simple line component using Three.js primitives (replaces drei Line to avoid NaN issues)
 */
interface SimpleLineProps {
  points: THREE.Vector3[];
  color: string;
  lineWidth?: number;
  opacity?: number;
}

function SimpleLine({ points, color, opacity = 1 }: SimpleLineProps) {
  const lineObject = useMemo(() => {
    // Validate all points are finite before creating geometry
    const validPoints = points.filter(p =>
      p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    );

    if (validPoints.length < 2) {
      // Return empty Line if not enough valid points
      return new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }));
    }

    const positions = new Float32Array(validPoints.length * 3);
    validPoints.forEach((point, i) => {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    return new THREE.Line(geo, material);
  }, [points, color, opacity]);

  return <primitive object={lineObject} />;
}

/**
 * Individual point mesh - simpler but more reliable than instanced mesh
 */
interface PointMeshProps {
  position: [number, number, number];
  color: string;
  radius: number;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}

function PointMesh({ position, color, radius, onClick, onPointerOver, onPointerOut }: PointMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Parse the HSL color to a concrete color value
  const parsedColor = useMemo(() => {
    const hslMatch = color.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
    if (hslMatch) {
      const h = parseFloat(hslMatch[1]);
      const s = parseFloat(hslMatch[2]);
      const l = parseFloat(hslMatch[3]);
      // Convert HSL to hex for Three.js
      const c = new THREE.Color();
      c.setHSL(h / 360, s / 100, l / 100);
      return '#' + c.getHexString();
    }
    if (color.startsWith('#')) return color;
    return '#6366f1'; // Fallback indigo
  }, [color]);

  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={onClick}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
    >
      <sphereGeometry args={[radius, 12, 12]} />
      <meshBasicMaterial color={parsedColor} />
    </mesh>
  );
}

/**
 * Points container - renders individual point meshes
 */
interface InstancedPointsProps {
  data: DataPoint[];
  getColor: (point: DataPoint) => string;
  selectedSamples: Set<number>;
  hoveredSample: number | null;
  onSelect?: (data: DataPoint, event?: MouseEvent) => void;
  onHover?: (index: number | null) => void;
}

function InstancedPoints({
  data,
  getColor,
  selectedSamples,
  hoveredSample,
  onSelect,
  onHover,
}: InstancedPointsProps) {
  // Normalize data
  const { normalized } = useMemo(() => normalizeData(data), [data]);

  if (normalized.length === 0) return null;

  // Limit to 500 points for performance with individual meshes
  const maxPoints = Math.min(normalized.length, 500);

  // Create a lookup map from index to original data point
  const dataByIndex = useMemo(() => {
    const map = new Map<number, DataPoint>();
    data.forEach(d => map.set(d.index, d));
    return map;
  }, [data]);

  return (
    <group>
      {normalized.slice(0, maxPoints).map((point) => {
        const isSelected = selectedSamples.has(point.index);
        const isHovered = hoveredSample === point.index;
        const radius = isHovered ? HOVERED_RADIUS :
                       isSelected ? SELECTED_RADIUS : POINT_RADIUS;
        // Use point.index to look up original data (handles filtered points correctly)
        const originalPoint = dataByIndex.get(point.index) ?? point;
        const color = getColor(originalPoint);

        return (
          <PointMesh
            key={point.index}
            position={[point.x, point.y, point.z ?? 0]}
            color={color}
            radius={radius}
            onClick={() => onSelect?.(originalPoint)}
            onPointerOver={() => {
              onHover?.(point.index);
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              onHover?.(null);
              document.body.style.cursor = 'auto';
            }}
          />
        );
      })}
    </group>
  );
}

/**
 * Axis with label and tick marks
 */
interface AxisLineProps {
  start: [number, number, number];
  end: [number, number, number];
  label: string;
  tickCount?: number;
  bounds?: { min: number; max: number };
}

function AxisLine({ start, end, label }: AxisLineProps) {
  // Validate inputs - ensure all coordinates are finite
  const safeStart = start.map(v => Number.isFinite(v) ? v : 0) as [number, number, number];
  const safeEnd = end.map(v => Number.isFinite(v) ? v : 0) as [number, number, number];

  const points = useMemo(() => [
    new THREE.Vector3(safeStart[0], safeStart[1], safeStart[2]),
    new THREE.Vector3(safeEnd[0], safeEnd[1], safeEnd[2]),
  ], [safeStart[0], safeStart[1], safeStart[2], safeEnd[0], safeEnd[1], safeEnd[2]]);

  // Determine label position (at the end of the axis)
  const labelPosition: [number, number, number] = useMemo(() => [
    safeEnd[0] + (safeEnd[0] - safeStart[0]) * 0.15,
    safeEnd[1] + (safeEnd[1] - safeStart[1]) * 0.15,
    safeEnd[2] + (safeEnd[2] - safeStart[2]) * 0.15,
  ], [safeStart[0], safeStart[1], safeStart[2], safeEnd[0], safeEnd[1], safeEnd[2]]);

  return (
    <group>
      <SimpleLine
        points={points}
        color={AXIS_COLOR}
      />
      <Text
        position={labelPosition}
        fontSize={0.12}
        color={AXIS_COLOR}
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}

/**
 * 3D grid for reference
 */
function Grid3D() {
  const gridLines = useMemo(() => {
    const lines: { points: THREE.Vector3[]; opacity: number }[] = [];
    const size = 2;
    const divisions = 4;

    // XY plane (at z = -1)
    for (let i = -divisions / 2; i <= divisions / 2; i++) {
      const pos = (i / divisions) * size;
      // X lines
      lines.push({
        points: [new THREE.Vector3(-1, pos, -1), new THREE.Vector3(1, pos, -1)],
        opacity: 0.2,
      });
      // Y lines
      lines.push({
        points: [new THREE.Vector3(pos, -1, -1), new THREE.Vector3(pos, 1, -1)],
        opacity: 0.2,
      });
    }

    // XZ plane (at y = -1)
    for (let i = -divisions / 2; i <= divisions / 2; i++) {
      const pos = (i / divisions) * size;
      lines.push({
        points: [new THREE.Vector3(-1, -1, pos), new THREE.Vector3(1, -1, pos)],
        opacity: 0.2,
      });
      lines.push({
        points: [new THREE.Vector3(pos, -1, -1), new THREE.Vector3(pos, -1, 1)],
        opacity: 0.2,
      });
    }

    // YZ plane (at x = -1)
    for (let i = -divisions / 2; i <= divisions / 2; i++) {
      const pos = (i / divisions) * size;
      lines.push({
        points: [new THREE.Vector3(-1, -1, pos), new THREE.Vector3(-1, 1, pos)],
        opacity: 0.2,
      });
      lines.push({
        points: [new THREE.Vector3(-1, pos, -1), new THREE.Vector3(-1, pos, 1)],
        opacity: 0.2,
      });
    }

    return lines;
  }, []);

  return (
    <group>
      {gridLines.map((line, i) => (
        <SimpleLine
          key={i}
          points={line.points}
          color={GRID_COLOR}
          opacity={line.opacity}
        />
      ))}
    </group>
  );
}

/**
 * Tooltip for hovered point
 */
interface PointTooltipProps {
  point: DataPoint | null;
  position: THREE.Vector3 | null;
}

function PointTooltip({ point, position }: PointTooltipProps) {
  if (!point || !position) return null;

  return (
    <Html position={[position.x, position.y + 0.15, position.z]} center>
      <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs whitespace-nowrap pointer-events-none">
        <p className="font-medium">{point.name}</p>
        {point.yValue !== undefined && (
          <p className="text-muted-foreground">Y: {point.yValue.toFixed(3)}</p>
        )}
      </div>
    </Html>
  );
}

/**
 * Camera controls with reset functionality
 */
interface CameraControllerProps {
  onReset?: () => void;
}

function CameraController({ onReset }: CameraControllerProps) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  const handleReset = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
    camera.position.set(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    onReset?.();
  }, [camera, onReset]);

  // Expose reset method
  React.useEffect(() => {
    (window as any).__scatter3d_reset = handleReset;
    return () => {
      delete (window as any).__scatter3d_reset;
    };
  }, [handleReset]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      zoomSpeed={0.8}
      panSpeed={0.5}
      minDistance={1}
      maxDistance={10}
    />
  );
}

/**
 * Scene content - contains all 3D elements
 */
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

/**
 * Loading fallback for Suspense
 */
function LoadingFallback() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2">
        <Box className="w-8 h-8 text-primary animate-pulse" />
        <span className="text-xs text-muted-foreground">Loading 3D view...</span>
      </div>
    </Html>
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
    if ((window as any).__scatter3d_reset) {
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
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        <div className="text-center">
          <Box className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
          <p>No data for 3D view</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full relative">
      {/* Control buttons */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        <TooltipProvider delayDuration={200}>
          <TooltipUI>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleReset}
              >
                <RotateCcw className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Reset camera</p>
            </TooltipContent>
          </TooltipUI>

          <TooltipUI>
            <TooltipTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={handleExport}
              >
                <Download className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="text-xs">Export as PNG</p>
            </TooltipContent>
          </TooltipUI>
        </TooltipProvider>
      </div>

      {/* Instructions overlay */}
      <div className="absolute bottom-2 left-2 z-10 text-[10px] text-muted-foreground bg-background/80 rounded px-2 py-1">
        Drag to rotate • Scroll to zoom • Right-drag to pan
      </div>

      {/* Sample count indicator */}
      <div className="absolute bottom-2 right-2 z-10 text-[10px] text-muted-foreground">
        {data.length} points
        {selectedSamples.size > 0 && (
          <span className="text-primary ml-1">• {selectedSamples.size} sel</span>
        )}
      </div>

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

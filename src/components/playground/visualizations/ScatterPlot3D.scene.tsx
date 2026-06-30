/**
 * Render-only Three.js sub-views for the ScatterPlot3D view.
 *
 * These components contain no data orchestration beyond per-view memoization of
 * geometry; data/bounds derivation and callback wiring live in ScatterPlot3D.
 */

import React, { useRef, useMemo, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import { Box } from 'lucide-react';
import type { DataPoint } from './ScatterPlot3D.types';
import {
  AXIS_COLOR,
  CAMERA_DISTANCE,
  GRID_COLOR,
  HOVERED_RADIUS,
  MAX_RENDERED_POINTS,
  POINT_RADIUS,
  SELECTED_RADIUS,
  normalizeData,
  parsePointColor,
} from './ScatterPlot3D.helpers';

/**
 * Simple line component using Three.js primitives (replaces drei Line to avoid NaN issues)
 */
interface SimpleLineProps {
  points: THREE.Vector3[];
  color: string;
  lineWidth?: number;
  opacity?: number;
}

export function SimpleLine({ points, color, opacity = 1 }: SimpleLineProps) {
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
  dimmed?: boolean;
  onClick?: () => void;
  onPointerOver?: () => void;
  onPointerOut?: () => void;
}

export function PointMesh({ position, color, radius, dimmed = false, onClick, onPointerOver, onPointerOut }: PointMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Parse the HSL/HSLA color to a concrete color value
  const parsedColor = useMemo(() => parsePointColor(color, dimmed), [color, dimmed]);

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

export function InstancedPoints({
  data,
  getColor,
  selectedSamples,
  hoveredSample,
  onSelect,
  onHover,
}: InstancedPointsProps) {
  // Normalize data
  const { normalized } = useMemo(() => normalizeData(data), [data]);

  // Create a lookup map from index to original data point (must be before early return — React Hook)
  const dataByIndex = useMemo(() => {
    const map = new Map<number, DataPoint>();
    data.forEach(d => map.set(d.index, d));
    return map;
  }, [data]);

  if (normalized.length === 0) return null;

  // Limit to MAX_RENDERED_POINTS for performance with individual meshes
  const maxPoints = Math.min(normalized.length, MAX_RENDERED_POINTS);

  return (
    <group>
      {normalized.slice(0, maxPoints).map((point) => {
        const isSelected = selectedSamples.has(point.index);
        const isHovered = hoveredSample === point.index;
        const hasSelection = selectedSamples.size > 0;
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
            dimmed={hasSelection && !isSelected && !isHovered}
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

export function AxisLine({ start, end, label }: AxisLineProps) {
  // Validate inputs - ensure all coordinates are finite
  const startX = Number.isFinite(start[0]) ? start[0] : 0;
  const startY = Number.isFinite(start[1]) ? start[1] : 0;
  const startZ = Number.isFinite(start[2]) ? start[2] : 0;
  const endX = Number.isFinite(end[0]) ? end[0] : 0;
  const endY = Number.isFinite(end[1]) ? end[1] : 0;
  const endZ = Number.isFinite(end[2]) ? end[2] : 0;

  const points = useMemo(() => [
    new THREE.Vector3(startX, startY, startZ),
    new THREE.Vector3(endX, endY, endZ),
  ], [startX, startY, startZ, endX, endY, endZ]);

  // Determine label position (at the end of the axis)
  const labelPosition: [number, number, number] = useMemo(() => [
    endX + (endX - startX) * 0.15,
    endY + (endY - startY) * 0.15,
    endZ + (endZ - startZ) * 0.15,
  ], [startX, startY, startZ, endX, endY, endZ]);

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
export function Grid3D() {
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

export function PointTooltip({ point, position }: PointTooltipProps) {
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

export function CameraController({ onReset }: CameraControllerProps) {
  const { camera } = useThree();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const controlsRef = useRef<any>(null);

  const handleReset = useCallback(() => {
    if (controlsRef.current) {
      controlsRef.current.reset();
    }
    camera.position.set(CAMERA_DISTANCE, CAMERA_DISTANCE, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);
    onReset?.();
  }, [camera, onReset]);

  // Expose reset method via window for cross-component communication
  React.useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__scatter3d_reset = handleReset;
    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
 * Loading fallback for Suspense
 */
export function LoadingFallback() {
  return (
    <Html center>
      <div className="flex flex-col items-center gap-2">
        <Box className="w-8 h-8 text-primary animate-pulse" />
        <span className="text-xs text-muted-foreground">Loading 3D view...</span>
      </div>
    </Html>
  );
}

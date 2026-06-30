/**
 * Render-only scene + overlay pieces for the ScatterWebGL view.
 *
 * These components live entirely inside the react-three-fiber <Canvas> tree
 * (plus the WebGL-unsupported fallback). They own no public props and no
 * selection-context wiring; the orchestration component (ScatterWebGL) passes
 * pre-computed point data, ranges, and callbacks down.
 */

import { useRef, useMemo, useEffect, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { OrthographicCamera, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { PointData } from './ScatterWebGL.types';

// ============= Point cloud =============

interface PointCloudProps {
  pointData: PointData[];
  onClick?: (index: number, event: MouseEvent) => void;
  onHover?: (index: number | null) => void;
}

export function PointCloud({ pointData, onClick, onHover }: PointCloudProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { raycaster, mouse, camera, gl } = useThree();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Create instanced mesh for normal points
  const instancedGeometry = useMemo(() => new THREE.CircleGeometry(0.01, 16), []);
  const instancedMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.6,
      }),
    []
  );

  // Update instanced mesh
  useEffect(() => {
    if (!meshRef.current) return;

    const mesh = meshRef.current;
    const matrix = new THREE.Matrix4();

    pointData.forEach((point, i) => {
      // Position
      matrix.setPosition(point.position);
      const scale = point.size;
      matrix.scale(new THREE.Vector3(scale, scale, scale));
      mesh.setMatrixAt(i, matrix);

      // Color
      mesh.setColorAt(i, point.color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [pointData]);

  // Raycasting for hover/click
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const rect = gl.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);

      if (meshRef.current) {
        const intersects = raycaster.intersectObject(meshRef.current);
        if (intersects.length > 0) {
          const instanceId = intersects[0].instanceId;
          if (instanceId !== undefined && instanceId !== hoveredIndex) {
            setHoveredIndex(instanceId);
            onHover?.(pointData[instanceId]?.index ?? null);
          }
        } else if (hoveredIndex !== null) {
          setHoveredIndex(null);
          onHover?.(null);
        }
      }
    };

    const handleClick = (event: MouseEvent) => {
      if (hoveredIndex !== null && pointData[hoveredIndex]) {
        onClick?.(pointData[hoveredIndex].index, event);
      }
    };

    gl.domElement.addEventListener('mousemove', handleMouseMove);
    gl.domElement.addEventListener('click', handleClick);

    return () => {
      gl.domElement.removeEventListener('mousemove', handleMouseMove);
      gl.domElement.removeEventListener('click', handleClick);
    };
  }, [gl, raycaster, mouse, camera, hoveredIndex, pointData, onClick, onHover]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[instancedGeometry, instancedMaterial, pointData.length]}
      frustumCulled={false}
    />
  );
}

// ============= Axes / grid overlay =============

interface AxesOverlayProps {
  xRange: [number, number];
  yRange: [number, number];
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
}

export function AxesOverlay({ xRange, yRange, xLabel, yLabel, showGrid }: AxesOverlayProps) {
  const xTicks = useMemo(() => {
    const [min, max] = xRange;
    const step = (max - min) / 5;
    return Array.from({ length: 6 }, (_, i) => ({
      value: min + i * step,
      position: i / 5,
    }));
  }, [xRange]);

  const yTicks = useMemo(() => {
    const [min, max] = yRange;
    const step = (max - min) / 5;
    return Array.from({ length: 6 }, (_, i) => ({
      value: min + i * step,
      position: i / 5,
    }));
  }, [yRange]);

  // Create grid line geometries
  const xGridPositions = useMemo(() => {
    return xTicks.map(tick => new Float32Array([tick.position, 0, 0, tick.position, 1, 0]));
  }, [xTicks]);

  const yGridPositions = useMemo(() => {
    return yTicks.map(tick => new Float32Array([0, tick.position, 0, 1, tick.position, 0]));
  }, [yTicks]);

  return (
    <group>
      {/* Grid lines */}
      {showGrid && (
        <>
          {xTicks.map((tick, i) => (
            <line key={`grid-x-${i}`}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[xGridPositions[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#333" opacity={0.3} transparent />
            </line>
          ))}
          {yTicks.map((tick, i) => (
            <line key={`grid-y-${i}`}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[yGridPositions[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color="#333" opacity={0.3} transparent />
            </line>
          ))}
        </>
      )}

      {/* X-axis ticks */}
      {xTicks.map((tick, i) => (
        <Html
          key={`x-label-${i}`}
          position={[tick.position, -0.08, 0]}
          center
          style={{ fontSize: '9px', color: '#888', pointerEvents: 'none' }}
        >
          {tick.value.toFixed(1)}
        </Html>
      ))}

      {/* Y-axis ticks */}
      {yTicks.map((tick, i) => (
        <Html
          key={`y-label-${i}`}
          position={[-0.08, tick.position, 0]}
          center
          style={{ fontSize: '9px', color: '#888', pointerEvents: 'none' }}
        >
          {tick.value.toFixed(1)}
        </Html>
      ))}

      {/* Axis labels */}
      <Html
        position={[0.5, -0.15, 0]}
        center
        style={{ fontSize: '11px', color: '#666', pointerEvents: 'none', fontWeight: 500 }}
      >
        {xLabel}
      </Html>
      <Html
        position={[-0.15, 0.5, 0]}
        center
        style={{
          fontSize: '11px',
          color: '#666',
          pointerEvents: 'none',
          fontWeight: 500,
          transform: 'rotate(-90deg)',
        }}
      >
        {yLabel}
      </Html>
    </group>
  );
}

// ============= Camera controller =============

interface CameraControllerProps {
  onZoomChange?: (zoom: number) => void;
}

export function CameraController({ onZoomChange }: CameraControllerProps) {
  const { camera, gl } = useThree();
  const isDragging = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });
  const zoom = useRef(1);

  useEffect(() => {
    const domElement = gl.domElement;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      zoom.current = Math.max(0.5, Math.min(10, zoom.current * delta));

      if (camera instanceof THREE.OrthographicCamera) {
        const newZoom = zoom.current;
        const padding = 0.15 / newZoom;
        camera.left = -padding;
        camera.right = 1 + padding;
        camera.top = 1 + padding;
        camera.bottom = -padding;
        camera.updateProjectionMatrix();
      }

      onZoomChange?.(zoom.current);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isDragging.current = true;
        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current && camera instanceof THREE.OrthographicCamera) {
        const dx = (e.clientX - lastPos.current.x) * 0.002 / zoom.current;
        const dy = (e.clientY - lastPos.current.y) * 0.002 / zoom.current;

        camera.left += dx;
        camera.right += dx;
        camera.top -= dy;
        camera.bottom -= dy;
        camera.updateProjectionMatrix();

        lastPos.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      isDragging.current = false;
    };

    domElement.addEventListener('wheel', handleWheel, { passive: false });
    domElement.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      domElement.removeEventListener('wheel', handleWheel);
      domElement.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [camera, gl, onZoomChange]);

  return null;
}

// ============= Scene =============

interface ScatterSceneProps {
  pointData: PointData[];
  xRange: [number, number];
  yRange: [number, number];
  xLabel: string;
  yLabel: string;
  showGrid: boolean;
  onClick?: (index: number, event: MouseEvent) => void;
  onHover?: (index: number | null) => void;
  onZoomChange?: (zoom: number) => void;
}

export function ScatterScene({
  pointData,
  xRange,
  yRange,
  xLabel,
  yLabel,
  showGrid,
  onClick,
  onHover,
  onZoomChange,
}: ScatterSceneProps) {
  return (
    <>
      <OrthographicCamera
        makeDefault
        position={[0.5, 0.5, 5]}
        zoom={1}
        left={-0.15}
        right={1.15}
        top={1.15}
        bottom={-0.15}
      />
      <CameraController onZoomChange={onZoomChange} />
      <AxesOverlay
        xRange={xRange}
        yRange={yRange}
        xLabel={xLabel}
        yLabel={yLabel}
        showGrid={showGrid}
      />
      <PointCloud pointData={pointData} onClick={onClick} onHover={onHover} />
    </>
  );
}

// ============= Fallback =============

export function WebGLNotSupported() {
  return (
    <div className="flex items-center justify-center h-full text-center p-4">
      <div className="text-muted-foreground">
        <div className="mb-2">WebGL is not supported</div>
        <div className="text-xs">Please use Canvas mode or try a different browser</div>
      </div>
    </div>
  );
}

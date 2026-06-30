import { useMemo } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

import { CHART_THEME } from './chartConfig';
import { buildSpectraWebGLAxisTicks } from './spectraWebGLAxisTicks';

export interface SpectraWebGLAxesProps {
  yRange: [number, number];
  xLabel?: string;
  yLabel?: string;
  xViewRange: [number, number];
  showGrid?: boolean;
}

export function SpectraWebGLAxes({
  yRange,
  xLabel = 'Wavelength (nm)',
  yLabel = 'Intensity',
  xViewRange,
  showGrid = true,
}: SpectraWebGLAxesProps) {
  const axisColor = useMemo(() => new THREE.Color(CHART_THEME.axisStroke), []);
  const gridColor = useMemo(() => new THREE.Color(CHART_THEME.gridStroke), []);
  const xTicks = useMemo(() => buildSpectraWebGLAxisTicks(xViewRange, 6), [xViewRange]);
  const yTicks = useMemo(() => buildSpectraWebGLAxisTicks(yRange, 5), [yRange]);

  const axisGeometry = useMemo(() => {
    const xAxisPositions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const yAxisPositions = new Float32Array([0, 0, 0, 0, 1, 0]);
    return { xAxisPositions, yAxisPositions };
  }, []);

  return (
    <group>
      {showGrid && (
        <group>
          {xTicks.map((tick, index) => {
            const gridPositions = new Float32Array([tick.position, 0, -0.01, tick.position, 1, -0.01]);
            return (
              <line key={`grid-x-${index}`}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color={gridColor} transparent opacity={CHART_THEME.gridOpacity} />
              </line>
            );
          })}
          {yTicks.map((tick, index) => {
            const gridPositions = new Float32Array([0, tick.position, -0.01, 1, tick.position, -0.01]);
            return (
              <line key={`grid-y-${index}`}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color={gridColor} transparent opacity={CHART_THEME.gridOpacity} />
              </line>
            );
          })}
        </group>
      )}

      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[axisGeometry.xAxisPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={axisColor} />
      </line>

      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[axisGeometry.yAxisPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={axisColor} />
      </line>

      {xTicks.map((tick, index) => {
        const tickPositions = new Float32Array([tick.position, -0.02, 0, tick.position, 0, 0]);
        return (
          <group key={`x-tick-${index}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[tickPositions, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={axisColor} />
            </line>
            <Html position={[tick.position, -0.06, 0]} center style={{ fontSize: `${CHART_THEME.axisFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {tick.label.toFixed(0)}
            </Html>
          </group>
        );
      })}

      {yTicks.map((tick, index) => {
        const tickPositions = new Float32Array([-0.02, tick.position, 0, 0, tick.position, 0]);
        return (
          <group key={`y-tick-${index}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute attach="attributes-position" args={[tickPositions, 3]} />
              </bufferGeometry>
              <lineBasicMaterial color={axisColor} />
            </line>
            <Html position={[-0.05, tick.position, 0]} center style={{ fontSize: `${CHART_THEME.axisFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {tick.label.toFixed(2)}
            </Html>
          </group>
        );
      })}

      <Html position={[0.5, -0.11, 0]} center style={{ fontSize: `${CHART_THEME.axisLabelFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none' }}>
        {xLabel}
      </Html>
      <Html position={[-0.1, 0.5, 0]} center style={{ fontSize: `${CHART_THEME.axisLabelFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none', transform: 'rotate(-90deg)' }}>
        {yLabel}
      </Html>
    </group>
  );
}

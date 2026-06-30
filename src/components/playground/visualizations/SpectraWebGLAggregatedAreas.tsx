import { useMemo } from 'react';
import * as THREE from 'three';

import { buildSpectraWebGLAggregatedAreaGeometry } from './spectraWebGLSceneGeometry';
import {
  buildSpectraWebGLGroupedAreaEntries,
  type SpectraWebGLAreaStats,
} from './spectraWebGLAreaEntries';

interface SpectraWebGLAggregatedAreaProps extends SpectraWebGLAreaStats {
  wavelengths: number[];
  xRange: [number, number];
  yRange: [number, number];
  color?: string;
  showMean?: boolean;
}

export function SpectraWebGLAggregatedArea({
  wavelengths,
  min,
  max,
  median,
  mean,
  quantileLower,
  quantileUpper,
  xRange,
  yRange,
  color = 'hsl(217, 70%, 50%)',
  showMean = false,
}: SpectraWebGLAggregatedAreaProps) {
  const geometryData = useMemo(() => buildSpectraWebGLAggregatedAreaGeometry({
    wavelengths,
    min,
    max,
    median,
    mean,
    quantileLower,
    quantileUpper,
    xRange,
    yRange,
    showMean,
  }), [wavelengths, min, max, median, mean, quantileLower, quantileUpper, xRange, yRange, showMean]);

  if (!geometryData) return null;

  const areaColor = new THREE.Color(color);
  const lineColor = new THREE.Color(color);

  return (
    <group>
      <mesh>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[geometryData.areaPositions, 3]}
          />
        </bufferGeometry>
        <meshBasicMaterial
          color={areaColor}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {geometryData.quantilePositions && (
        <mesh>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[geometryData.quantilePositions, 3]}
            />
          </bufferGeometry>
          <meshBasicMaterial
            color={areaColor}
            transparent
            opacity={0.25}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      )}

      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[geometryData.centerLinePositions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color={lineColor} linewidth={2} />
      </line>
    </group>
  );
}

export interface SpectraWebGLGroupedAreasProps {
  wavelengths: number[];
  groupedStats: Map<string | number, SpectraWebGLAreaStats>;
  xRange: [number, number];
  yRange: [number, number];
  colors: string[];
}

export function SpectraWebGLGroupedAreas({
  wavelengths,
  groupedStats,
  xRange,
  yRange,
  colors,
}: SpectraWebGLGroupedAreasProps) {
  const groups = useMemo(
    () => buildSpectraWebGLGroupedAreaEntries(groupedStats, colors),
    [groupedStats, colors]
  );

  return (
    <group>
      {groups.map(({ label, stats, color }) => (
        <SpectraWebGLAggregatedArea
          key={String(label)}
          wavelengths={wavelengths}
          min={stats.quantileLower}
          max={stats.quantileUpper}
          median={stats.median}
          mean={stats.mean}
          std={stats.std}
          quantileLower={stats.quantileLower}
          quantileUpper={stats.quantileUpper}
          xRange={xRange}
          yRange={yRange}
          color={color}
          showMean
        />
      ))}
    </group>
  );
}

import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { SELECTION_COLORS } from './chartConfig';
import type { SpectraWebGLLineData } from './spectraWebGLLines';
import {
  buildSpectraWebGLBatchedLineGroups,
  buildSpectraWebGLLinePositions,
} from './spectraWebGLSceneGeometry';
import { partitionSpectraWebGLLines } from './spectraWebGLLinePartition';

export interface SpectraWebGLLineQualityConfig {
  normalLineWidth: number;
  selectedLineWidth: number;
  normalOpacity: number;
}

interface BatchedLinesProps {
  lines: SpectraWebGLLineData[];
  lineWidth: number;
  opacity: number;
}

function BatchedLines({ lines, lineWidth, opacity }: BatchedLinesProps) {
  const groupRef = useRef<THREE.Group>(null);

  const lineGroups = useMemo(() => buildSpectraWebGLBatchedLineGroups(lines), [lines]);

  const colorGroups = useMemo(() => {
    return lineGroups.map(({ color, colorKey, positions }) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0), 1);

      return { geometry, color, colorKey };
    });
  }, [lineGroups]);

  useEffect(() => {
    return () => {
      colorGroups.forEach(({ geometry }) => geometry.dispose());
    };
  }, [colorGroups]);

  return (
    <group ref={groupRef}>
      {colorGroups.map(({ geometry, color, colorKey }) => (
        <line key={colorKey}>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial
            color={color}
            transparent
            opacity={opacity}
            linewidth={lineWidth}
          />
        </line>
      ))}
    </group>
  );
}

interface HighlightedLinesProps {
  lines: SpectraWebGLLineData[];
  lineWidth: number;
  zOrder?: number;
}

const HighlightedLine = memo(function HighlightedLine({
  line,
  lineWidth,
  zOrder,
}: {
  line: SpectraWebGLLineData;
  lineWidth: number;
  zOrder: number;
}) {
  const positions = useMemo(() => buildSpectraWebGLLinePositions(line, zOrder), [line, zOrder]);

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={line.color} linewidth={lineWidth} />
    </line>
  );
});

function HighlightedLines({ lines, lineWidth, zOrder = 0.01 }: HighlightedLinesProps) {
  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map(line => (
        <HighlightedLine
          key={`${line.isOriginal ? 'orig' : 'proc'}-${line.index}`}
          line={line}
          lineWidth={lineWidth}
          zOrder={zOrder}
        />
      ))}
    </group>
  );
}

interface HoveredLineProps {
  lines: SpectraWebGLLineData[];
  hoveredIdx: number | null;
  lineWidth: number;
}

const HOVER_LINE_COLOR = new THREE.Color(SELECTION_COLORS.hovered);

function HoveredLine({ lines, hoveredIdx, lineWidth }: HoveredLineProps) {
  const hoveredLine = useMemo(
    () => (hoveredIdx === null ? null : lines.find(line => line.index === hoveredIdx && !line.isOriginal) ?? null),
    [lines, hoveredIdx]
  );

  const positions = useMemo(() => {
    if (!hoveredLine) return null;
    return buildSpectraWebGLLinePositions(hoveredLine, 0.03);
  }, [hoveredLine]);

  if (!positions) return null;

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color={HOVER_LINE_COLOR}
        linewidth={lineWidth + 1}
      />
    </line>
  );
}

export interface SpectraLinesProps {
  lines: SpectraWebGLLineData[];
  qualityConfig: SpectraWebGLLineQualityConfig;
  hoveredIdx?: number | null;
  unselectedOpacity?: number;
  selectedIndices?: ReadonlySet<number>;
  pinnedIndices?: ReadonlySet<number>;
}

export function SpectraLines({
  lines,
  qualityConfig,
  hoveredIdx,
  unselectedOpacity,
  selectedIndices,
  pinnedIndices,
}: SpectraLinesProps) {
  const { normalLines, originalLines, selectedLines, pinnedLines } = useMemo(
    () => partitionSpectraWebGLLines(lines, selectedIndices, pinnedIndices),
    [lines, selectedIndices, pinnedIndices]
  );

  return (
    <group>
      {originalLines.length > 0 && (
        <BatchedLines
          lines={originalLines}
          lineWidth={qualityConfig.normalLineWidth}
          opacity={(unselectedOpacity ?? qualityConfig.normalOpacity) * 0.6}
        />
      )}

      {normalLines.length > 0 && (
        <BatchedLines
          lines={normalLines}
          lineWidth={qualityConfig.normalLineWidth}
          opacity={unselectedOpacity ?? qualityConfig.normalOpacity}
        />
      )}

      <HighlightedLines
        lines={selectedLines}
        lineWidth={qualityConfig.selectedLineWidth}
        zOrder={0.01}
      />

      <HighlightedLines
        lines={pinnedLines}
        lineWidth={qualityConfig.selectedLineWidth + 0.5}
        zOrder={0.02}
      />

      <HoveredLine
        lines={lines}
        hoveredIdx={hoveredIdx ?? null}
        lineWidth={qualityConfig.selectedLineWidth}
      />
    </group>
  );
}

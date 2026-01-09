/**
 * SpectraWebGL - High-performance WebGL renderer for spectra visualization
 *
 * Uses Three.js/react-three-fiber for GPU-accelerated line rendering:
 * - Batched line geometry with single draw call (not individual Line components)
 * - Adaptive LOD: point decimation when zoomed out
 * - Quality modes: low/medium/high for performance tuning
 * - Renders 10k+ lines at 60fps
 * - X-axis zoom with scroll, auto-fit Y
 * - Fallback detection for unsupported browsers
 *
 * Phase 6: Performance & Polish - Optimized
 */

import { useRef, useMemo, useCallback, useEffect, useState, useLayoutEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/SelectionContext';
import { detectDeviceCapabilities } from '@/lib/playground/renderOptimizer';
import { CHART_THEME } from './chartConfig';

// ============= Types =============

export type QualityMode = 'low' | 'medium' | 'high' | 'auto';

export interface SpectraWebGLProps {
  /** Spectra data (samples × wavelengths) */
  spectra: number[][];
  /** Wavelength values */
  wavelengths: number[];
  /** Optional second set of spectra (for "both" view - original) */
  originalSpectra?: number[][];
  /** Target values for coloring */
  y?: number[];
  /** Sample indices to render (for sampling) */
  visibleIndices?: number[];
  /** Base color for lines */
  baseColor?: string;
  /** Color for original spectra in "both" mode */
  originalColor?: string;
  /** Selected sample color */
  selectedColor?: string;
  /** Pinned sample color */
  pinnedColor?: string;
  /** Use SelectionContext for highlighting and selection (default: true) */
  useSelectionContext?: boolean;
  /** Callback when hovered sample changes (for components without context) */
  onHover?: (index: number | null) => void;
  /** Manually provided selected indices */
  selectedIndices?: number[];
  /** Manually provided pinned indices */
  pinnedIndices?: number[];
  /** Custom colors per sample index (overrides y-coloring) */
  sampleColors?: string[];
  /** Callback when sample is clicked */
  onSampleClick?: (index: number, event: MouseEvent) => void;
  /** Container class name */
  className?: string;
  /** Min/max Y range override (default auto from data) */
  yRange?: [number, number];
  /** Whether to show loading state */
  isLoading?: boolean;
  /** Quality mode for performance tuning */
  quality?: QualityMode;
  /** Callback when quality is changed via UI */
  onQualityChange?: (quality: QualityMode) => void;
  /** Max samples to render (0 = no limit) */
  maxSamples?: number;
  /** Show quality controls */
  showQualityControls?: boolean;
  /** Show grid lines */
  showGrid?: boolean;
}

interface LineData {
  points: Float32Array; // Flat array: x1,y1,x2,y2,... for LINE_STRIP
  color: THREE.Color;
  index: number;
  isSelected: boolean;
  isPinned: boolean;
  isOriginal: boolean;
  pointCount: number;
}

// ============= Quality Configuration =============

interface QualityConfig {
  /** Max points per spectrum (decimation factor) */
  maxPointsPerSpectrum: number;
  /** Line width for normal lines */
  normalLineWidth: number;
  /** Line width for selected lines */
  selectedLineWidth: number;
  /** Opacity for normal lines */
  normalOpacity: number;
  /** Anti-aliasing */
  antialias: boolean;
  /** DPR limit */
  maxDpr: number;
}

const QUALITY_CONFIGS: Record<Exclude<QualityMode, 'auto'>, QualityConfig> = {
  low: {
    maxPointsPerSpectrum: 100,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: false,
    maxDpr: 1,
  },
  medium: {
    maxPointsPerSpectrum: 300,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: true,
    maxDpr: 1.5,
  },
  high: {
    maxPointsPerSpectrum: 1000,
    normalLineWidth: 1,
    selectedLineWidth: 2,
    normalOpacity: 1.0,
    antialias: true,
    maxDpr: 2,
  },
};

/**
 * Auto-select quality based on data size
 */
function selectAutoQuality(nSamples: number, nWavelengths: number): Exclude<QualityMode, 'auto'> {
  const complexity = nSamples * nWavelengths;
  if (complexity > 500_000) return 'low';
  if (complexity > 100_000) return 'medium';
  return 'high';
}

// ============= Helpers =============

/**
 * Parse color string to THREE.Color
 */
function parseColor(color: string): THREE.Color {
  try {
    return new THREE.Color(color);
  } catch {
    return new THREE.Color(0x3b82f6); // Default blue
  }
}

/**
 * Normalize data to 0-1 range for rendering
 * Returns 0.5 for invalid inputs to prevent NaN propagation
 */
function normalizeValue(value: number, min: number, max: number): number {
  // Guard against NaN/Infinity inputs
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return 0.5;
  }
  if (max === min) return 0.5;
  const result = (value - min) / (max - min);
  // Guard against NaN result (shouldn't happen but defensive)
  return Number.isFinite(result) ? result : 0.5;
}

/**
 * Get color based on target value (matches Canvas version's blue-to-red gradient)
 * Uses the same HSL formula as getSampleColorByY in chartConfig.ts
 */
function getTargetColor(y: number, yMin: number, yMax: number): THREE.Color {
  const t = normalizeValue(y, yMin, yMax);

  // Blue to Red gradient (HSL hue 240 → 60)
  // Matches chartConfig.getSampleColorByY: hue = 240 - t * 180
  const hue = (240 - t * 180) / 360; // Convert to 0-1 range for THREE.js
  const saturation = 1.0;
  const lightness = 0.3;

  const color = new THREE.Color();
  color.setHSL(hue, saturation, lightness);
  return color;
}

/**
 * Decimate array to target length using Largest-Triangle-Three-Buckets (LTTB) algorithm
 * This preserves visual features better than simple stepping
 *
 * Now correctly maps to [0,1] based on xViewRange for proper zoom behavior
 */
function decimatePoints(
  wavelengths: number[],
  values: number[],
  targetLength: number,
  xViewRange: [number, number],
  yRange: [number, number]
): Float32Array {
  // Filter to visible range and normalize to [0,1] based on VIEW range
  const visiblePoints: { x: number; y: number }[] = [];
  for (let i = 0; i < wavelengths.length; i++) {
    const wl = wavelengths[i];
    if (wl >= xViewRange[0] && wl <= xViewRange[1]) {
      // Normalize X to [0,1] based on VIEW range (not full range)
      const normX = normalizeValue(wl, xViewRange[0], xViewRange[1]);
      const normY = normalizeValue(values[i], yRange[0], yRange[1]);
      visiblePoints.push({ x: normX, y: normY });
    }
  }

  const n = visiblePoints.length;
  if (n <= targetLength || targetLength < 3) {
    // No decimation needed
    const result = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      result[i * 2] = visiblePoints[i].x;
      result[i * 2 + 1] = visiblePoints[i].y;
    }
    return result;
  }

  // LTTB algorithm for feature-preserving decimation
  const sampled: { x: number; y: number }[] = [];
  const bucketSize = (n - 2) / (targetLength - 2);

  // Always include first point
  sampled.push(visiblePoints[0]);

  for (let i = 0; i < targetLength - 2; i++) {
    const avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    const avgRangeEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n);

    // Calculate average point in next bucket
    let avgX = 0, avgY = 0;
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += visiblePoints[j].x;
      avgY += visiblePoints[j].y;
    }
    avgX /= (avgRangeEnd - avgRangeStart);
    avgY /= (avgRangeEnd - avgRangeStart);

    // Find point in current bucket with largest triangle area
    const rangeStart = Math.floor(i * bucketSize) + 1;
    const rangeEnd = avgRangeStart;
    const lastPoint = sampled[sampled.length - 1];

    let maxArea = -1;
    let maxAreaIdx = rangeStart;

    for (let j = rangeStart; j < rangeEnd; j++) {
      const area = Math.abs(
        (lastPoint.x - avgX) * (visiblePoints[j].y - lastPoint.y) -
        (lastPoint.x - visiblePoints[j].x) * (avgY - lastPoint.y)
      );
      if (area > maxArea) {
        maxArea = area;
        maxAreaIdx = j;
      }
    }

    sampled.push(visiblePoints[maxAreaIdx]);
  }

  // Always include last point
  sampled.push(visiblePoints[n - 1]);

  const result = new Float32Array(sampled.length * 2);
  for (let i = 0; i < sampled.length; i++) {
    result[i * 2] = sampled[i].x;
    result[i * 2 + 1] = sampled[i].y;
  }
  return result;
}

// ============= WebGL Scene Components =============

/**
 * Batched line renderer using a single BufferGeometry
 * Much more efficient than individual Line components
 */
interface BatchedLinesProps {
  lines: LineData[];
  lineWidth: number;
  opacity: number;
}

function BatchedLines({ lines, lineWidth, opacity }: BatchedLinesProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Create line segments for each spectrum using LineSegments or Line
  // Group by color for batch rendering efficiency
  const linesByColor = useMemo(() => {
    const colorMap = new Map<string, { lines: LineData[]; color: THREE.Color }>();

    for (const line of lines) {
      const key = line.color.getHexString();
      if (!colorMap.has(key)) {
        colorMap.set(key, { lines: [], color: line.color.clone() });
      }
      colorMap.get(key)!.lines.push(line);
    }

    return Array.from(colorMap.values());
  }, [lines]);

  // Create geometries for each color group
  const colorGroups = useMemo(() => {
    return linesByColor.map(({ lines: groupLines, color }) => {
      // Calculate total points needed
      let totalPoints = 0;
      for (const line of groupLines) {
        // For LINE_STRIP, we need to add a break between lines
        // Use NaN to break the line
        totalPoints += line.pointCount + 1; // +1 for break point
      }

      // Create position array
      const positions = new Float32Array(totalPoints * 3);
      let offset = 0;

      for (const line of groupLines) {
        const n = line.pointCount;
        for (let i = 0; i < n; i++) {
          positions[offset * 3] = line.points[i * 2]; // x
          positions[offset * 3 + 1] = line.points[i * 2 + 1]; // y
          positions[offset * 3 + 2] = 0; // z
          offset++;
        }
        // Add NaN break point
        positions[offset * 3] = NaN;
        positions[offset * 3 + 1] = NaN;
        positions[offset * 3 + 2] = NaN;
        offset++;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      // Manually set bounding sphere to prevent THREE.js from computing it
      // (computation fails with NaN break points in the position array)
      // Data is normalized to [0,1] range, so sphere at center (0.5, 0.5, 0) with radius 1 covers all
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0.5, 0.5, 0), 1);

      return { geometry, color };
    });
  }, [linesByColor]);

  // Cleanup geometries on unmount
  useEffect(() => {
    return () => {
      colorGroups.forEach(({ geometry }) => geometry.dispose());
    };
  }, [colorGroups]);

  return (
    <group ref={groupRef}>
      {colorGroups.map(({ geometry, color }, idx) => (
        <line key={idx}>
          <primitive object={geometry} attach="geometry" />
          <lineBasicMaterial
            color={color}
            transparent={opacity < 1.0}
            opacity={opacity}
            linewidth={lineWidth}
          />
        </line>
      ))}
    </group>
  );
}

/**
 * Highlighted lines (selected/pinned) rendered separately for clarity
 */
interface HighlightedLinesProps {
  lines: LineData[];
  lineWidth: number;
}

function HighlightedLines({ lines, lineWidth }: HighlightedLinesProps) {
  if (lines.length === 0) return null;

  return (
    <group>
      {lines.map((line) => {
        const positions = new Float32Array(line.pointCount * 3);
        for (let i = 0; i < line.pointCount; i++) {
          positions[i * 3] = line.points[i * 2];
          positions[i * 3 + 1] = line.points[i * 2 + 1];
          positions[i * 3 + 2] = line.isPinned ? 0.02 : 0.01; // z-order
        }

        return (
          <line key={`${line.isOriginal ? 'orig' : 'proc'}-${line.index}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                args={[positions, 3]}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color={line.color}
              linewidth={lineWidth}
            />
          </line>
        );
      })}
    </group>
  );
}

/**
 * Renders a single hovered line on top - lightweight component that doesn't
 * require recomputation of all line data when hover changes
 */
interface HoveredLineProps {
  lines: LineData[];
  hoveredIdx: number | null;
  lineWidth: number;
}

function HoveredLine({ lines, hoveredIdx, lineWidth }: HoveredLineProps) {
  if (hoveredIdx === null) return null;

  const hoveredLine = lines.find(l => l.index === hoveredIdx && !l.isOriginal);
  if (!hoveredLine) return null;

  const positions = new Float32Array(hoveredLine.pointCount * 3);
  for (let i = 0; i < hoveredLine.pointCount; i++) {
    positions[i * 3] = hoveredLine.points[i * 2];
    positions[i * 3 + 1] = hoveredLine.points[i * 2 + 1];
    positions[i * 3 + 2] = 0.03; // z-order above pinned
  }

  return (
    <line>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <lineBasicMaterial
        color="#ffffff"
        linewidth={lineWidth + 1}
      />
    </line>
  );
}

interface SpectraLinesProps {
  lines: LineData[];
  qualityConfig: QualityConfig;
  hoveredIdx?: number | null;
}

function SpectraLines({ lines, qualityConfig, hoveredIdx }: SpectraLinesProps) {
  // Separate lines by type for layered rendering
  const { normalLines, originalLines, selectedLines, pinnedLines } = useMemo(() => {
    const normal: LineData[] = [];
    const original: LineData[] = [];
    const selected: LineData[] = [];
    const pinned: LineData[] = [];

    for (const line of lines) {
      if (line.isPinned) {
        pinned.push(line);
      } else if (line.isSelected) {
        selected.push(line);
      } else if (line.isOriginal) {
        original.push(line);
      } else {
        normal.push(line);
      }
    }

    return { normalLines: normal, originalLines: original, selectedLines: selected, pinnedLines: pinned };
  }, [lines]);

  return (
    <group>
      {/* Original lines (behind, lower opacity) */}
      {originalLines.length > 0 && (
        <BatchedLines
          lines={originalLines}
          lineWidth={qualityConfig.normalLineWidth}
          opacity={qualityConfig.normalOpacity * 0.6}
        />
      )}

      {/* Normal processed lines */}
      {normalLines.length > 0 && (
        <BatchedLines
          lines={normalLines}
          lineWidth={qualityConfig.normalLineWidth}
          opacity={qualityConfig.normalOpacity}
        />
      )}

      {/* Selected lines - render individually for highlight effect */}
      <HighlightedLines
        lines={selectedLines}
        lineWidth={qualityConfig.selectedLineWidth}
      />

      {/* Pinned lines - render on top */}
      <HighlightedLines
        lines={pinnedLines}
        lineWidth={qualityConfig.selectedLineWidth + 0.5}
      />

      {/* Hovered line - render on very top */}
      <HoveredLine
        lines={lines}
        hoveredIdx={hoveredIdx ?? null}
        lineWidth={qualityConfig.selectedLineWidth}
      />
    </group>
  );
}

interface AxesProps {
  yRange: [number, number];
  xLabel?: string;
  yLabel?: string;
  xViewRange: [number, number]; // Visible X range after zoom (used for tick labels)
  showGrid?: boolean;
}

function Axes({ yRange, xLabel = 'Wavelength (nm)', yLabel = 'Intensity', xViewRange, showGrid = true }: AxesProps) {
  // Parse theme colors for WebGL
  const axisColor = useMemo(() => new THREE.Color(CHART_THEME.axisStroke), []);
  const gridColor = useMemo(() => new THREE.Color(CHART_THEME.gridStroke), []);

  // X ticks evenly distributed across [0, 1] with labels from xViewRange
  const xTicks = useMemo(() => {
    const [min, max] = xViewRange;
    const tickCount = 6;
    return Array.from({ length: tickCount }, (_, i) => ({
      position: i / (tickCount - 1), // 0 to 1
      label: min + (i / (tickCount - 1)) * (max - min),
    }));
  }, [xViewRange]);

  const yTicks = useMemo(() => {
    const [min, max] = yRange;
    const step = (max - min) / 4;
    return Array.from({ length: 5 }, (_, i) => ({
      position: i / 4, // 0 to 1
      label: min + i * step,
    }));
  }, [yRange]);

  // Create axis geometry once
  const axisGeometry = useMemo(() => {
    const xAxisPositions = new Float32Array([0, 0, 0, 1, 0, 0]);
    const yAxisPositions = new Float32Array([0, 0, 0, 0, 1, 0]);
    return { xAxisPositions, yAxisPositions };
  }, []);

  return (
    <group>
      {/* Grid lines */}
      {showGrid && (
        <group>
          {/* Vertical grid lines (X) */}
          {xTicks.map((tick, i) => {
            const gridPositions = new Float32Array([tick.position, 0, -0.01, tick.position, 1, -0.01]);
            return (
              <line key={`grid-x-${i}`}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color={gridColor} transparent opacity={CHART_THEME.gridOpacity} />
              </line>
            );
          })}
          {/* Horizontal grid lines (Y) */}
          {yTicks.map((tick, i) => {
            const gridPositions = new Float32Array([0, tick.position, -0.01, 1, tick.position, -0.01]);
            return (
              <line key={`grid-y-${i}`}>
                <bufferGeometry>
                  <bufferAttribute attach="attributes-position" args={[gridPositions, 3]} />
                </bufferGeometry>
                <lineBasicMaterial color={gridColor} transparent opacity={CHART_THEME.gridOpacity} />
              </line>
            );
          })}
        </group>
      )}

      {/* X Axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[axisGeometry.xAxisPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={axisColor} />
      </line>

      {/* Y Axis */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[axisGeometry.yAxisPositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={axisColor} />
      </line>

      {/* X Ticks - positions are in [0,1], labels are from xViewRange */}
      {xTicks.map((tick, i) => {
        const tickPositions = new Float32Array([tick.position, -0.02, 0, tick.position, 0, 0]);
        return (
          <group key={`x-tick-${i}`}>
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

      {/* Y Ticks */}
      {yTicks.map((tick, i) => {
        const tickPositions = new Float32Array([-0.02, tick.position, 0, 0, tick.position, 0]);
        return (
          <group key={`y-tick-${i}`}>
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

      {/* Axis Labels */}
      <Html position={[0.5, -0.11, 0]} center style={{ fontSize: `${CHART_THEME.axisLabelFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none' }}>
        {xLabel}
      </Html>
      <Html position={[-0.1, 0.5, 0]} center style={{ fontSize: `${CHART_THEME.axisLabelFontSize}px`, color: CHART_THEME.axisStroke, pointerEvents: 'none', transform: 'rotate(-90deg)' }}>
        {yLabel}
      </Html>
    </group>
  );
}

interface XZoomControllerProps {
  xRange: [number, number];
  onXViewRangeChange: (range: [number, number]) => void;
}

function XZoomController({ xRange, onXViewRangeChange }: XZoomControllerProps) {
  const { gl } = useThree();
  const isDragging = useRef(false);
  const lastX = useRef(0);
  const viewRange = useRef<[number, number]>([...xRange]);
  const xRangeRef = useRef(xRange);
  const initializedRef = useRef(false);

  // Update refs when xRange changes - sync viewRange if data changes significantly
  useEffect(() => {
    const prevRange = xRangeRef.current;
    const rangeChanged =
      Math.abs(prevRange[0] - xRange[0]) > 1 ||
      Math.abs(prevRange[1] - xRange[1]) > 1;

    xRangeRef.current = xRange;

    // Only reset view on first mount or significant data change
    if (!initializedRef.current || rangeChanged) {
      viewRange.current = [...xRange];
      initializedRef.current = true;
    }
  }, [xRange]);

  useEffect(() => {
    const domElement = gl.domElement;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();

      const [xMin, xMax] = xRangeRef.current;
      const fullRange = xMax - xMin;

      // Get mouse position relative to canvas (0 to 1)
      const rect = domElement.getBoundingClientRect();
      const mouseXNorm = (e.clientX - rect.left) / rect.width;

      // Current view range
      const [viewMin, viewMax] = viewRange.current;
      const currentRange = viewMax - viewMin;

      // Zoom factor
      const zoomFactor = e.deltaY > 0 ? 1.15 : 0.87;
      let newRange = currentRange * zoomFactor;

      // Clamp zoom range (min 5% of full range, max 100%)
      newRange = Math.max(fullRange * 0.05, Math.min(fullRange, newRange));

      // Calculate new bounds centered on mouse position
      const mouseXData = viewMin + mouseXNorm * currentRange;
      const leftRatio = (mouseXData - viewMin) / currentRange;

      let newMin = mouseXData - leftRatio * newRange;
      let newMax = mouseXData + (1 - leftRatio) * newRange;

      // Clamp to data bounds
      if (newMin < xMin) {
        newMin = xMin;
        newMax = xMin + newRange;
      }
      if (newMax > xMax) {
        newMax = xMax;
        newMin = xMax - newRange;
      }

      viewRange.current = [newMin, newMax];
      onXViewRangeChange([newMin, newMax]);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        isDragging.current = true;
        lastX.current = e.clientX;
        domElement.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;

      const [xMin, xMax] = xRangeRef.current;
      const rect = domElement.getBoundingClientRect();
      const dx = e.clientX - lastX.current;
      const dxNorm = dx / rect.width;

      const [viewMin, viewMax] = viewRange.current;
      const currentRange = viewMax - viewMin;
      const shift = -dxNorm * currentRange;

      let newMin = viewMin + shift;
      let newMax = viewMax + shift;

      // Clamp to data bounds
      if (newMin < xMin) {
        newMin = xMin;
        newMax = xMin + currentRange;
      }
      if (newMax > xMax) {
        newMax = xMax;
        newMin = xMax - currentRange;
      }

      viewRange.current = [newMin, newMax];
      onXViewRangeChange([newMin, newMax]);
      lastX.current = e.clientX;
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      domElement.style.cursor = 'default';
    };

    const handleDoubleClick = () => {
      // Reset to full view
      const [xMin, xMax] = xRangeRef.current;
      viewRange.current = [xMin, xMax];
      onXViewRangeChange([xMin, xMax]);
    };

    domElement.addEventListener('wheel', handleWheel, { passive: false });
    domElement.addEventListener('mousedown', handleMouseDown);
    domElement.addEventListener('dblclick', handleDoubleClick);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      domElement.removeEventListener('wheel', handleWheel);
      domElement.removeEventListener('mousedown', handleMouseDown);
      domElement.removeEventListener('dblclick', handleDoubleClick);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [gl, onXViewRangeChange]);

  return null;
}

// ============= Main Scene =============

interface SpectraInteractionControllerProps {
  lines: LineData[];
  onHover: (index: number | null) => void;
  onClick: (index: number, event: MouseEvent) => void;
}

/**
 * Handles mouse hover and click detection for spectrum lines
 * Uses proximity-based detection in screen space
 */
function SpectraInteractionController({ lines, onHover, onClick }: SpectraInteractionControllerProps) {
  const { gl } = useThree();
  const hoveredRef = useRef<number | null>(null);
  const linesRef = useRef(lines);

  // Keep refs updated
  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    const domElement = gl.domElement;

    // Camera margins (must match Canvas camera prop)
    const camLeft = -0.06;
    const camRight = 1.02;
    const camBottom = -0.12;
    const camTop = 1.04;
    const camWidth = camRight - camLeft;
    const camHeight = camTop - camBottom;

    // Find the closest spectrum line to the mouse position
    const findClosestSpectrum = (mouseX: number, mouseY: number): number | null => {
      const rect = domElement.getBoundingClientRect();
      // Convert mouse to normalized screen coordinates [0,1]
      const screenX = (mouseX - rect.left) / rect.width;
      const screenY = 1 - (mouseY - rect.top) / rect.height; // Invert Y (0=bottom, 1=top)

      // Convert screen coordinates to chart/data coordinates
      // Chart coords: camLeft to camRight (X), camBottom to camTop (Y)
      // Data space: [0,1] for both X and Y (line points are normalized)
      const chartX = camLeft + screenX * camWidth;
      const chartY = camBottom + screenY * camHeight;

      let closestIndex: number | null = null;
      let closestDistance = Infinity;
      const threshold = 0.08; // 8% of data height for detection

      // Only check non-original lines (processed spectra)
      for (const line of linesRef.current) {
        if (line.isOriginal) continue;

        // Sample points along the line to find closest
        const points = line.points;
        const nPoints = line.pointCount;

        for (let i = 0; i < nPoints; i++) {
          const px = points[i * 2];  // Line point X in [0,1] data space
          const py = points[i * 2 + 1];  // Line point Y in [0,1] data space

          // Check if point is near the mouse X position
          if (Math.abs(px - chartX) < 0.03) {
            const dist = Math.abs(py - chartY);
            if (dist < closestDistance && dist < threshold) {
              closestDistance = dist;
              closestIndex = line.index;
            }
          }
        }
      }

      return closestIndex;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const closest = findClosestSpectrum(e.clientX, e.clientY);
      if (closest !== hoveredRef.current) {
        hoveredRef.current = closest;
        onHover(closest);
      }
    };

    const handleMouseClick = (e: MouseEvent) => {
      // Don't handle clicks during drag operations
      if (e.detail === 0) return; // Ignore synthetic clicks

      const closest = findClosestSpectrum(e.clientX, e.clientY);
      if (closest !== null) {
        onClick(closest, e);
      }
    };

    const handleMouseLeave = () => {
      if (hoveredRef.current !== null) {
        hoveredRef.current = null;
        onHover(null);
      }
    };

    domElement.addEventListener('mousemove', handleMouseMove);
    domElement.addEventListener('click', handleMouseClick);
    domElement.addEventListener('mouseleave', handleMouseLeave);

    return () => {
      domElement.removeEventListener('mousemove', handleMouseMove);
      domElement.removeEventListener('click', handleMouseClick);
      domElement.removeEventListener('mouseleave', handleMouseLeave);
    };
  }, [gl, onHover, onClick]);

  return null;
}

interface SpectraSceneProps {
  lines: LineData[];
  xRange: [number, number];
  yRange: [number, number];
  xViewRange: [number, number];
  onXViewRangeChange: (range: [number, number]) => void;
  qualityConfig: QualityConfig;
  showGrid: boolean;
  onHover: (index: number | null) => void;
  onClick: (index: number, event: MouseEvent) => void;
  hoveredIdx?: number | null;
}

/**
 * Responsive camera that adapts to container size
 * Fills the container width and adjusts height proportionally
 */
function ResponsiveCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      // Calculate aspect ratio of container
      const aspect = size.width / size.height;

      // Fixed margins in normalized data space
      // These are proportional to the data area [0, 1]
      const marginLeft = 0.06;   // Space for Y-axis labels
      const marginRight = 0.02;  // Minimal right margin
      const marginBottom = 0.12; // Space for X-axis labels
      const marginTop = 0.04;    // Minimal top margin

      // The chart should FILL the container width
      // Data area X: from -marginLeft to 1+marginRight
      // Data area Y: from -marginBottom to 1+marginTop
      const dataWidth = 1 + marginLeft + marginRight;
      const dataHeight = 1 + marginBottom + marginTop;

      // Always fill width, adjust vertical based on aspect ratio
      camera.left = -marginLeft;
      camera.right = 1 + marginRight;

      // Calculate what Y range we need to fill the height while matching aspect
      const requiredYRange = dataWidth / aspect;

      if (requiredYRange >= dataHeight) {
        // Container is taller than needed - extend Y symmetrically
        const extraY = (requiredYRange - dataHeight) / 2;
        camera.top = 1 + marginTop + extraY;
        camera.bottom = -marginBottom - extraY;
      } else {
        // Container is wider than needed - just use the data height
        // (this means we'll have some empty space on sides, but that's rare)
        camera.top = 1 + marginTop;
        camera.bottom = -marginBottom;
      }

      camera.updateProjectionMatrix();
    }
  });

  return null;
}

function SpectraScene({ lines, xRange, yRange, xViewRange, onXViewRangeChange, qualityConfig, showGrid, onHover, onClick, hoveredIdx }: SpectraSceneProps) {
  const { camera } = useThree();

  // Setup orthographic camera on mount
  useLayoutEffect(() => {
    if (camera instanceof THREE.OrthographicCamera) {
      camera.position.set(0.5, 0.5, 5);
      camera.near = 0.1;
      camera.far = 100;
      camera.updateProjectionMatrix();
    }
  }, [camera]);

  return (
    <>
      <ResponsiveCamera />
      <XZoomController xRange={xRange} onXViewRangeChange={onXViewRangeChange} />
      <SpectraInteractionController lines={lines} onHover={onHover} onClick={onClick} />
      <Axes yRange={yRange} xViewRange={xViewRange} showGrid={showGrid} />
      <SpectraLines lines={lines} qualityConfig={qualityConfig} hoveredIdx={hoveredIdx} />
    </>
  );
}

// ============= Fallback Component =============

function WebGLNotSupported() {
  return (
    <div className="flex items-center justify-center h-full text-center p-4">
      <div>
        <div className="text-muted-foreground mb-2">WebGL is not supported on this device</div>
        <div className="text-xs text-muted-foreground">Please use Canvas rendering mode or try a different browser</div>
      </div>
    </div>
  );
}

// ============= Main Component =============

export function SpectraWebGL({
  spectra,
  wavelengths,
  originalSpectra,
  y,
  visibleIndices,
  baseColor = '#3b82f6',
  originalColor = '#888888',
  selectedColor = '#f59e0b',
  pinnedColor = '#ef4444',
  useSelectionContext = true,
  selectedIndices: manualSelectedIndices,
  pinnedIndices: manualPinnedIndices,
  sampleColors,
  onSampleClick,
  onHover,
  className,
  yRange: propYRange,
  isLoading = false,
  quality = 'auto',
  onQualityChange,
  maxSamples = 0,
  showQualityControls = true,
  showGrid = true,
}: SpectraWebGLProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [internalQuality, setInternalQuality] = useState<QualityMode>(quality);

  // Sync internal quality with prop
  useEffect(() => {
    setInternalQuality(quality);
  }, [quality]);

  // Track previous wavelengths to detect actual data changes (not just re-renders)
  const prevWavelengthsRef = useRef<number[] | null>(null);

  // Selection context - get full context for hover/click dispatching
  const selectionCtx = useSelection();
  const { selectedSamples: contextSelectedSamples, pinnedSamples: contextPinnedSamples, hoveredSample: contextHoveredSample } = selectionCtx;

  // Local hovered state is synced to context
  const hoveredSampleIdx = contextHoveredSample;

  // Handle hover - dispatch to SelectionContext and callback
  const handleHover = useCallback((index: number | null) => {
    if (useSelectionContext) {
      selectionCtx.setHovered(index);
    }
    onHover?.(index);
  }, [useSelectionContext, selectionCtx, onHover]);

  // Handle click - dispatch to SelectionContext or use callback
  const handleClick = useCallback((index: number, event: MouseEvent) => {
    if (useSelectionContext) {
      if (event.shiftKey) {
        selectionCtx.select([index], 'add');
      } else if (event.ctrlKey || event.metaKey) {
        selectionCtx.toggle([index]);
      } else {
        // Toggle selection if clicking the same sample
        if (selectionCtx.selectedSamples.has(index) && selectionCtx.selectedSamples.size === 1) {
          selectionCtx.clear();
        } else {
          selectionCtx.select([index], 'replace');
        }
      }
    }
    onSampleClick?.(index, event);
  }, [useSelectionContext, selectionCtx, onSampleClick]);

  // Determine which indices to use
  const selectedIndicesSet = useMemo(() => {
    if (useSelectionContext) return contextSelectedSamples;
    return new Set(manualSelectedIndices ?? []);
  }, [useSelectionContext, contextSelectedSamples, manualSelectedIndices]);

  const pinnedIndicesSet = useMemo(() => {
    if (useSelectionContext) return contextPinnedSamples;
    return new Set(manualPinnedIndices ?? []);
  }, [useSelectionContext, contextPinnedSamples, manualPinnedIndices]);

  // Check WebGL support
  const capabilities = useMemo(() => detectDeviceCapabilities(), []);

  // Determine quality config
  const qualityConfig = useMemo(() => {
    const effectiveQuality = internalQuality === 'auto'
      ? selectAutoQuality(spectra.length, wavelengths.length)
      : internalQuality;
    return QUALITY_CONFIGS[effectiveQuality];
  }, [internalQuality, spectra.length, wavelengths.length]);

  // Effective quality mode for display
  const effectiveQuality = useMemo(() => {
    return internalQuality === 'auto'
      ? selectAutoQuality(spectra.length, wavelengths.length)
      : internalQuality;
  }, [internalQuality, spectra.length, wavelengths.length]);

  // Handle quality change
  const handleQualityChange = useCallback((newQuality: QualityMode) => {
    setInternalQuality(newQuality);
    setShowQualityMenu(false);
    onQualityChange?.(newQuality);
  }, [onQualityChange]);

  // Determine visible indices with optional sampling
  const effectiveVisibleIndices = useMemo(() => {
    let indices = visibleIndices ?? spectra.map((_, i) => i);

    // Apply max samples limit if needed
    if (maxSamples > 0 && indices.length > maxSamples) {
      // Keep selected/pinned samples, sample the rest
      const priorityIndices = new Set<number>();
      selectedIndicesSet.forEach(i => {
        if (indices.includes(i)) priorityIndices.add(i);
      });
      pinnedIndicesSet.forEach(i => {
        if (indices.includes(i)) priorityIndices.add(i);
      });

      const remaining = indices.filter(i => !priorityIndices.has(i));
      const sampleCount = Math.max(0, maxSamples - priorityIndices.size);
      const step = remaining.length / sampleCount;

      const sampledRemaining: number[] = [];
      for (let i = 0; i < sampleCount && i * step < remaining.length; i++) {
        sampledRemaining.push(remaining[Math.floor(i * step)]);
      }

      indices = [...priorityIndices, ...sampledRemaining];
    }

    return indices;
  }, [visibleIndices, spectra, maxSamples, selectedIndicesSet, pinnedIndicesSet]);

  // Calculate data ranges (full data)
  const { xRange, yRange } = useMemo(() => {
    // Guard against empty wavelengths
    const xMin = wavelengths.length > 0 ? Math.min(...wavelengths) : 0;
    const xMax = wavelengths.length > 0 ? Math.max(...wavelengths) : 1;

    let yMin = Infinity;
    let yMax = -Infinity;

    // Include processed spectra
    for (const idx of effectiveVisibleIndices) {
      const spectrum = spectra[idx];
      if (!spectrum) continue;
      for (let j = 0; j < spectrum.length; j++) {
        const v = spectrum[j];
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }

    // Include original spectra if present
    if (originalSpectra) {
      for (const idx of effectiveVisibleIndices) {
        const spectrum = originalSpectra[idx];
        if (!spectrum) continue;
        for (let j = 0; j < spectrum.length; j++) {
          const v = spectrum[j];
          if (v < yMin) yMin = v;
          if (v > yMax) yMax = v;
        }
      }
    }

    // Use prop range if provided
    if (propYRange) {
      yMin = propYRange[0];
      yMax = propYRange[1];
    }

    // Guard against no data (yMin/yMax would be Infinity/-Infinity)
    if (!isFinite(yMin) || !isFinite(yMax) || yMin >= yMax) {
      yMin = 0;
      yMax = 1;
    }

    // Add 5% padding
    const yPadding = (yMax - yMin) * 0.05;
    yMin -= yPadding;
    yMax += yPadding;

    return {
      xRange: [xMin, xMax] as [number, number],
      yRange: [yMin, yMax] as [number, number],
    };
  }, [spectra, originalSpectra, wavelengths, effectiveVisibleIndices, propYRange]);

  // Track if user has zoomed (to avoid resetting their zoom on data updates)
  const userHasZoomedRef = useRef(false);
  // Track if we've done the initial sync
  const hasInitializedRef = useRef(false);

  // X-axis zoom state - always start with xRange (will be synced by useEffect)
  const [xViewRange, setXViewRange] = useState<[number, number]>(xRange);

  // Sync xViewRange with xRange when:
  // 1. First mount with valid data
  // 2. User hasn't zoomed yet (show full range)
  // 3. Wavelengths change (new dataset)
  // 4. xViewRange is invalid or mismatched with xRange
  useEffect(() => {
    const prevWl = prevWavelengthsRef.current;
    const hasWavelengthChange = !prevWl ||
      prevWl.length !== wavelengths.length ||
      Math.abs((prevWl[0] ?? 0) - (wavelengths[0] ?? 0)) > 1 ||
      Math.abs((prevWl[prevWl.length - 1] ?? 0) - (wavelengths[wavelengths.length - 1] ?? 0)) > 1;

    // Check if xViewRange is invalid
    const isXViewRangeInvalid = !isFinite(xViewRange[0]) || !isFinite(xViewRange[1]) ||
      xViewRange[0] >= xViewRange[1];

    // Check if xRange is valid
    const isXRangeValid = isFinite(xRange[0]) && isFinite(xRange[1]) && xRange[0] < xRange[1];

    // Check if xViewRange doesn't match xRange when user hasn't zoomed
    const needsInitialSync = !userHasZoomedRef.current && isXRangeValid &&
      (Math.abs(xViewRange[0] - xRange[0]) > 0.1 || Math.abs(xViewRange[1] - xRange[1]) > 0.1);

    // Force sync on first valid initialization
    const needsFirstSync = !hasInitializedRef.current && isXRangeValid && wavelengths.length > 0;

    if (hasWavelengthChange || isXViewRangeInvalid || needsInitialSync || needsFirstSync) {
      if (isXRangeValid) {
        setXViewRange([xRange[0], xRange[1]]);
        prevWavelengthsRef.current = wavelengths;
        userHasZoomedRef.current = false;
        hasInitializedRef.current = true;
      }
    }
  }, [wavelengths, xRange, xViewRange]);

  // Target range for coloring
  const { yMin: yTargetMin, yMax: yTargetMax } = useMemo(() => {
    if (!y || y.length === 0) return { yMin: 0, yMax: 1 };
    return { yMin: Math.min(...y), yMax: Math.max(...y) };
  }, [y]);

  // Prepare line data with decimation
  // IMPORTANT: hoveredSampleIdx is NOT in deps to avoid expensive recomputation on every hover
  // Hover highlighting is handled separately in the render phase
  const lines = useMemo<LineData[]>(() => {
    const baseCol = parseColor(baseColor);
    const origCol = parseColor(originalColor);
    const selectedCol = parseColor(selectedColor);
    const pinnedCol = parseColor(pinnedColor);

    const result: LineData[] = [];
    const maxPoints = qualityConfig.maxPointsPerSpectrum;

    // Add processed spectra
    for (const idx of effectiveVisibleIndices) {
      const spectrum = spectra[idx];
      if (!spectrum) continue;

      const isSelected = selectedIndicesSet.has(idx);
      const isPinned = pinnedIndicesSet.has(idx);

      // Calculate color - selected/pinned only, hover is handled separately
      let color: THREE.Color;
      if (isPinned) {
        color = pinnedCol;
      } else if (isSelected) {
        color = selectedCol;
      } else if (sampleColors && sampleColors[idx]) {
        color = parseColor(sampleColors[idx]);
      } else if (y && y[idx] !== undefined) {
        color = getTargetColor(y[idx], yTargetMin, yTargetMax);
      } else {
        color = baseCol;
      }

      // Decimate points using LTTB algorithm - normalizes to [0,1] based on xViewRange
      const points = decimatePoints(
        wavelengths,
        spectrum,
        maxPoints,
        xViewRange,
        yRange
      );

      if (points.length >= 4) { // At least 2 points
        result.push({
          points,
          color,
          index: idx,
          isSelected,
          isPinned,
          isOriginal: false,
          pointCount: points.length / 2,
        });
      }
    }

    // Add original spectra if provided
    if (originalSpectra) {
      for (const idx of effectiveVisibleIndices) {
        const spectrum = originalSpectra[idx];
        if (!spectrum) continue;

        const isSelected = selectedIndicesSet.has(idx);
        const isPinned = pinnedIndicesSet.has(idx);

        // Decimate points
        const points = decimatePoints(
          wavelengths,
          spectrum,
          maxPoints,
          xViewRange,
          yRange
        );

        if (points.length >= 4) {
          result.push({
            points,
            color: origCol,
            index: idx,
            isSelected,
            isPinned,
            isOriginal: true,
            pointCount: points.length / 2,
          });
        }
      }
    }

    return result;
  }, [
    spectra, originalSpectra, wavelengths, effectiveVisibleIndices,
    selectedIndicesSet, pinnedIndicesSet, y, yTargetMin, yTargetMax,
    baseColor, originalColor, selectedColor, pinnedColor, sampleColors,
    xViewRange, yRange, qualityConfig.maxPointsPerSpectrum,
  ]);

  // Debounce ref for zoom updates
  const zoomTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRangeRef = useRef<[number, number] | null>(null);

  // Handle X view range change with debouncing to prevent rapid re-renders
  const handleXViewRangeChange = useCallback((range: [number, number]) => {
    // Store the pending range
    pendingRangeRef.current = range;

    // Clear any existing timeout
    if (zoomTimeoutRef.current) {
      clearTimeout(zoomTimeoutRef.current);
    }

    // Debounce the actual state update (16ms = ~60fps)
    zoomTimeoutRef.current = setTimeout(() => {
      const finalRange = pendingRangeRef.current;
      if (finalRange) {
        setXViewRange(finalRange);
        // Check if this is a reset to full range (from double-click)
        const isFullRange = Math.abs(finalRange[0] - xRange[0]) < 0.1 && Math.abs(finalRange[1] - xRange[1]) < 0.1;
        if (isFullRange) {
          userHasZoomedRef.current = false; // Reset on full view
        } else {
          userHasZoomedRef.current = true; // Mark that user has zoomed
        }
      }
    }, 16);
  }, [xRange]);

  // Cleanup zoom timeout on unmount
  useEffect(() => {
    return () => {
      if (zoomTimeoutRef.current) {
        clearTimeout(zoomTimeoutRef.current);
      }
    };
  }, []);

  // Compute zoom level for display
  const zoomLevel = useMemo(() => {
    const fullRange = xRange[1] - xRange[0];
    const viewedRange = xViewRange[1] - xViewRange[0];
    return fullRange / viewedRange;
  }, [xRange, xViewRange]);

  // WebGL not supported fallback
  if (!capabilities.webglSupported) {
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <WebGLNotSupported />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {isLoading && (
        <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10">
          <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      <Canvas
        orthographic
        camera={{
          position: [0.5, 0.5, 5],
          near: 0.1,
          far: 100,
          // Initial values - ResponsiveCamera will adjust these on each frame
          left: -0.06,
          right: 1.02,
          top: 1.04,
          bottom: -0.12,
        }}
        gl={{ antialias: qualityConfig.antialias, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, qualityConfig.maxDpr)}
        style={{ background: 'transparent' }}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
      >
        <SpectraScene
          lines={lines}
          xRange={xRange}
          yRange={yRange}
          xViewRange={xViewRange}
          onXViewRangeChange={handleXViewRangeChange}
          qualityConfig={qualityConfig}
          showGrid={showGrid ?? true}
          onHover={handleHover}
          onClick={handleClick}
          hoveredIdx={hoveredSampleIdx}
        />
      </Canvas>

      {/* Original spectra legend - top left */}
      {originalSpectra && originalSpectra.length > 0 && (
        <div className="absolute top-2 left-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-1 rounded flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 bg-primary" />
            Processed
          </span>
          <span className="flex items-center gap-1">
            <span className="w-4 h-0.5 border-t border-dashed" style={{ borderColor: originalColor }} />
            Original
          </span>
        </div>
      )}

      {/* Controls hint - bottom left */}
      <div className="absolute bottom-2 left-2 text-[10px] text-muted-foreground">
        Scroll to zoom X • Drag to pan • Double-click to reset
      </div>

      {/* Zoom indicator - bottom right */}
      {zoomLevel > 1.05 && (
        <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground bg-background/80 px-2 py-0.5 rounded">
          {zoomLevel.toFixed(1)}× zoom
        </div>
      )}

      {/* Quality control - top right (positioned below WebGL pill shown in parent) */}
      {showQualityControls && (
        <div className="absolute top-9 right-2 flex flex-col items-end gap-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-muted-foreground bg-background/80 px-1 rounded">
              {effectiveVisibleIndices.length} spectra
            </span>
            <div className="relative">
              <button
                onClick={() => setShowQualityMenu(!showQualityMenu)}
                className="text-[10px] text-muted-foreground bg-background/80 hover:bg-background px-2 py-0.5 rounded border border-transparent hover:border-border transition-colors cursor-pointer"
              >
                {internalQuality === 'auto' ? `auto (${effectiveQuality})` : effectiveQuality}
              </button>
              {showQualityMenu && (
                <div className="absolute top-full right-0 mt-1 bg-background border rounded shadow-lg py-1 min-w-[80px] z-20">
                  {(['auto', 'low', 'medium', 'high'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => handleQualityChange(q)}
                      className={cn(
                        'w-full text-left px-3 py-1 text-[11px] hover:bg-muted transition-colors',
                        internalQuality === q && 'bg-muted font-medium'
                      )}
                    >
                      {q}
                      {q === 'auto' && ` (${selectAutoQuality(spectra.length, wavelengths.length)})`}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Click outside to close menu */}
      {showQualityMenu && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setShowQualityMenu(false)}
        />
      )}
    </div>
  );
}

export default SpectraWebGL;

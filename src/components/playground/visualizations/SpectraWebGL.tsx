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

import { useRef, useMemo, useCallback, useEffect, useState, memo } from 'react';
import { Canvas } from '@react-three/fiber';
import { cn } from '@/lib/utils';
import { useSelection } from '@/context/useSelection';
import { detectDeviceCapabilities } from '@/lib/playground/renderOptimizer';
import { SELECTION_COLORS } from './chartConfig';
import { SpectraWebGLHoverTooltip } from './SpectraWebGLHoverTooltip';
import { SpectraWebGLQualityControl } from './SpectraWebGLQualityControl';
import { SpectraWebGLScene } from './SpectraWebGLScene';
import { SpectraWebGLStatusOverlays } from './SpectraWebGLStatusOverlays';
import { SpectraWebGLUnsupportedFallback } from './SpectraWebGLUnsupportedFallback';
import {
  computeSpectraDecimation,
  type SpectraDecimationResult,
} from './spectraWebGLGeometry';
import { buildSpectraWebGLLines } from './spectraWebGLLines';
import { SPECTRA_WEBGL_CAMERA_BOUNDS } from './spectraWebGLHitTesting';
import {
  computeEffectiveSpectraVisibleIndices,
  computeSpectraTargetValueRange,
  computeSpectraWebGLRanges,
  computeSpectraZoomLevel,
  shouldSyncSpectraXViewRange,
} from './spectraWebGLViewport';
import {
  resolveSpectraQualityState,
  type QualityMode,
} from './spectraWebGLQuality';

// ============= Types =============

export type { QualityMode } from './spectraWebGLQuality';

export interface SpectraWebGLProps {
  /** Spectra data (samples × wavelengths) */
  spectra: number[][];
  /** Wavelength values */
  wavelengths: number[];
  /** Optional second set of spectra (for "both" view - original) */
  originalSpectra?: number[][];
  /** Target values for coloring */
  y?: number[];
  /** Sample IDs for display in tooltip */
  sampleIds?: string[];
  /** Fold labels for display in tooltip */
  folds?: { fold_labels?: number[] };
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
  /** Whether hover highlighting is enabled (default: true) */
  enableHover?: boolean;
  /** Whether to show tooltip on hover (default: true) */
  showHoverTooltip?: boolean;
  /** Whether to apply selection highlight coloring (default: true). Set to false in selected_only mode */
  applySelectionColoring?: boolean;
  /** Aggregated statistics for rendering min/max area and median */
  aggregatedStats?: {
    mean: number[];
    median: number[];
    min: number[];
    max: number[];
    std: number[];
    quantileLower: number[];
    quantileUpper: number[];
  };
  /** Grouped statistics for rendering quartile areas per group */
  groupedStats?: Map<string | number, {
    mean: number[];
    median: number[];
    min: number[];
    max: number[];
    std: number[];
    quantileLower: number[];
    quantileUpper: number[];
  }>;
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
  /** Opacity for non-selected lines when there's a selection (0-1) */
  unselectedOpacity?: number;
  /**
   * X-axis label. When omitted, defaults to "Wavelength (nm)". Pass a value
   * derived from the dataset's header_unit so cm⁻¹ datasets render
   * "Wavenumber (cm⁻¹)" instead of being mislabelled as nm.
   */
  xLabel?: string;
}

// ============= Main Scene =============

// ============= Main Component =============

function SpectraWebGLInner({
  spectra,
  wavelengths,
  originalSpectra,
  y,
  sampleIds,
  folds,
  visibleIndices,
  baseColor = '#3b82f6',
  originalColor,
  selectedColor, // Optional - defaults to SELECTION_COLORS.selected
  pinnedColor = SELECTION_COLORS.pinned, // Gold
  useSelectionContext = true,
  selectedIndices: manualSelectedIndices,
  pinnedIndices: manualPinnedIndices,
  sampleColors,
  onSampleClick,
  onHover,
  enableHover = true,
  showHoverTooltip = true,
  applySelectionColoring = true,
  aggregatedStats,
  groupedStats,
  className,
  yRange: propYRange,
  isLoading = false,
  quality = 'auto',
  onQualityChange,
  maxSamples = 0,
  showQualityControls = true,
  showGrid = true,
  unselectedOpacity: propUnselectedOpacity,
  xLabel,
}: SpectraWebGLProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [internalQuality, setInternalQuality] = useState<QualityMode>(quality);
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);

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

  // Handle hover - dispatch to SelectionContext and callback (only if hover is enabled)
  const handleHover = useCallback((index: number | null, event?: MouseEvent) => {
    if (!enableHover) {
      // Clear any existing hover when disabled
      if (useSelectionContext && selectionCtx.hoveredSample !== null) {
        selectionCtx.setHovered(null);
      }
      setMousePosition(null);
      return;
    }
    if (useSelectionContext) {
      selectionCtx.setHovered(index);
    }
    // Track mouse position for tooltip
    if (index !== null && event && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      setMousePosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    } else if (index === null) {
      setMousePosition(null);
    }
    onHover?.(index);
  }, [useSelectionContext, selectionCtx, onHover, enableHover]);

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

  // Compute effective unselected opacity: only dim when there's an active selection
  const hasSelection = selectedIndicesSet.size > 0;
  const effectiveUnselectedOpacity = hasSelection && applySelectionColoring
    ? propUnselectedOpacity
    : undefined; // undefined = use default full opacity

  // Check WebGL support
  const capabilities = useMemo(() => detectDeviceCapabilities(), []);

  // Normalize quality props for render config and menu display.
  const { autoQuality, effectiveQuality, qualityConfig } = useMemo(() => resolveSpectraQualityState({
    quality: internalQuality,
    spectraCount: spectra.length,
    wavelengthCount: wavelengths.length,
  }), [internalQuality, spectra.length, wavelengths.length]);

  // Handle quality change
  const handleQualityChange = useCallback((newQuality: QualityMode) => {
    setInternalQuality(newQuality);
    setShowQualityMenu(false);
    onQualityChange?.(newQuality);
  }, [onQualityChange]);

  // Determine visible indices with optional sampling
  const effectiveVisibleIndices = useMemo(() => computeEffectiveSpectraVisibleIndices({
    visibleIndices,
    spectraCount: spectra.length,
    maxSamples,
    selectedIndices: selectedIndicesSet,
    pinnedIndices: pinnedIndicesSet,
  }), [visibleIndices, spectra.length, maxSamples, selectedIndicesSet, pinnedIndicesSet]);

  // Calculate data ranges (full data)
  const { xRange, yRange } = useMemo(() => computeSpectraWebGLRanges({
    spectra,
    originalSpectra,
    wavelengths,
    visibleIndices: effectiveVisibleIndices,
    propYRange,
    aggregatedStats,
    groupedStats,
  }), [spectra, originalSpectra, wavelengths, effectiveVisibleIndices, propYRange, aggregatedStats, groupedStats]);

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
    if (shouldSyncSpectraXViewRange({
      previousWavelengths: prevWavelengthsRef.current,
      wavelengths,
      xRange,
      xViewRange,
      userHasZoomed: userHasZoomedRef.current,
      hasInitialized: hasInitializedRef.current,
    })) {
      setXViewRange([xRange[0], xRange[1]]);
      prevWavelengthsRef.current = wavelengths;
      userHasZoomedRef.current = false;
      hasInitializedRef.current = true;
    }
  }, [wavelengths, xRange, xViewRange]);

  // Target range for coloring
  const { yMin: yTargetMin, yMax: yTargetMax } = useMemo(() => computeSpectraTargetValueRange(y), [y]);

  // ============= Decimation computation (synchronous) =============
  // LTTB decimation runs on the main thread via useMemo.
  const decimation = useMemo<SpectraDecimationResult>(() =>
    computeSpectraDecimation(spectra, originalSpectra ?? null, wavelengths,
      effectiveVisibleIndices, xViewRange, yRange, qualityConfig.maxPointsPerSpectrum),
    [spectra, originalSpectra, wavelengths, effectiveVisibleIndices, xViewRange, yRange, qualityConfig.maxPointsPerSpectrum]
  );

  // Build LineData from decimation result + color assignments (cheap, runs on main thread)
  // IMPORTANT: Selection state (selectedIndicesSet, pinnedIndicesSet) is NOT in deps —
  // SpectraLines sorts lines by selection state on each render without rebuilding LineData.
  // This avoids recreating thousands of THREE.Color + Float32Array objects on every selection toggle.
  const lines = useMemo(
    () => buildSpectraWebGLLines({
      decimation,
      y,
      yTargetMin,
      yTargetMax,
      baseColor,
      originalColor,
      sampleColors,
    }),
    [decimation, y, yTargetMin, yTargetMax, baseColor, originalColor, sampleColors]
  );

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
  const zoomLevel = useMemo(() => computeSpectraZoomLevel(xRange, xViewRange), [xRange, xViewRange]);

  // WebGL not supported fallback
  if (!capabilities.webglSupported) {
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <SpectraWebGLUnsupportedFallback />
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Canvas
        orthographic
        camera={{
          position: [0.5, 0.5, 5],
          near: 0.1,
          far: 100,
          // Initial values - ResponsiveCamera will adjust these on each frame
          left: SPECTRA_WEBGL_CAMERA_BOUNDS.left,
          right: SPECTRA_WEBGL_CAMERA_BOUNDS.right,
          top: SPECTRA_WEBGL_CAMERA_BOUNDS.top,
          bottom: SPECTRA_WEBGL_CAMERA_BOUNDS.bottom,
        }}
        gl={{ antialias: qualityConfig.antialias, alpha: true }}
        dpr={Math.min(window.devicePixelRatio, qualityConfig.maxDpr)}
        style={{ background: 'transparent' }}
        resize={{ scroll: false, debounce: { scroll: 50, resize: 50 } }}
      >
        <SpectraWebGLScene
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
          aggregatedStats={aggregatedStats ? {
            wavelengths,
            ...aggregatedStats,
          } : undefined}
          groupedStats={groupedStats ? {
            wavelengths,
            groups: groupedStats,
            colors: sampleColors ?? [],
          } : undefined}
          unselectedOpacity={effectiveUnselectedOpacity}
          selectedIndices={selectedIndicesSet}
          pinnedIndices={pinnedIndicesSet}
          xLabel={xLabel}
        />
      </Canvas>

      <SpectraWebGLStatusOverlays
        isLoading={isLoading}
        showOriginalLegend={Boolean(originalSpectra && originalSpectra.length > 0)}
        originalColor={originalColor}
        zoomLevel={zoomLevel}
      />

      <SpectraWebGLQualityControl
        showQualityControls={showQualityControls}
        spectraCount={effectiveVisibleIndices.length}
        internalQuality={internalQuality}
        effectiveQuality={effectiveQuality}
        autoQuality={autoQuality}
        showQualityMenu={showQualityMenu}
        onToggleQualityMenu={() => setShowQualityMenu(!showQualityMenu)}
        onCloseQualityMenu={() => setShowQualityMenu(false)}
        onQualityChange={handleQualityChange}
      />

      <SpectraWebGLHoverTooltip
        showHoverTooltip={showHoverTooltip}
        enableHover={enableHover}
        hoveredSampleIdx={hoveredSampleIdx}
        mousePosition={mousePosition}
        containerWidth={containerRef.current?.clientWidth ?? 0}
        sampleIds={sampleIds}
        y={y}
        foldLabels={folds?.fold_labels}
      />
    </div>
  );
}

/**
 * Memoized export. SpectraWebGL's heavy LTTB decimation + LineData build run in
 * useMemo, but without React.memo every parent re-render (hover/selection/config
 * change in SpectraChart) reconciles the whole WebGL subtree. memo() skips that
 * work when the (mostly stable/memoized) props passed by SpectraChart are unchanged.
 */
export const SpectraWebGL = memo(SpectraWebGLInner);

export default SpectraWebGL;

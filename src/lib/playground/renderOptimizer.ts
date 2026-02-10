/**
 * Render Optimizer - Auto-optimization system for Playground charts
 *
 * Provides intelligent selection of rendering modes based on:
 * - Data complexity (samples × wavelengths)
 * - Device capabilities (WebGL support, GPU performance hints)
 * - User preferences (override storage)
 *
 * Phase 6: Performance & Polish
 */

// ============= Types =============

export type RenderMode = 'auto' | 'canvas' | 'webgl' | 'webgl_aggregated';

export interface DeviceCapabilities {
  /** Whether WebGL is supported */
  webglSupported: boolean;
  /** WebGL version (1 or 2) */
  webglVersion: 1 | 2 | null;
  /** Max texture size */
  maxTextureSize: number;
  /** Estimated device performance score (0-1) */
  performanceScore: number;
  /** Whether running on mobile */
  isMobile: boolean;
  /** GPU vendor hint */
  gpuVendor: string | null;
  /** GPU renderer hint */
  gpuRenderer: string | null;
}

export interface RenderModeRecommendation {
  /** Recommended render mode */
  mode: RenderMode;
  /** Reason for recommendation */
  reason: string;
  /** Whether aggregation should be enabled */
  shouldAggregate: boolean;
  /** Suggested aggregation threshold */
  aggregationThreshold: number;
  /** Confidence level (0-1) */
  confidence: number;
}

export interface OptimizationConfig {
  /** Complexity threshold for switching to WebGL */
  canvasComplexityLimit: number;
  /** Complexity threshold for switching to aggregated WebGL */
  webglComplexityLimit: number;
  /** Default aggregation threshold (sample count) */
  defaultAggregationThreshold: number;
  /** Enable automatic mode switching */
  autoOptimize: boolean;
}

// ============= Constants =============

const STORAGE_KEY = 'playground-render-preferences';

const DEFAULT_CONFIG: OptimizationConfig = {
  canvasComplexityLimit: 1,           // WebGL is the default for any dataset (>20 samples); Canvas only used when forced
  webglComplexityLimit: 500_000,      // ~5000 samples × 100 wavelengths
  defaultAggregationThreshold: 200,   // Switch to aggregation above this
  autoOptimize: true,
};

// Performance budgets from spec
const PERFORMANCE_BUDGETS = {
  initialLoad: 2000,       // < 2s first chart visible
  pipelineExecution: 500,  // < 500ms for 1k samples, 3 operators
  selectionResponse: 50,   // < 50ms cross-chart highlight
  targetFrameRate: 60,     // 60fps for WebGL at 10k samples
  maxMemoryMB: 500,        // < 500MB for 10k × 2k matrix + UI
};

// ============= Device Detection =============

let cachedCapabilities: DeviceCapabilities | null = null;

/**
 * Detect device capabilities for rendering optimization
 */
export function detectDeviceCapabilities(): DeviceCapabilities {
  if (cachedCapabilities) {
    return cachedCapabilities;
  }

  const capabilities: DeviceCapabilities = {
    webglSupported: false,
    webglVersion: null,
    maxTextureSize: 2048,
    performanceScore: 0.5,
    isMobile: false,
    gpuVendor: null,
    gpuRenderer: null,
  };

  // Detect mobile
  capabilities.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

  // Try to create a WebGL context
  try {
    const canvas = document.createElement('canvas');

    // Try WebGL2 first
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = canvas.getContext('webgl2');
    if (gl) {
      capabilities.webglSupported = true;
      capabilities.webglVersion = 2;
    } else {
      // Fall back to WebGL1
      gl = canvas.getContext('webgl');
      if (gl) {
        capabilities.webglSupported = true;
        capabilities.webglVersion = 1;
      }
    }

    if (gl) {
      // Get max texture size
      capabilities.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);

      // Get GPU info using standard WebGL parameters
      // Note: WEBGL_debug_renderer_info is deprecated in Firefox and causes significant delays
      try {
        capabilities.gpuRenderer = gl.getParameter(gl.RENDERER);
        capabilities.gpuVendor = gl.getParameter(gl.VENDOR);
      } catch {
        // Ignore errors - GPU info is optional
      }

      // Estimate performance score based on various factors
      let score = 0.5;

      // Texture size hints at GPU capability
      if (capabilities.maxTextureSize >= 16384) score += 0.2;
      else if (capabilities.maxTextureSize >= 8192) score += 0.1;
      else if (capabilities.maxTextureSize < 4096) score -= 0.1;

      // WebGL2 is generally better
      if (capabilities.webglVersion === 2) score += 0.1;

      // Mobile devices typically have lower performance
      if (capabilities.isMobile) score -= 0.2;

      // GPU vendor hints
      const renderer = capabilities.gpuRenderer?.toLowerCase() ?? '';
      if (renderer.includes('nvidia') || renderer.includes('amd') || renderer.includes('radeon')) {
        score += 0.1;
      } else if (renderer.includes('intel')) {
        // Intel integrated GPUs are mixed
        if (renderer.includes('iris')) score += 0.05;
        else score -= 0.05;
      } else if (renderer.includes('mali') || renderer.includes('adreno') || renderer.includes('powervr')) {
        // Mobile GPUs
        score -= 0.1;
      }

      capabilities.performanceScore = Math.max(0, Math.min(1, score));

      // Note: We no longer call WEBGL_lose_context as it's deprecated in Firefox
      // Modern browsers handle context cleanup automatically when the canvas goes out of scope
    }
  } catch {
    // WebGL not available
    console.warn('WebGL detection failed');
  }

  cachedCapabilities = capabilities;
  return capabilities;
}

// ============= Complexity Calculation =============

/**
 * Calculate data complexity score
 */
export function calculateComplexity(
  nSamples: number,
  nWavelengths: number,
  options?: {
    hasOverlay?: boolean;      // Showing original + processed
    has3DView?: boolean;       // 3D scatter enabled
    selectionActive?: boolean; // Selection highlighting active
  }
): number {
  let complexity = nSamples * nWavelengths;

  // Modifiers
  if (options?.hasOverlay) complexity *= 1.5;
  if (options?.has3DView) complexity *= 1.3;
  if (options?.selectionActive) complexity *= 1.1;

  return complexity;
}

// ============= Render Mode Selection =============

/**
 * Get recommended render mode based on complexity and device
 */
export function recommendRenderMode(
  nSamples: number,
  nWavelengths: number,
  options?: {
    hasOverlay?: boolean;
    has3DView?: boolean;
    selectionActive?: boolean;
    forceMode?: RenderMode;
    config?: Partial<OptimizationConfig>;
  }
): RenderModeRecommendation {
  const config = { ...DEFAULT_CONFIG, ...options?.config };
  const capabilities = detectDeviceCapabilities();

  // Honor forced mode if specified
  if (options?.forceMode) {
    return {
      mode: options.forceMode,
      reason: 'User override',
      shouldAggregate: options.forceMode === 'webgl_aggregated',
      aggregationThreshold: config.defaultAggregationThreshold,
      confidence: 1,
    };
  }

  const complexity = calculateComplexity(nSamples, nWavelengths, options);
  const adjustedComplexity = complexity / capabilities.performanceScore;

  // Determine aggregation
  const shouldAggregate = nSamples > config.defaultAggregationThreshold;
  const aggregationThreshold = capabilities.isMobile
    ? Math.floor(config.defaultAggregationThreshold * 0.5)
    : config.defaultAggregationThreshold;

  // WebGL not supported - always use canvas
  if (!capabilities.webglSupported) {
    return {
      mode: 'canvas',
      reason: 'WebGL not supported on this device',
      shouldAggregate,
      aggregationThreshold,
      confidence: 1,
    };
  }

  // Low complexity - canvas is fine
  if (adjustedComplexity < config.canvasComplexityLimit) {
    return {
      mode: 'canvas',
      reason: `Low complexity (${Math.round(complexity / 1000)}k) - Canvas is efficient`,
      shouldAggregate: false,
      aggregationThreshold,
      confidence: 0.9,
    };
  }

  // Medium complexity - use WebGL
  if (adjustedComplexity < config.webglComplexityLimit) {
    return {
      mode: 'webgl',
      reason: `Medium complexity (${Math.round(complexity / 1000)}k) - WebGL provides better performance`,
      shouldAggregate,
      aggregationThreshold,
      confidence: 0.85,
    };
  }

  // High complexity - use WebGL with aggregation
  return {
    mode: 'webgl_aggregated',
    reason: `High complexity (${Math.round(complexity / 1000)}k) - Aggregation required for smooth performance`,
    shouldAggregate: true,
    aggregationThreshold: Math.min(aggregationThreshold, 100), // Force lower threshold
    confidence: 0.8,
  };
}

// ============= User Preferences =============

export interface RenderPreferences {
  /** User-selected render mode override (null = auto) */
  forceMode: RenderMode | null;
  /** User-adjusted aggregation threshold */
  aggregationThreshold: number | null;
  /** Whether to show performance warnings */
  showPerformanceWarnings: boolean;
  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Load user render preferences from storage
 */
export function loadRenderPreferences(): RenderPreferences | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.warn('Failed to load render preferences:', e);
  }
  return null;
}

/**
 * Save user render preferences to storage
 */
export function saveRenderPreferences(prefs: Partial<RenderPreferences>): void {
  try {
    const existing = loadRenderPreferences();
    const updated: RenderPreferences = {
      forceMode: null,
      aggregationThreshold: null,
      showPerformanceWarnings: true,
      ...existing,
      ...prefs,
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Failed to save render preferences:', e);
  }
}

/**
 * Clear user render preferences
 */
export function clearRenderPreferences(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Failed to clear render preferences:', e);
  }
}

// ============= Performance Monitoring =============

export interface PerformanceMetrics {
  /** Average frame time in ms */
  avgFrameTime: number;
  /** Current FPS */
  fps: number;
  /** Memory usage estimate (if available) */
  memoryMB: number | null;
  /** Last render duration in ms */
  lastRenderTime: number;
  /** Sample count */
  timestamp: number;
}

/**
 * Create a performance monitor for charts
 */
export function createPerformanceMonitor() {
  let frameCount = 0;
  let lastFrameTime = performance.now();
  let frameTimes: number[] = [];
  const maxFrameSamples = 60;

  return {
    /** Record a frame */
    recordFrame() {
      const now = performance.now();
      const frameTime = now - lastFrameTime;
      lastFrameTime = now;

      frameTimes.push(frameTime);
      if (frameTimes.length > maxFrameSamples) {
        frameTimes.shift();
      }
      frameCount++;
    },

    /** Get current metrics */
    getMetrics(): PerformanceMetrics {
      const avgFrameTime = frameTimes.length > 0
        ? frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
        : 16.67;

      // Try to get memory info
      let memoryMB: number | null = null;
      if ('memory' in performance) {
        const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
        if (memory?.usedJSHeapSize) {
          memoryMB = Math.round(memory.usedJSHeapSize / (1024 * 1024));
        }
      }

      return {
        avgFrameTime,
        fps: 1000 / avgFrameTime,
        memoryMB,
        lastRenderTime: frameTimes[frameTimes.length - 1] ?? 0,
        timestamp: performance.now(),
      };
    },

    /** Check if performance is below budget */
    isBelowBudget(): boolean {
      const metrics = this.getMetrics();
      return metrics.fps < PERFORMANCE_BUDGETS.targetFrameRate * 0.8; // 20% margin
    },

    /** Reset monitor */
    reset() {
      frameCount = 0;
      frameTimes = [];
      lastFrameTime = performance.now();
    },
  };
}

// ============= React Hook =============

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

export interface UseRenderOptimizerOptions {
  nSamples: number;
  nWavelengths: number;
  hasOverlay?: boolean;
  has3DView?: boolean;
}

export interface UseRenderOptimizerResult {
  /** Current render mode */
  renderMode: RenderMode;
  /** Whether aggregation is recommended */
  shouldAggregate: boolean;
  /** Current aggregation threshold */
  aggregationThreshold: number;
  /** Device capabilities */
  capabilities: DeviceCapabilities;
  /** Whether WebGL is available */
  webglAvailable: boolean;
  /** Recommendation details */
  recommendation: RenderModeRecommendation;
  /** Override render mode */
  setForceMode: (mode: RenderMode | null) => void;
  /** Current force mode (null = auto) */
  forceMode: RenderMode | null;
  /** Performance monitor */
  monitor: ReturnType<typeof createPerformanceMonitor>;
}

/**
 * React hook for render optimization
 */
export function useRenderOptimizer(options: UseRenderOptimizerOptions): UseRenderOptimizerResult {
  const { nSamples, nWavelengths, hasOverlay, has3DView } = options;

  // Load saved preferences
  const [forceMode, setForceModeState] = useState<RenderMode | null>(() => {
    const prefs = loadRenderPreferences();
    return prefs?.forceMode ?? null;
  });

  // Device capabilities (computed once)
  const capabilities = useMemo(() => detectDeviceCapabilities(), []);

  // Performance monitor - use useRef for guaranteed stability across renders
  const monitorRef = useRef(createPerformanceMonitor());
  const monitor = monitorRef.current;

  // Get recommendation
  const recommendation = useMemo(() => {
    return recommendRenderMode(nSamples, nWavelengths, {
      hasOverlay,
      has3DView,
      forceMode: forceMode ?? undefined,
    });
  }, [nSamples, nWavelengths, hasOverlay, has3DView, forceMode]);

  // Save force mode on change
  const setForceMode = useCallback((mode: RenderMode | null) => {
    setForceModeState(mode);
    saveRenderPreferences({ forceMode: mode });
  }, []);

  // Monitor performance and warn if below budget
  useEffect(() => {
    // Only monitor in WebGL mode
    if (recommendation.mode === 'canvas') return;

    const checkInterval = setInterval(() => {
      if (monitor.isBelowBudget()) {
        const prefs = loadRenderPreferences();
        if (prefs?.showPerformanceWarnings !== false) {
          console.warn(
            '[RenderOptimizer] Performance below budget:',
            monitor.getMetrics()
          );
        }
      }
    }, 5000);

    return () => clearInterval(checkInterval);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- monitor is stable via useRef
  }, [recommendation.mode]);

  return {
    renderMode: recommendation.mode,
    shouldAggregate: recommendation.shouldAggregate,
    aggregationThreshold: recommendation.aggregationThreshold,
    capabilities,
    webglAvailable: capabilities.webglSupported,
    recommendation,
    setForceMode,
    forceMode,
    monitor,
  };
}

// ============= Exports =============

export {
  PERFORMANCE_BUDGETS,
  DEFAULT_CONFIG,
};

/**
 * Performance Baseline Testing Utility
 *
 * Provides functions to measure and document performance baselines for the Playground.
 * Use from developer console: window.runPerformanceBaselines()
 *
 * Phase 10: Polish & Performance
 */

import { PERFORMANCE_BUDGETS, createPerformanceMonitor, detectDeviceCapabilities } from './renderOptimizer';
import { createLogger } from "@/lib/logger";

const logger = createLogger("PerformanceBaselines");

// ============= Types =============

export interface BaselineResult {
  metric: string;
  value: number;
  unit: string;
  target: number;
  status: 'pass' | 'warning' | 'fail';
  details?: string;
}

export interface BaselineReport {
  timestamp: string;
  device: {
    userAgent: string;
    webglVersion: number | null;
    gpuRenderer: string | null;
    performanceScore: number;
    isMobile: boolean;
  };
  results: BaselineResult[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
    score: number;
  };
}

// ============= Baseline Targets =============

export const BASELINE_TARGETS = {
  // Initial render times
  initialRender500: { target: 500, unit: 'ms', description: 'Initial render (500 samples)' },
  initialRender5000: { target: 2000, unit: 'ms', description: 'Initial render (5000 samples)' },

  // Interaction responsiveness
  selectionResponse: { target: 100, unit: 'ms', description: 'Selection highlight propagation' },
  chartZoomPan: { target: 16.67, unit: 'ms', description: 'Chart zoom/pan (60fps)' },
  webglToggle: { target: 200, unit: 'ms', description: 'WebGL/Canvas mode switch' },

  // Memory
  memoryUsage: { target: 500, unit: 'MB', description: 'JS heap memory usage' },

  // Frame rate
  frameRate: { target: 60, unit: 'fps', description: 'Target frame rate' },
} as const;

// ============= Measurement Utilities =============

/**
 * Measure the time to execute a function
 */
export async function measureTime<T>(fn: () => T | Promise<T>): Promise<{ result: T; durationMs: number }> {
  const start = performance.now();
  const result = await fn();
  const durationMs = performance.now() - start;
  return { result, durationMs };
}

/**
 * Measure frame rate over a period
 */
export function measureFrameRate(durationMs: number = 1000): Promise<number> {
  return new Promise((resolve) => {
    let frameCount = 0;
    const startTime = performance.now();

    function countFrame() {
      frameCount++;
      if (performance.now() - startTime < durationMs) {
        requestAnimationFrame(countFrame);
      } else {
        const elapsed = performance.now() - startTime;
        resolve((frameCount / elapsed) * 1000);
      }
    }

    requestAnimationFrame(countFrame);
  });
}

/**
 * Get current memory usage (if available)
 */
export function getMemoryUsageMB(): number | null {
  if ('memory' in performance) {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
    if (memory?.usedJSHeapSize) {
      return Math.round(memory.usedJSHeapSize / (1024 * 1024));
    }
  }
  return null;
}

/**
 * Wait for next animation frame
 */
export function nextFrame(): Promise<number> {
  return new Promise(requestAnimationFrame);
}

/**
 * Wait for idle period
 */
export function whenIdle(timeout: number = 1000): Promise<void> {
  return new Promise((resolve) => {
    if ('requestIdleCallback' in window) {
      (window as Window & { requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => void })
        .requestIdleCallback(() => resolve(), { timeout });
    } else {
      setTimeout(resolve, 50);
    }
  });
}

// ============= Baseline Tests =============

/**
 * Evaluate a metric against its target
 */
function evaluateMetric(value: number, target: number, lowerIsBetter: boolean = true): BaselineResult['status'] {
  if (lowerIsBetter) {
    if (value <= target) return 'pass';
    if (value <= target * 1.5) return 'warning';
    return 'fail';
  } else {
    if (value >= target) return 'pass';
    if (value >= target * 0.8) return 'warning';
    return 'fail';
  }
}

/**
 * Run synthetic render simulation to measure baseline performance
 */
async function measureSyntheticRender(sampleCount: number): Promise<number> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 400;
  const ctx = canvas.getContext('2d');

  if (!ctx) return 0;

  const wavelengths = Array.from({ length: 100 }, (_, i) => 800 + i * 10);
  const spectra = Array.from({ length: sampleCount }, () =>
    wavelengths.map(() => Math.random())
  );

  const start = performance.now();

  // Simulate rendering like SpectraChartV2
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let s = 0; s < spectra.length; s++) {
    ctx.beginPath();
    ctx.strokeStyle = `hsl(${(s / spectra.length) * 360}, 70%, 50%)`;

    for (let w = 0; w < wavelengths.length; w++) {
      const x = (w / wavelengths.length) * canvas.width;
      const y = canvas.height - spectra[s][w] * canvas.height;

      if (w === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  return performance.now() - start;
}

/**
 * Measure selection propagation time
 */
async function measureSelectionResponse(): Promise<number> {
  // Simulate selection state update with multiple listeners
  const listeners: (() => void)[] = [];
  const updatePromises: Promise<void>[] = [];

  // Simulate 5 chart components listening to selection
  for (let i = 0; i < 5; i++) {
    listeners.push(() => {
      // Simulate chart re-render work
      const arr = new Float32Array(10000);
      for (let j = 0; j < arr.length; j++) {
        arr[j] = Math.sqrt(j);
      }
    });
  }

  const start = performance.now();

  // Simulate selection broadcast
  for (const listener of listeners) {
    updatePromises.push(new Promise((resolve) => {
      requestAnimationFrame(() => {
        listener();
        resolve();
      });
    }));
  }

  await Promise.all(updatePromises);
  await nextFrame();

  return performance.now() - start;
}

/**
 * Run all baseline tests
 */
export async function runBaselines(): Promise<BaselineReport> {
  const capabilities = detectDeviceCapabilities();
  const results: BaselineResult[] = [];

  logger.info('Starting baseline measurements...');

  // 1. Initial render (500 samples)
  logger.info('Testing initial render (500 samples)...');
  await whenIdle();
  const render500 = await measureSyntheticRender(500);
  results.push({
    metric: BASELINE_TARGETS.initialRender500.description,
    value: Math.round(render500),
    unit: BASELINE_TARGETS.initialRender500.unit,
    target: BASELINE_TARGETS.initialRender500.target,
    status: evaluateMetric(render500, BASELINE_TARGETS.initialRender500.target),
  });

  // 2. Initial render (5000 samples)
  logger.info('Testing initial render (5000 samples)...');
  await whenIdle();
  const render5000 = await measureSyntheticRender(5000);
  results.push({
    metric: BASELINE_TARGETS.initialRender5000.description,
    value: Math.round(render5000),
    unit: BASELINE_TARGETS.initialRender5000.unit,
    target: BASELINE_TARGETS.initialRender5000.target,
    status: evaluateMetric(render5000, BASELINE_TARGETS.initialRender5000.target),
  });

  // 3. Selection response
  logger.info('Testing selection response...');
  await whenIdle();
  const selectionTime = await measureSelectionResponse();
  results.push({
    metric: BASELINE_TARGETS.selectionResponse.description,
    value: Math.round(selectionTime),
    unit: BASELINE_TARGETS.selectionResponse.unit,
    target: BASELINE_TARGETS.selectionResponse.target,
    status: evaluateMetric(selectionTime, BASELINE_TARGETS.selectionResponse.target),
  });

  // 4. Frame rate
  logger.info('Measuring frame rate...');
  await whenIdle();
  const fps = await measureFrameRate(2000);
  results.push({
    metric: BASELINE_TARGETS.frameRate.description,
    value: Math.round(fps),
    unit: BASELINE_TARGETS.frameRate.unit,
    target: BASELINE_TARGETS.frameRate.target,
    status: evaluateMetric(fps, BASELINE_TARGETS.frameRate.target, false), // Higher is better
  });

  // 5. Memory usage
  const memoryMB = getMemoryUsageMB();
  if (memoryMB !== null) {
    results.push({
      metric: BASELINE_TARGETS.memoryUsage.description,
      value: memoryMB,
      unit: BASELINE_TARGETS.memoryUsage.unit,
      target: BASELINE_TARGETS.memoryUsage.target,
      status: evaluateMetric(memoryMB, BASELINE_TARGETS.memoryUsage.target),
    });
  } else {
    results.push({
      metric: BASELINE_TARGETS.memoryUsage.description,
      value: 0,
      unit: BASELINE_TARGETS.memoryUsage.unit,
      target: BASELINE_TARGETS.memoryUsage.target,
      status: 'warning',
      details: 'Memory API not available',
    });
  }

  // Calculate summary
  const passed = results.filter(r => r.status === 'pass').length;
  const warnings = results.filter(r => r.status === 'warning').length;
  const failed = results.filter(r => r.status === 'fail').length;
  const score = Math.round((passed / results.length) * 100);

  const report: BaselineReport = {
    timestamp: new Date().toISOString(),
    device: {
      userAgent: navigator.userAgent,
      webglVersion: capabilities.webglVersion,
      gpuRenderer: capabilities.gpuRenderer,
      performanceScore: capabilities.performanceScore,
      isMobile: capabilities.isMobile,
    },
    results,
    summary: { passed, warnings, failed, score },
  };

  logger.info('Baseline report:', report);
  logger.info(`Score: ${score}% (${passed} passed, ${warnings} warnings, ${failed} failed)`);

  return report;
}

/**
 * Format report as text table
 */
export function formatBaselineReport(report: BaselineReport): string {
  const lines: string[] = [
    '='.repeat(70),
    'Performance Baseline Report',
    '='.repeat(70),
    `Timestamp: ${report.timestamp}`,
    `Device: ${report.device.isMobile ? 'Mobile' : 'Desktop'}`,
    `WebGL: ${report.device.webglVersion ? `v${report.device.webglVersion}` : 'Not available'}`,
    `GPU: ${report.device.gpuRenderer ?? 'Unknown'}`,
    `Performance Score: ${(report.device.performanceScore * 100).toFixed(0)}%`,
    '-'.repeat(70),
    '',
    'Results:',
    '-'.repeat(70),
    String('Metric').padEnd(35) + String('Value').padEnd(15) + String('Target').padEnd(15) + 'Status',
    '-'.repeat(70),
  ];

  for (const result of report.results) {
    const valueStr = `${result.value} ${result.unit}`;
    const targetStr = `${result.target} ${result.unit}`;
    const statusIcon = result.status === 'pass' ? '[OK]' : result.status === 'warning' ? '[!!]' : '[XX]';
    lines.push(
      result.metric.padEnd(35) + valueStr.padEnd(15) + targetStr.padEnd(15) + statusIcon
    );
  }

  lines.push('-'.repeat(70));
  lines.push(`Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.failed} failed`);
  lines.push(`Overall Score: ${report.summary.score}%`);
  lines.push('='.repeat(70));

  return lines.join('\n');
}

// ============= Global Exposure for Console Access =============

declare global {
  interface Window {
    runPerformanceBaselines: typeof runBaselines;
    formatBaselineReport: typeof formatBaselineReport;
    PERFORMANCE_BUDGETS: typeof PERFORMANCE_BUDGETS;
    BASELINE_TARGETS: typeof BASELINE_TARGETS;
  }
}

// Expose to console for developer use
if (typeof window !== 'undefined') {
  window.runPerformanceBaselines = runBaselines;
  window.formatBaselineReport = formatBaselineReport;
  window.PERFORMANCE_BUDGETS = PERFORMANCE_BUDGETS;
  window.BASELINE_TARGETS = BASELINE_TARGETS;
}

export { PERFORMANCE_BUDGETS };

/**
 * Memory Monitoring Utilities for Playground
 *
 * Phase 10: Polish & Performance
 *
 * Provides utilities for detecting and debugging memory leaks:
 * - Component mount/unmount tracking
 * - Memory usage snapshots
 * - Event listener tracking
 * - Three.js resource cleanup verification
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("MemoryMonitor");

// ============= Types =============

export interface MemorySnapshot {
  timestamp: number;
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface ComponentTrackingEntry {
  name: string;
  mountedAt: number;
  unmountedAt?: number;
  isLeaked?: boolean;
}

export interface MemoryReport {
  snapshots: MemorySnapshot[];
  mountedComponents: string[];
  potentialLeaks: ComponentTrackingEntry[];
  eventListenerCount: number;
  threeJsObjectCount: number;
}

// ============= Memory Snapshot =============

/**
 * Take a memory usage snapshot (Chrome only)
 */
export function takeMemorySnapshot(): MemorySnapshot | null {
  if (!('memory' in performance)) {
    logger.warn('Memory API not available (Chrome only)');
    return null;
  }

  const memory = (performance as Performance & {
    memory: {
      usedJSHeapSize: number;
      totalJSHeapSize: number;
      jsHeapSizeLimit: number;
    };
  }).memory;

  return {
    timestamp: Date.now(),
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ============= Component Tracking =============

const componentRegistry = new Map<string, ComponentTrackingEntry[]>();

/**
 * Track component mount (call in useEffect)
 */
export function trackComponentMount(componentName: string): () => void {
  const entry: ComponentTrackingEntry = {
    name: componentName,
    mountedAt: Date.now(),
  };

  if (!componentRegistry.has(componentName)) {
    componentRegistry.set(componentName, []);
  }
  componentRegistry.get(componentName)!.push(entry);

  // Return unmount tracker
  return () => {
    entry.unmountedAt = Date.now();
  };
}

/**
 * Get components that were mounted but never unmounted
 */
export function getPotentialLeaks(maxAgeMs: number = 60000): ComponentTrackingEntry[] {
  const now = Date.now();
  const leaks: ComponentTrackingEntry[] = [];

  for (const [, entries] of componentRegistry) {
    for (const entry of entries) {
      // Component mounted more than maxAgeMs ago and never unmounted
      if (!entry.unmountedAt && now - entry.mountedAt > maxAgeMs) {
        entry.isLeaked = true;
        leaks.push(entry);
      }
    }
  }

  return leaks;
}

/**
 * Clear component tracking data
 */
export function clearComponentTracking(): void {
  componentRegistry.clear();
}

// ============= Event Listener Tracking =============

let originalAddEventListener: typeof EventTarget.prototype.addEventListener | null = null;
let originalRemoveEventListener: typeof EventTarget.prototype.removeEventListener | null = null;
let activeListenerCount = 0;
let isTrackingListeners = false;

/**
 * Start tracking event listeners (for debugging)
 */
export function startEventListenerTracking(): void {
  if (isTrackingListeners) return;

  originalAddEventListener = EventTarget.prototype.addEventListener;
  originalRemoveEventListener = EventTarget.prototype.removeEventListener;

  EventTarget.prototype.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ) {
    activeListenerCount++;
    return originalAddEventListener!.call(this, type, listener, options);
  };

  EventTarget.prototype.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ) {
    activeListenerCount = Math.max(0, activeListenerCount - 1);
    return originalRemoveEventListener!.call(this, type, listener, options);
  };

  isTrackingListeners = true;
  logger.info('Event listener tracking started');
}

/**
 * Stop tracking event listeners
 */
export function stopEventListenerTracking(): void {
  if (!isTrackingListeners || !originalAddEventListener || !originalRemoveEventListener) return;

  EventTarget.prototype.addEventListener = originalAddEventListener;
  EventTarget.prototype.removeEventListener = originalRemoveEventListener;

  isTrackingListeners = false;
  logger.info('Event listener tracking stopped');
}

/**
 * Get current event listener count (only if tracking is enabled)
 */
export function getEventListenerCount(): number {
  return activeListenerCount;
}

// ============= Three.js Resource Tracking =============

/**
 * Count Three.js objects in the scene (for WebGL components)
 */
export function countThreeJsObjects(): number {
  // Find all canvas elements that might be Three.js renderers
  const canvases = document.querySelectorAll('canvas');
  let count = 0;

  canvases.forEach(canvas => {
    const gl = canvas.getContext('webgl') || canvas.getContext('webgl2');
    if (gl) {
      // This is a rough estimate - actual counting would require access to the scene graph
      count++;
    }
  });

  return count;
}

// ============= Memory Monitor Class =============

class MemoryMonitor {
  private snapshots: MemorySnapshot[] = [];
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private warningThresholdMB = 400;

  start(intervalMs: number = 5000): void {
    if (this.intervalId) return;

    this.intervalId = setInterval(() => {
      const snapshot = takeMemorySnapshot();
      if (snapshot) {
        this.snapshots.push(snapshot);

        // Keep only last 100 snapshots
        if (this.snapshots.length > 100) {
          this.snapshots.shift();
        }

        // Check for memory warning
        const usedMB = snapshot.usedJSHeapSize / (1024 * 1024);
        if (usedMB > this.warningThresholdMB) {
          logger.warn(`High memory usage: ${formatBytes(snapshot.usedJSHeapSize)}`);
        }
      }
    }, intervalMs);

    logger.info('Started monitoring');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Stopped monitoring');
    }
  }

  getReport(): MemoryReport {
    return {
      snapshots: [...this.snapshots],
      mountedComponents: Array.from(componentRegistry.keys()),
      potentialLeaks: getPotentialLeaks(),
      eventListenerCount: activeListenerCount,
      threeJsObjectCount: countThreeJsObjects(),
    };
  }

  printReport(): void {
    const report = this.getReport();

    logger.info('='.repeat(60));
    logger.info('Memory Monitor Report');
    logger.info('='.repeat(60));

    if (report.snapshots.length > 0) {
      const latest = report.snapshots[report.snapshots.length - 1];
      const first = report.snapshots[0];
      const growth = latest.usedJSHeapSize - first.usedJSHeapSize;

      logger.info(`Current heap: ${formatBytes(latest.usedJSHeapSize)}`);
      logger.info(`Total heap: ${formatBytes(latest.totalJSHeapSize)}`);
      logger.info(`Heap limit: ${formatBytes(latest.jsHeapSizeLimit)}`);
      logger.info(`Growth since start: ${formatBytes(growth)} (${growth > 0 ? '+' : ''}${((growth / first.usedJSHeapSize) * 100).toFixed(1)}%)`);
    } else {
      logger.info('No memory snapshots available');
    }

    logger.info('-'.repeat(60));
    logger.info(`Tracked components: ${report.mountedComponents.length}`);
    logger.info(`Potential leaks: ${report.potentialLeaks.length}`);

    if (report.potentialLeaks.length > 0) {
      logger.info('Leaked components:');
      report.potentialLeaks.forEach(leak => {
        const ageMs = Date.now() - leak.mountedAt;
        logger.info(`  - ${leak.name} (mounted ${Math.round(ageMs / 1000)}s ago)`);
      });
    }

    logger.info('-'.repeat(60));
    logger.info(`Event listeners (tracked): ${report.eventListenerCount}`);
    logger.info(`WebGL canvases: ${report.threeJsObjectCount}`);
    logger.info('='.repeat(60));
  }

  clear(): void {
    this.snapshots = [];
    clearComponentTracking();
    logger.info('Cleared all data');
  }
}

// ============= Singleton Instance =============

export const memoryMonitor = new MemoryMonitor();

// ============= Global Exposure =============

declare global {
  interface Window {
    memoryMonitor: MemoryMonitor;
    takeMemorySnapshot: typeof takeMemorySnapshot;
    startEventListenerTracking: typeof startEventListenerTracking;
    stopEventListenerTracking: typeof stopEventListenerTracking;
  }
}

if (typeof window !== 'undefined') {
  window.memoryMonitor = memoryMonitor;
  window.takeMemorySnapshot = takeMemorySnapshot;
  window.startEventListenerTracking = startEventListenerTracking;
  window.stopEventListenerTracking = stopEventListenerTracking;
}

import { useEffect, useRef, useState } from "react";

export interface InspectorChartViewportDimensions {
  width: number;
  height: number;
}

export interface UseInspectorChartViewportOptions {
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
}

function resolveMeasuredDimension(value: number, minValue: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(minValue, value);
}

function areDimensionsEqual(
  left: InspectorChartViewportDimensions,
  right: InspectorChartViewportDimensions,
): boolean {
  return left.width === right.width && left.height === right.height;
}

export function useInspectorChartViewport({
  initialWidth = 600,
  initialHeight = 400,
  minWidth = 1,
  minHeight = 1,
}: UseInspectorChartViewportOptions = {}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState<InspectorChartViewportDimensions>({
    width: Math.max(minWidth, initialWidth),
    height: Math.max(minHeight, initialHeight),
  });

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;

    const updateDimensions = (width: number, height: number) => {
      setDimensions(previous => {
        const next = {
          width: resolveMeasuredDimension(width, minWidth, previous.width),
          height: resolveMeasuredDimension(height, minHeight, previous.height),
        };
        return areDimensionsEqual(previous, next) ? previous : next;
      });
    };

    const rect = element.getBoundingClientRect();
    updateDimensions(rect.width || element.clientWidth, rect.height || element.clientHeight);

    if (typeof ResizeObserver === "undefined") return undefined;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        updateDimensions(entry.contentRect.width, entry.contentRect.height);
      }
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [minHeight, minWidth]);

  return { viewportRef, dimensions };
}

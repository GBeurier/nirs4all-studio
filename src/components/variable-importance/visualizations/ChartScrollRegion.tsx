import type { CSSProperties, ReactNode } from 'react';
import { useElementWidth } from '@/hooks/useElementWidth';
import './ChartScrollRegion.css';

/** Below this width the explainer charts keep their layout and scroll horizontally instead of compressing labels. */
export const SHAP_CHART_MIN_WIDTH = 560;

interface ChartScrollRegionProps {
  /** Accessible name of the scrollable region (used only when it scrolls). */
  label: string;
  /** Receives the chart width: the container width, never below the minimum. */
  children: (width: number) => ReactNode;
}

/**
 * Measures the available width for an SVG chart. On narrow screens the chart
 * keeps a readable minimum width inside a contained, keyboard-focusable
 * horizontal scroll region; surrounding text and tables still reflow.
 */
export function ChartScrollRegion({ label, children }: ChartScrollRegionProps) {
  const [ref, width] = useElementWidth<HTMLDivElement>(720);
  const scrolls = width < SHAP_CHART_MIN_WIDTH;
  return (
    <div
      ref={ref}
      className="shap-chart-scroll min-w-0 overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
      style={{ '--shap-chart-text-width': `${width}px` } as CSSProperties}
      role={scrolls ? 'region' : undefined}
      aria-label={scrolls ? label : undefined}
      tabIndex={scrolls ? 0 : undefined}
    >
      <div style={{ width: Math.max(width, SHAP_CHART_MIN_WIDTH) }}>
        {children(Math.max(width, SHAP_CHART_MIN_WIDTH))}
      </div>
    </div>
  );
}

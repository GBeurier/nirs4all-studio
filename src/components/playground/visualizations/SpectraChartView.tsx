/**
 * SpectraChartView - Render-only layout shell for SpectraChart.
 *
 * This component owns NO state, hooks, or data derivation. It receives the
 * already-built prop bundles for the toolbar, renderer surface, and footer and
 * arranges them in the chart's layout (toolbar → loading overlay → renderer
 * surface → footer). All logic — config, selection, sampling, derivation,
 * export, and interaction handlers — stays in the `SpectraChart` parent.
 *
 * Keeping this purely presentational lets the multimodal Playground reuse the
 * same visual layout while swapping the data/orchestration layer above it.
 */

import type { RefObject } from 'react';

import { SpectraChartToolbar, type SpectraChartToolbarProps } from './SpectraChartToolbar';
import { ChartLoadingOverlay } from './ChartLoadingOverlay';
import {
  SpectraRendererSurface,
  type SpectraRendererSurfaceProps,
} from './SpectraRendererSurface';
import { SpectraChartFooter, type SpectraChartFooterProps } from './SpectraChartFooter';

export interface SpectraChartViewProps {
  /** Ref for the outer chart container (used for export capture). */
  chartRef: RefObject<HTMLDivElement | null>;
  /** Whether the loading overlay should be shown. */
  isLoading: boolean;
  /** Props for the toolbar sub-view. */
  toolbar: SpectraChartToolbarProps;
  /** Props for the renderer surface sub-view. */
  surface: SpectraRendererSurfaceProps;
  /** Props for the footer/legend sub-view. */
  footer: SpectraChartFooterProps;
}

export function SpectraChartView({
  chartRef,
  isLoading,
  toolbar,
  surface,
  footer,
}: SpectraChartViewProps) {
  return (
    <div className="h-full flex flex-col relative" ref={chartRef}>
      {/* Enhanced Toolbar with integrated settings */}
      <SpectraChartToolbar {...toolbar} />

      {/* Loading overlay */}
      {isLoading && (
        <ChartLoadingOverlay label="Updating spectra" />
      )}

      <SpectraRendererSurface {...surface} />

      <SpectraChartFooter {...footer} />
    </div>
  );
}

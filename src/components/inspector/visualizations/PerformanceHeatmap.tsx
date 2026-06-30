/**
 * PerformanceHeatmap — Color-coded grid of score at intersection of two variables.
 *
 * Renders a custom SVG heatmap with shared viewport sizing.
 * Cells colored by score value using continuous palette.
 */

import { useMemo, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import { useInspectorColor } from '@/context/useInspectorColor';
import {
  buildPerformanceHeatmapCellMap,
  buildPerformanceHeatmapLayout,
  hasPerformanceHeatmapData,
} from '@/lib/inspector/performanceHeatmapData';
import { getPerformanceHeatmapEmptyMessage } from '@/lib/inspector/performanceHeatmapPresentation';
import type { HeatmapResponse } from '@/types/inspector';
import { PerformanceHeatmapSvg } from './PerformanceHeatmapSvg';
import { PerformanceHeatmapTooltip, type PerformanceHeatmapHoveredCell } from './PerformanceHeatmapTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface PerformanceHeatmapProps {
  data: HeatmapResponse | null | undefined;
  isLoading: boolean;
}

export function PerformanceHeatmap({ data, isLoading }: PerformanceHeatmapProps) {
  const { select } = useInspectorSelection();
  const { config } = useInspectorColor();
  const { viewportRef, dimensions } = useInspectorChartViewport();
  const [hovered, setHovered] = useState<PerformanceHeatmapHoveredCell | null>(null);

  const cellMap = useMemo(() => buildPerformanceHeatmapCellMap(data?.cells), [data?.cells]);

  const handleCellClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading heatmap data...</span>
      </div>
    );
  }

  if (!hasPerformanceHeatmapData(data)) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {getPerformanceHeatmapEmptyMessage()}
      </div>
    );
  }

  const { x_labels, y_labels } = data;
  const layout = buildPerformanceHeatmapLayout({
    width: dimensions.width,
    height: dimensions.height,
    xLabelCount: x_labels.length,
    yLabelCount: y_labels.length,
  });

  return (
    <div ref={viewportRef} className="w-full h-full relative overflow-hidden">
      <PerformanceHeatmapSvg
        xLabels={x_labels}
        yLabels={y_labels}
        cellMap={cellMap}
        layout={layout}
        minValue={data.min_value}
        maxValue={data.max_value}
        palette={config.continuousPalette}
        hovered={hovered}
        onHoveredChange={setHovered}
        onCellClick={handleCellClick}
      />

      <PerformanceHeatmapTooltip
        hovered={hovered}
        xVariable={data.x_variable}
        yVariable={data.y_variable}
      />
    </div>
  );
}

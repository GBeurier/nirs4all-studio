import { useMemo, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import {
  buildCandlestickData,
  buildCandlestickLayout,
} from '@/lib/inspector/candlestickData';
import { getCandlestickEmptyMessage } from '@/lib/inspector/candlestickPresentation';
import type { CandlestickResponse } from '@/types/inspector';
import { CandlestickSvg } from './CandlestickSvg';
import { CandlestickTooltip, type CandlestickHoveredBox } from './CandlestickTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface CandlestickChartProps {
  data: CandlestickResponse | null | undefined;
  isLoading: boolean;
}

export function CandlestickChart({ data, isLoading }: CandlestickChartProps) {
  const { select } = useInspectorSelection();
  const { viewportRef, dimensions } = useInspectorChartViewport();
  const [hovered, setHovered] = useState<CandlestickHoveredBox | null>(null);

  const { yMin, yMax, categories } = useMemo(() => buildCandlestickData(data), [data]);

  const handleBoxClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading box plot data...</span>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {getCandlestickEmptyMessage()}
      </div>
    );
  }

  const layout = buildCandlestickLayout({
    width: dimensions.width,
    height: dimensions.height,
    categoryCount: categories.length,
    yMin,
    yMax,
  });

  return (
    <div ref={viewportRef} className="relative h-full w-full">
      <CandlestickSvg
        width={dimensions.width}
        height={dimensions.height}
        categories={categories}
        yMin={yMin}
        layout={layout}
        hovered={hovered}
        onHoveredChange={setHovered}
        onBoxClick={handleBoxClick}
      />

      <CandlestickTooltip hovered={hovered} />
    </div>
  );
}

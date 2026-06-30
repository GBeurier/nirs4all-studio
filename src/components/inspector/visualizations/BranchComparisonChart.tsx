import { useMemo, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import {
  buildBranchComparisonData,
  buildBranchComparisonLayout,
} from '@/lib/inspector/branchComparisonData';
import { getBranchComparisonEmptyMessage } from '@/lib/inspector/branchComparisonPresentation';
import type { BranchComparisonResponse } from '@/types/inspector';
import { BranchComparisonSvg } from './BranchComparisonSvg';
import { BranchComparisonTooltip, type BranchComparisonHoveredBar } from './BranchComparisonTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface BranchComparisonChartProps {
  data: BranchComparisonResponse | null | undefined;
  isLoading: boolean;
}

export function BranchComparisonChart({ data, isLoading }: BranchComparisonChartProps) {
  const { select } = useInspectorSelection();
  const { viewportRef, dimensions } = useInspectorChartViewport();
  const [hovered, setHovered] = useState<BranchComparisonHoveredBar | null>(null);

  const { xMin, xMax, branches } = useMemo(() => buildBranchComparisonData(data), [data]);

  const handleBarClick = useCallback((chainIds: string[]) => {
    if (chainIds.length > 0) select(chainIds, 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">Loading branch comparison data...</span>
      </div>
    );
  }

  if (branches.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {getBranchComparisonEmptyMessage()}
      </div>
    );
  }

  const layout = buildBranchComparisonLayout({
    width: dimensions.width,
    height: dimensions.height,
    branchCount: branches.length,
    xMin,
    xMax,
  });

  return (
    <div ref={viewportRef} className="relative h-full w-full">
      <BranchComparisonSvg
        width={dimensions.width}
        height={dimensions.height}
        branches={branches}
        scoreColumn={data?.score_column}
        xMin={xMin}
        layout={layout}
        hovered={hovered}
        onHoveredChange={setHovered}
        onBarClick={handleBarClick}
      />

      <BranchComparisonTooltip hovered={hovered} />
    </div>
  );
}

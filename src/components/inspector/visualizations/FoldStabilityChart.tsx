/**
 * FoldStabilityChart — Line chart of per-fold scores per chain/group.
 *
 * X-axis: fold index, Y-axis: score value.
 * One line per chain, colored by group. Hover highlights line.
 * Click line → select/toggle chain. Mean ± std band per group behind lines.
 * Custom SVG (pattern from CandlestickChart).
 */

import { useMemo, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection, useInspectorHover } from '@/context/useInspectorSelection';
import {
  buildFoldStabilityBandPath,
  buildFoldStabilityChainColorMap,
  buildFoldStabilityLineData,
  buildFoldStabilityLayout,
  buildFoldStabilityMeanBand,
  buildFoldStabilityMeanPath,
  buildFoldStabilityXTicks,
  buildFoldStabilityYTicks,
  getRenderableFoldStabilityLines,
  withFoldStabilityYRange,
} from '@/lib/inspector/foldStabilityData';
import { getFoldStabilityEmptyMessage } from '@/lib/inspector/foldStabilityPresentation';
import type { FoldStabilityResponse, InspectorGroup } from '@/types/inspector';
import { FoldStabilitySvg } from './FoldStabilitySvg';
import { FoldStabilityTooltip, type FoldStabilityHoveredLine } from './FoldStabilityTooltip';
import { useInspectorChartViewport } from './useInspectorChartViewport';

interface FoldStabilityChartProps {
  data: FoldStabilityResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

export function FoldStabilityChart({ data, groups, isLoading }: FoldStabilityChartProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();
  const { hoveredChain, setHovered } = useInspectorHover();
  const { viewportRef, dimensions } = useInspectorChartViewport();
  const [hoveredLine, setHoveredLine] = useState<FoldStabilityHoveredLine | null>(null);

  // Build chain→color lookup
  const chainColorMap = useMemo(() => {
    return buildFoldStabilityChainColorMap(groups);
  }, [groups]);

  // Build chain lines from data
  const { lines, yMin, yMax, foldCount } = useMemo(() => {
    return buildFoldStabilityLineData(data, chainColorMap);
  }, [data, chainColorMap]);

  // Compute mean ± std band per fold (across all visible chains)
  const meanBand = useMemo(() => {
    return buildFoldStabilityMeanBand(lines);
  }, [lines]);

  const handleLineClick = useCallback((chainId: string) => {
    select([chainId], 'toggle');
  }, [select]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading fold stability data...</span>
      </div>
    );
  }

  const renderableLines = getRenderableFoldStabilityLines(lines);

  if (lines.length === 0 || renderableLines.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {getFoldStabilityEmptyMessage()}
      </div>
    );
  }

  const layout = withFoldStabilityYRange(buildFoldStabilityLayout(dimensions.width, dimensions.height), yMin, yMax);
  const { yRange } = layout;
  const yTicks = buildFoldStabilityYTicks(yMin, yRange);
  const xTicks = buildFoldStabilityXTicks(foldCount);

  // SVG path for mean band polygon
  const bandPath = buildFoldStabilityBandPath(meanBand, { foldCount, yMin, layout });

  // Mean line path
  const meanPath = buildFoldStabilityMeanPath(meanBand, { foldCount, yMin, layout });

  // Effective hover: from tooltip hover or from context
  const effectiveHover = hoveredLine?.chainId ?? hoveredChain;

  return (
    <div ref={viewportRef} className="w-full h-full relative">
      <FoldStabilitySvg
        width={dimensions.width}
        height={dimensions.height}
        lines={lines}
        selectedChains={selectedChains}
        hasSelection={hasSelection}
        effectiveHover={effectiveHover}
        foldCount={foldCount}
        yMin={yMin}
        layout={layout}
        yTicks={yTicks}
        xTicks={xTicks}
        bandPath={bandPath}
        meanPath={meanPath}
        onLineClick={handleLineClick}
        onHoverLineChange={setHoveredLine}
        onContextHoverChange={setHovered}
      />

      <FoldStabilityTooltip hoveredLine={hoveredLine} lines={lines} />
    </div>
  );
}

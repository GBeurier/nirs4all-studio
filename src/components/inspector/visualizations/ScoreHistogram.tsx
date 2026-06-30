/**
 * ScoreHistogram — Score distribution histogram for Inspector.
 *
 * Displays a bar chart of score distribution with clickable bars
 * that select the chains in each bin.
 */

import { useMemo, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { useInspectorSelection } from '@/context/useInspectorSelection';
import {
  buildScoreHistogramBarColors,
  buildScoreHistogramBars,
  buildScoreHistogramChainColorMap,
  getScoreHistogramSelectionDecision,
} from '@/lib/inspector/scoreHistogramData';
import {
  buildScoreHistogramStatsSegments,
  formatScoreHistogramMeanReference,
  getScoreHistogramEmptyMessage,
} from '@/lib/inspector/scoreHistogramPresentation';
import type { HistogramResponse, InspectorGroup } from '@/types/inspector';
import type { ScoreHistogramBarData } from '@/lib/inspector/scoreHistogramData';
import { ScoreHistogramPlot } from './ScoreHistogramPlot';

interface ScoreHistogramProps {
  data: HistogramResponse | null | undefined;
  groups: InspectorGroup[];
  isLoading: boolean;
}

export function ScoreHistogram({ data, groups, isLoading }: ScoreHistogramProps) {
  const { select, selectedChains, hasSelection } = useInspectorSelection();

  // Build chain→group color lookup
  const chainColorMap = useMemo(() => {
    return buildScoreHistogramChainColorMap(groups);
  }, [groups]);

  // Format bins for the bar chart
  const bars = useMemo(() => {
    return buildScoreHistogramBars({ data, selectedChains, hasSelection });
  }, [data, hasSelection, selectedChains]);

  // Determine dominant color per bar from chain groups
  const barColors = useMemo(() => {
    return buildScoreHistogramBarColors(bars, chainColorMap);
  }, [bars, chainColorMap]);

  const statsSegments = useMemo(() => buildScoreHistogramStatsSegments(data), [data]);
  const meanReference = formatScoreHistogramMeanReference(data?.mean_score);

  const handleBarClick = useCallback((barData: ScoreHistogramBarData | undefined) => {
    const decision = getScoreHistogramSelectionDecision(barData, selectedChains);
    if (!decision) return;
    select(decision.chainIds, decision.mode);
  }, [select, selectedChains]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">Loading histogram...</span>
      </div>
    );
  }

  if (bars.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {getScoreHistogramEmptyMessage()}
      </div>
    );
  }

  return (
    <ScoreHistogramPlot
      bars={bars}
      barColors={barColors}
      scoreColumn={data?.score_column}
      statsSegments={statsSegments}
      meanReference={meanReference}
      totalChains={data?.total_chains}
      hasSelection={hasSelection}
      onBarClick={handleBarClick}
    />
  );
}

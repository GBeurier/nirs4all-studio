import { AlertTriangle } from 'lucide-react';

import { formatYValue } from './chartConfig';
import type { RepetitionsPlotStatistics, RepetitionsSortOption } from '@/lib/playground/repetitionsChartData';
import type { RepetitionDataPoint, RepetitionResult } from '@/types/playground';

export interface RepetitionsChartFooterProps {
  compact?: boolean;
  hasRepetitions: boolean;
  repetitionData: RepetitionResult | null | undefined;
  plotDataLength: number;
  sortBy: RepetitionsSortOption;
  metadataSortColumn: string | null;
  groupCount: number;
  scaleType: 'linear' | 'log';
  statistics: RepetitionsPlotStatistics | null;
  selectedCount: number;
  highVariabilitySamples?: RepetitionDataPoint[];
}

export function RepetitionsChartFooter({
  compact = false,
  hasRepetitions,
  repetitionData,
  plotDataLength,
  sortBy,
  metadataSortColumn,
  groupCount,
  scaleType,
  statistics,
  selectedCount,
  highVariabilitySamples,
}: RepetitionsChartFooterProps) {
  if (compact) {
    return null;
  }

  const hasHighVariability = hasRepetitions && Boolean(highVariabilitySamples?.length);
  const visibleHighVariabilitySamples = hasHighVariability ? highVariabilitySamples ?? [] : [];

  return (
    <>
      <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-3">
          {hasRepetitions && repetitionData ? (
            <>
              <span>
                {repetitionData.total_repetitions} measurements from {repetitionData.n_with_reps} samples
              </span>
              {repetitionData.n_singletons && repetitionData.n_singletons > 0 && (
                <span>({repetitionData.n_singletons} singletons hidden)</span>
              )}
            </>
          ) : (
            <span>
              {plotDataLength} samples
              {sortBy === 'metadata_column' && metadataSortColumn
                ? ` grouped by "${metadataSortColumn}" (${groupCount} groups)`
                : ''}
            </span>
          )}
          <span className="text-muted-foreground/50">
            Scroll to zoom • Right-drag to pan • Left-drag to select • Double-click to reset
          </span>
        </div>

        <div className="flex items-center gap-3">
          {statistics && (
            <span>
              Mean: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.mean_distance ?? 0) : (statistics.mean_distance ?? 0))} |
              Max: {formatYValue(scaleType === 'log' ? Math.log1p(statistics.max_distance ?? 0) : (statistics.max_distance ?? 0))}
            </span>
          )}

          {selectedCount > 0 && (
            <span className="text-primary font-medium">
              {selectedCount} selected
            </span>
          )}
        </div>
      </div>

      {hasHighVariability && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          <span>
            {visibleHighVariabilitySamples.length} sample(s) with high variability
            {visibleHighVariabilitySamples.length <= 3 && (
              <span className="text-muted-foreground ml-1">
                ({visibleHighVariabilitySamples.map(sample => sample.bio_sample).join(', ')})
              </span>
            )}
          </span>
        </div>
      )}
    </>
  );
}

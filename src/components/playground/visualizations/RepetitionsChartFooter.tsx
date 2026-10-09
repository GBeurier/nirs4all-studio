import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();

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
                {t('playground.charts.repetitions.footer.measurements', { total: repetitionData.total_repetitions, samples: repetitionData.n_with_reps })}
              </span>
              {repetitionData.n_singletons && repetitionData.n_singletons > 0 && (
                <span>{t('playground.charts.repetitions.footer.singletonsHidden', { count: repetitionData.n_singletons })}</span>
              )}
            </>
          ) : (
            <span>
              {t('playground.charts.repetitions.footer.samples', { count: plotDataLength })}
              {sortBy === 'metadata_column' && metadataSortColumn
                ? t('playground.charts.repetitions.footer.groupedBy', { column: metadataSortColumn, groups: groupCount })
                : ''}
            </span>
          )}
          <span className="text-muted-foreground/50">
            {t('playground.charts.repetitions.footer.interactionHint')}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {statistics && (
            <span>
              {t('playground.charts.repetitions.footer.statsMeanMax', {
                mean: formatYValue(scaleType === 'log' ? Math.log1p(statistics.mean_distance ?? 0) : (statistics.mean_distance ?? 0)),
                max: formatYValue(scaleType === 'log' ? Math.log1p(statistics.max_distance ?? 0) : (statistics.max_distance ?? 0)),
              })}
            </span>
          )}

          {selectedCount > 0 && (
            <span className="text-primary font-medium">
              {t('playground.charts.repetitions.footer.selected', { count: selectedCount })}
            </span>
          )}
        </div>
      </div>

      {hasHighVariability && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-600">
          <AlertTriangle className="w-3 h-3" />
          <span>
            {t('playground.charts.repetitions.footer.highVariability', { count: visibleHighVariabilitySamples.length })}
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

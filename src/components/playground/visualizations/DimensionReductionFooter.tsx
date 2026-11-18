import { InlineColorLegend } from '../ColorLegend';
import type {
  ColorContext,
  GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import { CHART_THEME } from './chartConfig';
import { useTranslation } from 'react-i18next';

export interface DimensionReductionFooterProps {
  compact: boolean;
  showVarianceSummary: boolean;
  xAxisLabel: string;
  yAxisLabel: string;
  selectedCount: number;
  /** Samples the projection left out because their spectrum has missing values. */
  leftOutCount?: number;
  globalColorConfig?: GlobalColorConfig;
  colorContext?: ColorContext;
  hasReferenceData: boolean;
  referenceLabel: string;
}

export function DimensionReductionFooter({
  compact,
  showVarianceSummary,
  xAxisLabel,
  yAxisLabel,
  selectedCount,
  leftOutCount = 0,
  globalColorConfig,
  colorContext,
  hasReferenceData,
  referenceLabel,
}: DimensionReductionFooterProps) {
  const { t } = useTranslation();
  const leftOut = leftOutCount > 0 && (
    <span className="text-amber-700 dark:text-amber-400">
      {t('playground.charts.dimReduction.footer.leftOut', { count: leftOutCount })}
    </span>
  );

  if (compact) {
    // The left-out count is never hidden: it changes what the chart shows.
    return leftOut ? <div className="mt-1 text-[10px]">{leftOut}</div> : null;
  }

  return (
    <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-2">
        {showVarianceSummary && (
          <span>
            {t('playground.charts.dimReduction.footer.variance', { x: xAxisLabel, y: yAxisLabel })}
          </span>
        )}
        {leftOut}
        {selectedCount > 0 && (
          <span className="text-primary font-medium">
            {t('playground.charts.dimReduction.footer.selected', { count: selectedCount })}
          </span>
        )}
        {globalColorConfig && colorContext && (
          <InlineColorLegend config={globalColorConfig} context={colorContext} />
        )}
      </div>

      {hasReferenceData && (
        <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border/50">
          <span
            className="w-2 h-2"
            style={{
              backgroundColor: CHART_THEME.referenceLineColor,
              clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
            }}
          />
          <span>{referenceLabel}</span>
        </div>
      )}
    </div>
  );
}

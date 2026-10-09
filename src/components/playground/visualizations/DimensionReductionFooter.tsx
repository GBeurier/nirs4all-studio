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
  globalColorConfig,
  colorContext,
  hasReferenceData,
  referenceLabel,
}: DimensionReductionFooterProps) {
  const { t } = useTranslation();

  if (compact) {
    return null;
  }

  return (
    <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-2">
        {showVarianceSummary && (
          <span>
            {t('playground.charts.dimReduction.footer.variance', { x: xAxisLabel, y: yAxisLabel })}
          </span>
        )}
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

import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
  Legend,
  ErrorBar,
  ReferenceLine,
} from 'recharts';

import {
  CHART_THEME,
  CHART_MARGINS,
  ANIMATION_CONFIG,
  formatYValue,
} from './chartConfig';
import { useTranslation } from 'react-i18next';
import type { FoldDistributionYStatsData } from '@/lib/playground/foldDistributionData';

interface FoldDistributionYDistributionChartProps {
  yData: FoldDistributionYStatsData[];
  showMeanLine: boolean;
  showLegend: boolean;
  globalYMean: number | null;
  selectedFold: number | null;
  trainColor: string;
  validationLabel: string;
  validationColor: string;
}

export function FoldDistributionYDistributionChart({
  yData,
  showMeanLine,
  showLegend,
  globalYMean,
  selectedFold,
  trainColor,
  validationLabel,
  validationColor,
}: FoldDistributionYDistributionChartProps) {
  const { t } = useTranslation();

  if (yData.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        {t('playground.charts.fold.yDist.noStats')}
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={yData} margin={CHART_MARGINS.boxplot}>
        <CartesianGrid
          strokeDasharray={CHART_THEME.gridDasharray}
          stroke={CHART_THEME.gridStroke}
          opacity={CHART_THEME.gridOpacity}
        />
        <XAxis
          dataKey="fold"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
        />
        <YAxis
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          width={45}
          label={{
            value: t('playground.charts.fold.yDist.axisYValue'),
            angle: -90,
            position: 'insideLeft',
            fontSize: CHART_THEME.axisLabelFontSize,
          }}
        />

        {showMeanLine && globalYMean !== null && (
          <ReferenceLine
            y={globalYMean}
            stroke="hsl(var(--muted-foreground))"
            strokeDasharray="5 5"
            strokeWidth={1.5}
            label={{
              value: `μ = ${formatYValue(globalYMean)}`,
              position: 'right',
              fontSize: 10,
            }}
          />
        )}

        <Tooltip
          isAnimationActive={false}
          contentStyle={{
            backgroundColor: CHART_THEME.tooltipBg,
            border: `1px solid ${CHART_THEME.tooltipBorder}`,
            borderRadius: CHART_THEME.tooltipBorderRadius,
            fontSize: CHART_THEME.tooltipFontSize,
          }}
          content={({ payload, label }) => {
            if (!payload || payload.length === 0) return null;
            const entry = yData.find(d => d.fold === label);
            if (!entry) return null;

            return (
              <div className="bg-card border border-border rounded-lg p-2 shadow-lg text-xs">
                <p className="font-medium mb-1">{label}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="font-medium" style={{ color: trainColor }}>{t('playground.charts.fold.yDist.train')}</p>
                    <p>{t('playground.charts.fold.yDist.mean', { value: formatYValue(entry.trainMean) })}</p>
                    <p>{t('playground.charts.fold.yDist.std', { value: formatYValue(entry.trainStd) })}</p>
                    <p>{t('playground.charts.fold.yDist.range', { min: formatYValue(entry.trainMin), max: formatYValue(entry.trainMax) })}</p>
                  </div>
                  <div>
                    <p className="font-medium" style={{ color: validationColor }}>{validationLabel}</p>
                    <p>{t('playground.charts.fold.yDist.mean', { value: formatYValue(entry.testMean) })}</p>
                    <p>{t('playground.charts.fold.yDist.std', { value: formatYValue(entry.testStd) })}</p>
                    <p>{t('playground.charts.fold.yDist.range', { min: formatYValue(entry.testMin), max: formatYValue(entry.testMax) })}</p>
                  </div>
                </div>
              </div>
            );
          }}
        />

        {showLegend && (
          <Legend
            verticalAlign="top"
            height={24}
            iconSize={10}
            formatter={(value) => (
              <span className="text-xs">{String(value).includes('train') ? t('playground.charts.fold.yDist.train') : validationLabel}</span>
            )}
          />
        )}

        <Bar
          dataKey="trainMean"
          fill={trainColor}
          barSize={12}
          {...ANIMATION_CONFIG}
        >
          {yData.map((entry) => (
            <Cell
              key={`train-${entry.foldIndex}`}
              fill={trainColor}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
            />
          ))}
          <ErrorBar
            dataKey="trainUpper"
            direction="y"
            stroke={trainColor}
            strokeWidth={1.5}
          />
        </Bar>

        <Bar
          dataKey="testMean"
          fill={validationColor}
          barSize={12}
          {...ANIMATION_CONFIG}
        >
          {yData.map((entry) => (
            <Cell
              key={`test-${entry.foldIndex}`}
              fill={validationColor}
              opacity={selectedFold === null || selectedFold === entry.foldIndex ? 1 : 0.4}
            />
          ))}
          <ErrorBar
            dataKey="testUpper"
            direction="y"
            stroke={validationColor}
            strokeWidth={1.5}
          />
        </Bar>
      </ComposedChart>
    </ResponsiveContainer>
  );
}

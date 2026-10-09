import { useTranslation } from 'react-i18next';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { PreprocessingRankingItem, TransferMetricType } from '@/types/transfer';

interface PreprocessingRankingChartProps {
  ranking: PreprocessingRankingItem[];
  metric: TransferMetricType;
}

export function PreprocessingRankingChart({ ranking, metric }: PreprocessingRankingChartProps) {
  const { t } = useTranslation();
  if (ranking.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t('transferAnalysis.charts.noRanking')}
      </div>
    );
  }

  // Prepare data for chart
  const data = ranking.map((item) => ({
    name: item.display_name,
    reduction: item.reduction_pct,
    rawDistance: item.raw_distance,
    ppDistance: item.avg_distance,
  }));

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
    if (active && payload && payload.length) {
      const item = ranking.find((r) => r.display_name === label);
      return (
        <div className="bg-background border rounded-lg shadow-lg p-3 text-sm">
          <p className="font-medium mb-1">{label}</p>
          <p className={payload[0].value > 0 ? 'text-green-600' : 'text-red-600'}>
            {t('transferAnalysis.charts.reductionTooltip', { value: payload[0].value.toFixed(1) })}
          </p>
          {item && (
            <>
              <p className="text-muted-foreground">{t('transferAnalysis.charts.rawTooltip', { value: item.raw_distance.toFixed(4) })}</p>
              <p className="text-muted-foreground">{t('transferAnalysis.charts.preprocessedTooltip', { value: item.avg_distance.toFixed(4) })}</p>
            </>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-4">
      {/* Reduction percentage chart */}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 5, right: 30, left: 100, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis
              type="number"
              domain={['dataMin - 10', 'dataMax + 10']}
              tickFormatter={(v) => `${v}%`}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={95}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => (v.length > 15 ? v.slice(0, 14) + '...' : v)}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine x={0} stroke="#000" strokeWidth={1.5} strokeDasharray="3 3" />
            <Bar dataKey="reduction" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.reduction > 0 ? 'hsl(142, 76%, 36%)' : 'hsl(0, 84%, 60%)'}
                  fillOpacity={0.8}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary text */}
      <div className="text-sm text-muted-foreground">
        <p>
          <strong>{t('transferAnalysis.charts.rankingLabel', { metric: t(metric === 'centroid' ? 'transferAnalysis.metrics.centroid' : 'transferAnalysis.metrics.spread') })}</strong>{' '}
          {t('transferAnalysis.charts.rankingText')}
        </p>
        {ranking.length > 0 && (
          <p className="mt-1">
            {t('transferAnalysis.charts.best')} <span className="font-medium text-foreground">{ranking[0].display_name}</span> (
            {ranking[0].reduction_pct > 0 ? '+' : ''}
            {ranking[0].reduction_pct.toFixed(1)}%)
          </p>
        )}
      </div>
    </div>
  );
}

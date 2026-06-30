import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
  LabelList,
} from 'recharts';
import { formatBiasVarianceTotal } from '@/lib/inspector/biasVariancePresentation';
import type { BiasVarianceBarData } from '@/lib/inspector/biasVarianceData';
import { BiasVarianceTooltip } from './BiasVarianceTooltip';

interface BiasVarianceBarChartProps {
  bars: BiasVarianceBarData[];
  hasSelection: boolean;
  onBarClick: (bar: BiasVarianceBarData | undefined) => void;
}

export function BiasVarianceBarChart({
  bars,
  hasSelection,
  onBarClick,
}: BiasVarianceBarChartProps) {
  return (
    <div className="min-h-0 flex-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={bars} margin={{ top: 20, right: 20, left: 10, bottom: 44 }}>
          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
          <XAxis
            dataKey="group_label"
            tick={{ fontSize: 10, fill: 'currentColor' }}
            angle={-25}
            textAnchor="end"
            height={56}
            interval={0}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'currentColor' }}
            tickFormatter={value => formatBiasVarianceTotal(Number(value))}
            label={{ value: 'Error', angle: -90, position: 'insideLeft', style: { fontSize: 10 } }}
          />
          <RechartsTooltip content={<BiasVarianceTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
          <Bar
            dataKey="bias_squared"
            stackId="error"
            fill="#3b82f6"
            name="Bias²"
            cursor="pointer"
            onClick={(_entry: unknown, index: number) => onBarClick(bars[index])}
            opacity={hasSelection ? 0.95 : 1}
          >
            <LabelList
              dataKey="bias_squared"
              position="top"
              formatter={(value: number) => formatBiasVarianceTotal(value)}
              style={{ fill: 'currentColor', fontSize: 10 }}
            />
          </Bar>
          <Bar
            dataKey="variance"
            stackId="error"
            fill="#f97316"
            name="Variance"
            cursor="pointer"
            onClick={(_entry: unknown, index: number) => onBarClick(bars[index])}
          >
            <LabelList
              dataKey="variance"
              position="top"
              formatter={(value: number) => formatBiasVarianceTotal(value)}
              style={{ fill: 'currentColor', fontSize: 10 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

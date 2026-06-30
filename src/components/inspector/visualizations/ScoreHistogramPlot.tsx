import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import {
  buildScoreHistogramCellStyle,
  type ScoreHistogramBarData,
} from '@/lib/inspector/scoreHistogramData';
import { ScoreHistogramTooltip } from './ScoreHistogramTooltip';

interface ScoreHistogramPlotProps {
  bars: ScoreHistogramBarData[];
  barColors: string[];
  scoreColumn: string | undefined;
  statsSegments: string[];
  meanReference: string | null;
  totalChains: number | null | undefined;
  hasSelection: boolean;
  onBarClick: (bar: ScoreHistogramBarData | undefined) => void;
}

export function ScoreHistogramPlot({
  bars,
  barColors,
  scoreColumn,
  statsSegments,
  meanReference,
  totalChains,
  hasSelection,
  onBarClick,
}: ScoreHistogramPlotProps) {
  return (
    <div className="relative h-full w-full">
      {statsSegments.length > 0 && (
        <div className="absolute left-10 top-1 z-10 rounded bg-card/80 px-2 py-1 text-xs text-muted-foreground">
          {statsSegments.join(' | ')}
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={bars}
          margin={{ top: 20, right: 20, bottom: 30, left: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9 }}
            label={{ value: scoreColumn ?? 'Score', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            label={{ value: 'Count', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
          />
          <RechartsTooltip content={<ScoreHistogramTooltip totalChains={totalChains} />} />

          {meanReference != null && (
            <ReferenceLine
              x={meanReference}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              strokeWidth={1}
            />
          )}

          <Bar
            dataKey="count"
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(_data: unknown, index: number) => onBarClick(bars[index])}
          >
            {bars.map((bar, index) => {
              const style = buildScoreHistogramCellStyle({
                color: barColors[index],
                hasSelection,
                hasSelected: bar.hasSelected,
              });
              return (
                <Cell
                  key={index}
                  fill={style.fill}
                  fillOpacity={style.fillOpacity}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
                />
              );
            })}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { formatPredVsObsSummary } from '@/lib/inspector/predictionDiagnosticsPresentation';
import type { PredVsObsDot, PredVsObsMetrics } from '@/lib/inspector/predVsObsData';
import { PredVsObsRechartsTooltip } from './PredVsObsTooltip';

interface PredVsObsRechartsPlotProps {
  dots: PredVsObsDot[];
  minVal: number;
  maxVal: number;
  metrics: PredVsObsMetrics;
  tickFormatter: (value: number) => string;
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
  hoveredChain: string | null;
  onDotClick: (dot: PredVsObsDot) => void;
  onHoverChainChange: (chainId: string | null) => void;
}

export function PredVsObsRechartsPlot({
  dots,
  minVal,
  maxVal,
  metrics,
  tickFormatter,
  hasSelection,
  selectedChains,
  hoveredChain,
  onDotClick,
  onHoverChainChange,
}: PredVsObsRechartsPlotProps) {
  const summary = formatPredVsObsSummary({ ...metrics, pointCount: dots.length });

  return (
    <div className="relative h-full w-full">
      {summary && (
        <div className="absolute left-10 top-1 z-10 rounded bg-card/80 px-2 py-1 text-xs text-muted-foreground">
          {summary}
        </div>
      )}

      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[minVal, maxVal]}
            name="Observed"
            label={{ value: 'Observed', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={tickFormatter}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[minVal, maxVal]}
            name="Predicted"
            label={{ value: 'Predicted', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={tickFormatter}
            width={45}
          />
          <RechartsTooltip content={<PredVsObsRechartsTooltip />} />

          <ReferenceLine
            segment={[{ x: minVal, y: minVal }, { x: maxVal, y: maxVal }]}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          <Scatter
            data={dots}
            isAnimationActive={false}
            onClick={(_entry: unknown, index: number) => {
              const dot = dots[index];
              if (dot) onDotClick(dot);
            }}
            onMouseEnter={(_entry: unknown, index: number) => {
              const dot = dots[index];
              if (dot) onHoverChainChange(dot.chainId);
            }}
            onMouseLeave={() => onHoverChainChange(null)}
          >
            {dots.map((dot, idx) => {
              const isChainSelected = hasSelection && selectedChains.has(dot.chainId);
              const isChainHovered = hoveredChain === dot.chainId;
              const dimmed = hasSelection && !isChainSelected;

              return (
                <Cell
                  key={idx}
                  fill={dot.color}
                  fillOpacity={dimmed ? 0.15 : isChainHovered ? 1 : 0.7}
                  r={isChainHovered ? 5 : 3}
                  stroke={isChainSelected ? dot.color : 'none'}
                  strokeWidth={isChainSelected ? 1.5 : 0}
                  cursor="pointer"
                />
              );
            })}
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

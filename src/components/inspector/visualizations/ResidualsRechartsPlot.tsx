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
import {
  getResidualPointStyle,
  type ResidualDot,
} from '@/lib/inspector/residualsData';
import { formatResidualSummary } from '@/lib/inspector/predictionDiagnosticsPresentation';
import { ResidualsRechartsTooltip } from './ResidualsTooltip';

interface ResidualsRechartsPlotProps {
  dots: ResidualDot[];
  meanResidual: number;
  stdResidual: number;
  xTickFormatter: (value: number) => string;
  yTickFormatter: (value: number) => string;
  hasSelection: boolean;
  selectedChains: ReadonlySet<string>;
  hoveredChain: string | null;
  getChainColor: (chainId: string) => string;
  getChainOpacity: (chainId: string) => number;
  onDotClick: (dot: ResidualDot) => void;
  onHoverChainChange: (chainId: string | null) => void;
}

export function ResidualsRechartsPlot({
  dots,
  meanResidual,
  stdResidual,
  xTickFormatter,
  yTickFormatter,
  hasSelection,
  selectedChains,
  hoveredChain,
  getChainColor,
  getChainOpacity,
  onDotClick,
  onHoverChainChange,
}: ResidualsRechartsPlotProps) {
  const band2Sigma = stdResidual * 2;

  return (
    <div className="relative h-full w-full">
      <div className="absolute left-10 top-1 z-10 rounded bg-card/80 px-2 py-1 text-xs text-muted-foreground">
        {formatResidualSummary({ meanResidual, stdResidual, pointCount: dots.length })}
      </div>

      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 50 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            name="Predicted"
            label={{ value: 'Predicted', position: 'insideBottom', offset: -10, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={xTickFormatter}
          />
          <YAxis
            type="number"
            dataKey="y"
            name="Residual"
            label={{ value: 'Residual', angle: -90, position: 'insideLeft', offset: -5, style: { fontSize: 12, fill: '#94a3b8' } }}
            tick={{ fontSize: 10 }}
            tickFormatter={yTickFormatter}
            width={45}
          />
          <RechartsTooltip content={<ResidualsRechartsTooltip stdResidual={stdResidual} />} />

          <ReferenceLine y={0} stroke="#94a3b8" strokeWidth={1.5} />

          {stdResidual > 0 && (
            <>
              <ReferenceLine y={band2Sigma} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
              <ReferenceLine y={-band2Sigma} stroke="#f59e0b" strokeDasharray="4 4" strokeWidth={1} />
            </>
          )}

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
              const style = getResidualPointStyle({
                dot,
                getChainColor,
                getChainOpacity,
                hoveredChain,
                hasSelection,
                selectedChains,
              });

              return (
                <Cell
                  key={idx}
                  fill={style.color}
                  fillOpacity={style.opacity}
                  r={style.radius}
                  stroke={style.stroke}
                  strokeWidth={style.strokeWidth}
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

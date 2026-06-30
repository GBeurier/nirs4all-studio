import type { RepetitionQuantileValue } from '@/lib/playground/repetitionsChartData';
import type { DiffScaleType } from '@/lib/playground/spectraConfig';
import type { DataBounds } from './scatter';
import { REPETITION_QUANTILE_COLORS } from './repetitionsChartStyles';

export interface RepetitionsWebglOverlaysProps {
  bounds: DataBounds;
  scaleType: DiffScaleType;
  xTicks: number[];
  bioSampleCount: number;
  showGrid: boolean;
  quantileValues: RepetitionQuantileValue[];
  formatXAxisTick: (value: number) => string;
}

function buildEvenTicks(min: number, max: number, tickCount = 5): number[] {
  const range = max - min;
  const ticks: number[] = [];
  for (let index = 0; index <= tickCount; index++) {
    ticks.push(min + (range * index) / tickCount);
  }
  return ticks;
}

function toXPercent(value: number, bounds: DataBounds): number {
  return ((value - bounds.minX) / (bounds.maxX - bounds.minX)) * 100;
}

function toYPercent(value: number, bounds: DataBounds): number {
  return ((bounds.maxY - value) / (bounds.maxY - bounds.minY)) * 100;
}

function isVisiblePercent(percent: number): boolean {
  return percent >= 0 && percent <= 100;
}

export function RepetitionsWebglOverlays({
  bounds,
  scaleType,
  xTicks,
  bioSampleCount,
  showGrid,
  quantileValues,
  formatXAxisTick,
}: RepetitionsWebglOverlaysProps) {
  const yTicks = buildEvenTicks(bounds.minY, bounds.maxY);
  const sampleIndices = Array.from({ length: bioSampleCount }, (_, sampleIndex) => sampleIndex);

  return (
    <>
      <div className="absolute left-0 top-0 bottom-6 w-10 pointer-events-none z-[6] flex flex-col justify-between py-1">
        <div className="absolute -left-1 top-1/2 -translate-y-1/2 -rotate-90 origin-center text-[9px] text-muted-foreground whitespace-nowrap">
          {scaleType === 'log' ? 'log(1 + Distance)' : 'Distance'}
        </div>
        {yTicks.map((tick, index) => (
          <div
            key={`y-tick-${index}`}
            className="absolute right-1 text-[9px] text-muted-foreground"
            style={{ top: `${toYPercent(tick, bounds)}%`, transform: 'translateY(-50%)' }}
          >
            {tick.toFixed(2)}
          </div>
        ))}
      </div>

      <div className="absolute left-10 right-0 bottom-0 h-6 pointer-events-none z-[6]">
        {xTicks.map((sampleIndex) => {
          const xPercent = toXPercent(sampleIndex, bounds);
          if (!isVisiblePercent(xPercent)) return null;
          return (
            <div
              key={`x-label-${sampleIndex}`}
              className="absolute text-[9px] text-muted-foreground"
              style={{ left: `${xPercent}%`, transform: 'translateX(-50%)' }}
            >
              {formatXAxisTick(sampleIndex)}
            </div>
          );
        })}
      </div>

      <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[3]">
        <div className="absolute left-0 top-0 bottom-0 border-l border-muted-foreground/50" />
        <div className="absolute left-0 right-0 bottom-0 border-b border-muted-foreground/50" />
      </div>

      {showGrid && (
        <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[4]">
          {sampleIndices.map((sampleIndex) => {
            const xPercent = toXPercent(sampleIndex, bounds);
            if (!isVisiblePercent(xPercent)) return null;
            return (
              <div
                key={`sample-grid-${sampleIndex}`}
                className="absolute top-0 bottom-0 border-l border-dashed opacity-30"
                style={{
                  left: `${xPercent}%`,
                  borderColor: 'currentColor',
                }}
              />
            );
          })}
          {yTicks.map((tick, index) => (
            <div
              key={`h-grid-${index}`}
              className="absolute left-0 right-0 border-t border-dashed opacity-30"
              style={{
                top: `${toYPercent(tick, bounds)}%`,
                borderColor: 'currentColor',
              }}
            />
          ))}
        </div>
      )}

      {quantileValues.length > 0 && (
        <div className="absolute left-10 right-0 top-0 bottom-6 pointer-events-none z-[5]">
          {quantileValues.map(({ quantile, value }) => {
            const yPercent = toYPercent(value, bounds);
            if (!isVisiblePercent(yPercent)) return null;
            return (
              <div
                key={`quantile-line-${quantile}`}
                className="absolute left-0 right-0 border-t-2 border-dashed"
                style={{
                  top: `${yPercent}%`,
                  borderColor: REPETITION_QUANTILE_COLORS[quantile],
                }}
              >
                <span
                  className="absolute right-1 -top-3 text-[9px] font-medium"
                  style={{ color: REPETITION_QUANTILE_COLORS[quantile] }}
                >
                  P{quantile}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

import type {
  ColorContext,
  GlobalColorConfig,
} from '@/lib/playground/colorConfig';
import type { SpectraDifferenceStats } from '@/lib/playground/spectraChartData';
import { InlineColorLegend } from '../ColorLegend';

export interface SpectraChartLegendItem {
  label: string;
  color: string;
  dashed?: boolean;
  isArea?: boolean;
}

export interface SpectraChartFooterProps {
  legendItems: SpectraChartLegendItem[];
  selectedCount: number;
  globalColorConfig?: GlobalColorConfig;
  colorContext?: ColorContext;
  differenceStats: SpectraDifferenceStats | null;
  brushDomain: [number, number] | null;
  wavelengthUnitSuffix: string;
}

export function SpectraChartFooter({
  legendItems,
  selectedCount,
  globalColorConfig,
  colorContext,
  differenceStats,
  brushDomain,
  wavelengthUnitSuffix,
}: SpectraChartFooterProps) {
  return (
    <div className="flex items-center justify-between mt-2 text-[10px] text-muted-foreground">
      <div className="flex items-center gap-3">
        {legendItems.map((item, idx) => (
          <span key={idx} className="flex items-center gap-1">
            {item.isArea ? (
              <span className="w-3 h-2 opacity-30" style={{ backgroundColor: item.color }} />
            ) : (
              <span
                className={`w-3 h-0.5 ${item.dashed ? 'border-t border-dashed' : ''}`}
                style={item.dashed ? { borderColor: item.color } : { backgroundColor: item.color }}
              />
            )}
            {item.label}
          </span>
        ))}
        {selectedCount > 0 && (
          <span className="text-primary font-medium">
            • {selectedCount} selected
          </span>
        )}
        {globalColorConfig && colorContext && (
          <InlineColorLegend config={globalColorConfig} context={colorContext} />
        )}
      </div>
      <div className="flex items-center gap-3">
        {differenceStats && (
          <span className="font-mono text-orange-600 dark:text-orange-400">
            MAD: {differenceStats.meanAbsDiff.toExponential(2)} |
            Max: {differenceStats.maxAbsDiff.toExponential(2)} |
            RMSE: {differenceStats.rmse.toExponential(2)}
          </span>
        )}
        {brushDomain && (
          <span>
            Zoom: {brushDomain[0].toFixed(0)} - {brushDomain[1].toFixed(0)}{wavelengthUnitSuffix}
          </span>
        )}
      </div>
    </div>
  );
}

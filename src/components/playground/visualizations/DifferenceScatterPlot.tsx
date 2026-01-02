import { useMemo, useRef, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ZAxis,
  Cell,
} from 'recharts';
import { ProcessedData, DifferenceMetric, ColorConfig } from '@/types/spectral';
import { GitCompare, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exportChart } from '@/lib/chartExport';
import { getSampleColor } from '@/lib/colorUtils';

interface DifferenceScatterPlotProps {
  data: ProcessedData;
  onSelectSample?: (index: number) => void;
  selectedSample?: number | null;
  colorConfig: ColorConfig;
}

function computeDifferenceMetric(
  spectrum1: number[],
  spectrum2: number[],
  metric: DifferenceMetric
): number {
  const n = spectrum1.length;

  switch (metric) {
    case 'rmse': {
      const sumSq = spectrum1.reduce((acc, v, i) => acc + Math.pow(v - spectrum2[i], 2), 0);
      return Math.sqrt(sumSq / n);
    }
    case 'mae': {
      const sumAbs = spectrum1.reduce((acc, v, i) => acc + Math.abs(v - spectrum2[i]), 0);
      return sumAbs / n;
    }
    case 'maxDiff': {
      return Math.max(...spectrum1.map((v, i) => Math.abs(v - spectrum2[i])));
    }
    case 'meanDiff': {
      const sumDiff = spectrum1.reduce((acc, v, i) => acc + (v - spectrum2[i]), 0);
      return sumDiff / n;
    }
    case 'correlation': {
      const mean1 = spectrum1.reduce((a, b) => a + b, 0) / n;
      const mean2 = spectrum2.reduce((a, b) => a + b, 0) / n;
      const num = spectrum1.reduce((acc, v, i) => acc + (v - mean1) * (spectrum2[i] - mean2), 0);
      const den1 = Math.sqrt(spectrum1.reduce((acc, v) => acc + Math.pow(v - mean1, 2), 0));
      const den2 = Math.sqrt(spectrum2.reduce((acc, v) => acc + Math.pow(v - mean2, 2), 0));
      return den1 * den2 > 0 ? num / (den1 * den2) : 0;
    }
    default:
      return 0;
  }
}

const metricLabels: Record<DifferenceMetric, string> = {
  rmse: 'RMSE',
  mae: 'MAE',
  maxDiff: 'Max Diff',
  meanDiff: 'Mean Diff',
  correlation: 'Correlation',
};

export function DifferenceScatterPlot({
  data,
  onSelectSample,
  selectedSample,
  colorConfig
}: DifferenceScatterPlotProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [metric, setMetric] = useState<DifferenceMetric>('rmse');

  const chartData = useMemo(() => {
    return data.spectra.map((spectrum, i) => ({
      index: i,
      sampleId: data.sampleIds?.[i] || `${i + 1}`,
      y: data.y[i],
      diff: computeDifferenceMetric(spectrum, data.originalSpectra[i], metric),
      dataset: data.datasetSource?.[i] || 'default',
    }));
  }, [data, metric]);

  const handleClick = (point: unknown) => {
    const p = point as { index?: number };
    if (p?.index !== undefined && onSelectSample) {
      onSelectSample(p.index);
    }
  };

  const handleExport = () => {
    exportChart(chartRef.current, chartData.map(d => ({
      sample: d.sampleId,
      y: d.y,
      [metric]: d.diff,
      dataset: d.dataset,
    })), `difference_${metric}`);
  };

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <GitCompare className="w-4 h-4 text-primary" />
          Difference
        </h3>
        <div className="flex items-center gap-1.5">
          <Select value={metric} onValueChange={(v) => setMetric(v as DifferenceMetric)}>
            <SelectTrigger className="h-7 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(metricLabels).map(([key, label]) => (
                <SelectItem key={key} value={key}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="index"
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              label={{ value: 'Sample Index', position: 'bottom', offset: -5, fontSize: 10 }}
            />
            <YAxis
              dataKey="diff"
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              width={50}
              tickFormatter={(v) => v.toExponential(1)}
              label={{ value: metricLabels[metric], angle: -90, position: 'insideLeft', fontSize: 10 }}
            />
            <ZAxis range={[30, 50]} />
            <Scatter data={chartData} onClick={handleClick} cursor="pointer">
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getSampleColor(entry.index, data, colorConfig, selectedSample ?? null)}
                  stroke={selectedSample === entry.index ? 'hsl(var(--foreground))' : 'none'}
                  strokeWidth={selectedSample === entry.index ? 2 : 0}
                />
              ))}
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

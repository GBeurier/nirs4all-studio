import { useMemo, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { ProcessedData } from '@/types/spectral';
import { BarChart3, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportChart } from '@/lib/chartExport';

interface YHistogramProps {
  data: ProcessedData;
  bins?: number;
  onSelectSample?: (index: number) => void;
  selectedSample?: number | null;
}

export function YHistogram({ data, bins = 20, onSelectSample, selectedSample }: YHistogramProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  const { histogramData, sampleBins } = useMemo(() => {
    const values = data.y;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const binWidth = (max - min) / bins || 1;

    const histogram = Array.from({ length: bins }, (_, i) => ({
      binStart: min + i * binWidth,
      binEnd: min + (i + 1) * binWidth,
      binCenter: min + (i + 0.5) * binWidth,
      count: 0,
      samples: [] as number[],
    }));

    const sampleToBin: number[] = [];
    values.forEach((v, idx) => {
      const binIndex = Math.min(Math.floor((v - min) / binWidth), bins - 1);
      if (binIndex >= 0 && binIndex < bins) {
        histogram[binIndex].count++;
        histogram[binIndex].samples.push(idx);
        sampleToBin[idx] = binIndex;
      }
    });

    return { histogramData: histogram, sampleBins: sampleToBin };
  }, [data.y, bins]);

  const stats = useMemo(() => {
    const values = data.y;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const std = Math.sqrt(values.reduce((acc, v) => acc + Math.pow(v - mean, 2), 0) / values.length);
    return { mean, median, std, min: sorted[0], max: sorted[sorted.length - 1] };
  }, [data.y]);

  const selectedBin = selectedSample !== null && selectedSample !== undefined ? sampleBins[selectedSample] : null;

  const handleClick = (clickData: unknown) => {
    const d = clickData as { samples?: number[] };
    if (d?.samples?.length && onSelectSample) {
      onSelectSample(d.samples[0]);
    }
  };

  const handleExport = () => {
    exportChart(chartRef.current, histogramData.map(h => ({
      binCenter: h.binCenter,
      count: h.count
    })), 'y_histogram');
  };

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          Y Distribution
        </h3>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
          <Download className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={histogramData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="binCenter" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => v.toFixed(1)} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} width={30} />
            <Bar dataKey="count" radius={[2, 2, 0, 0]} onClick={handleClick} cursor="pointer">
              {histogramData.map((_, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={selectedBin === index ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.6)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-5 gap-1 mt-2 text-[10px]">
        {[
          { label: 'Mean', value: stats.mean },
          { label: 'Med', value: stats.median },
          { label: 'Std', value: stats.std },
          { label: 'Min', value: stats.min },
          { label: 'Max', value: stats.max },
        ].map(({ label, value }) => (
          <div key={label} className="bg-muted rounded p-1 text-center">
            <div className="text-muted-foreground">{label}</div>
            <div className="font-mono font-medium">{value.toFixed(1)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

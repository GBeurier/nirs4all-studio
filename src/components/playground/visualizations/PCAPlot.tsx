import { useMemo, useRef } from 'react';
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
import { ProcessedData, ColorConfig } from '@/types/spectral';
import { Orbit, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { exportChart } from '@/lib/chartExport';
import { getSampleColor } from '@/lib/colorUtils';

interface PCAPlotProps {
  data: ProcessedData;
  onSelectSample?: (index: number) => void;
  selectedSample?: number | null;
  colorConfig: ColorConfig;
}

function computePCA(matrix: number[][]): { scores: [number, number][], variance: [number, number] } {
  const n = matrix.length;
  const m = matrix[0].length;

  const means = Array.from({ length: m }, (_, j) => matrix.reduce((sum, row) => sum + row[j], 0) / n);
  const centered = matrix.map(row => row.map((val, j) => val - means[j]));

  const cov: number[][] = [];
  for (let i = 0; i < n; i++) {
    cov[i] = [];
    for (let j = 0; j < n; j++) {
      cov[i][j] = centered[i].reduce((sum, val, k) => sum + val * centered[j][k], 0) / (m - 1);
    }
  }

  let v1 = Array.from({ length: n }, () => Math.random());
  for (let iter = 0; iter < 50; iter++) {
    const newV = cov.map(row => row.reduce((sum, val, i) => sum + val * v1[i], 0));
    const norm = Math.sqrt(newV.reduce((sum, val) => sum + val * val, 0));
    v1 = newV.map(val => val / norm);
  }

  const pc1 = v1;
  const var1 = cov.reduce((sum, row, i) => sum + row.reduce((s, val, j) => s + val * pc1[i] * pc1[j], 0), 0);

  const deflated = cov.map((row, i) => row.map((val, j) => val - var1 * pc1[i] * pc1[j]));

  let v2 = Array.from({ length: n }, () => Math.random());
  for (let iter = 0; iter < 50; iter++) {
    const newV = deflated.map(row => row.reduce((sum, val, i) => sum + val * v2[i], 0));
    const norm = Math.sqrt(newV.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) v2 = newV.map(val => val / norm);
  }

  const var2 = deflated.reduce((sum, row, i) => sum + row.reduce((s, val, j) => s + val * v2[i] * v2[j], 0), 0);
  const totalVar = var1 + var2 + 0.001;
  const scores: [number, number][] = matrix.map((_, i) => [pc1[i] * Math.sqrt(Math.abs(var1)), v2[i] * Math.sqrt(Math.abs(var2))]);

  return { scores, variance: [var1 / totalVar * 100, var2 / totalVar * 100] };
}

export function PCAPlot({ data, onSelectSample, selectedSample, colorConfig }: PCAPlotProps) {
  const chartRef = useRef<HTMLDivElement>(null);

  const pcaResult = useMemo(() => {
    if (data.spectra.length < 3) return null;
    return computePCA(data.spectra);
  }, [data.spectra]);

  const chartData = useMemo(() => {
    if (!pcaResult) return [];
    return pcaResult.scores.map(([pc1, pc2], i) => ({
      pc1, pc2, y: data.y[i], name: data.sampleIds?.[i] || `Sample ${i + 1}`, index: i,
    }));
  }, [pcaResult, data]);

  const handleClick = (point: unknown) => {
    const p = point as { index?: number };
    if (p?.index !== undefined && onSelectSample) {
      onSelectSample(p.index);
    }
  };

  const handleExport = () => {
    exportChart(chartRef.current, chartData.map(d => ({
      sample: d.name, pc1: d.pc1, pc2: d.pc2, y: d.y,
    })), 'pca_scores');
  };

  if (!pcaResult) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        Need at least 3 samples for PCA
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Orbit className="w-4 h-4 text-primary" />
          PCA Scores
        </h3>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
          <Download className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis
              dataKey="pc1"
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              name="PC1"
              label={{ value: `PC1 (${pcaResult.variance[0].toFixed(0)}%)`, position: 'bottom', offset: -5, fontSize: 10 }}
            />
            <YAxis
              dataKey="pc2"
              type="number"
              stroke="hsl(var(--muted-foreground))"
              fontSize={10}
              width={40}
              name="PC2"
              label={{ value: `PC2 (${pcaResult.variance[1].toFixed(0)}%)`, angle: -90, position: 'insideLeft', fontSize: 10 }}
            />
            <ZAxis range={[40, 60]} />
            <Scatter data={chartData} onClick={handleClick} cursor="pointer">
              {chartData.map((entry) => (
                <Cell
                  key={`cell-${entry.index}`}
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

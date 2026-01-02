import { useMemo, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Brush,
} from 'recharts';
import { ProcessedData, SubsetMode, ColorConfig } from '@/types/spectral';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Eye, EyeOff, Layers, Download } from 'lucide-react';
import { getSubsetIndices } from '@/lib/subsetMethods';
import { exportChart } from '@/lib/chartExport';
import { getSampleColor } from '@/lib/colorUtils';

interface SpectraChartProps {
  data: ProcessedData;
  showOriginal?: boolean;
  maxSamples?: number;
  onSelectSample?: (index: number) => void;
  selectedSample?: number | null;
  colorConfig: ColorConfig;
}

export function SpectraChart({
  data,
  showOriginal = false,
  maxSamples = 50,
  onSelectSample,
  selectedSample,
  colorConfig
}: SpectraChartProps) {
  const [showProcessed, setShowProcessed] = useState(true);
  const [showOrig, setShowOrig] = useState(showOriginal);
  const [subsetMode, setSubsetMode] = useState<SubsetMode>('all');
  const chartRef = useRef<HTMLDivElement>(null);

  const subsetIndices = useMemo(() => {
    return getSubsetIndices(data.spectra, data.y, subsetMode, maxSamples);
  }, [data.spectra, data.y, subsetMode, maxSamples]);

  const chartData = useMemo(() => {
    return data.wavelengths.map((wavelength, wIdx) => {
      const point: Record<string, number> = { wavelength };

      subsetIndices.forEach((sIdx) => {
        if (showProcessed && data.spectra[sIdx]) {
          point[`s${sIdx}`] = data.spectra[sIdx][wIdx];
        }
        if (showOrig && data.originalSpectra[sIdx]) {
          point[`o${sIdx}`] = data.originalSpectra[sIdx][wIdx];
        }
      });

      return point;
    });
  }, [data, showProcessed, showOrig, subsetIndices]);

  const getColor = (index: number, isOriginal: boolean) => {
    const baseColor = getSampleColor(index, data, colorConfig, selectedSample ?? null);
    if (isOriginal && selectedSample !== index) {
      // Desaturate original spectra
      return baseColor.replace(/70%/, '40%').replace(/50%/, '60%');
    }
    return baseColor;
  };

  const handleClick = (e: unknown) => {
    const event = e as { activePayload?: Array<{ dataKey: string }> };
    if (event?.activePayload?.[0]?.dataKey && onSelectSample) {
      const key = event.activePayload[0].dataKey as string;
      const match = key.match(/[so](\d+)/);
      if (match) {
        onSelectSample(parseInt(match[1], 10));
      }
    }
  };

  const handleExport = () => {
    const csvData = data.wavelengths.map((wl, i) => {
      const row: Record<string, number> = { wavelength: wl };
      subsetIndices.forEach(sIdx => {
        row[`sample_${sIdx}`] = data.spectra[sIdx][i];
      });
      return row;
    });
    exportChart(chartRef.current, csvData, 'spectra');
  };

  return (
    <div className="h-full flex flex-col" ref={chartRef}>
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Layers className="w-4 h-4 text-primary" />
          Spectra ({subsetIndices.length}/{data.spectra.length})
        </h3>
        <div className="flex items-center gap-1.5">
          <Select value={subsetMode} onValueChange={(v) => setSubsetMode(v as SubsetMode)}>
            <SelectTrigger className="h-7 w-24 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="random">Random</SelectItem>
              <SelectItem value="quantiles">Quantiles</SelectItem>
              <SelectItem value="kmeans">K-means</SelectItem>
            </SelectContent>
          </Select>
          <Button variant={showOrig ? "default" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setShowOrig(!showOrig)}>
            {showOrig ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          </Button>
          <Button variant={showProcessed ? "default" : "ghost"} size="sm" className="h-7 text-xs px-2" onClick={() => setShowProcessed(!showProcessed)}>
            <span className="text-[10px]">P</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={handleExport}>
            <Download className="w-3 h-3" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }} onClick={handleClick}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
            <XAxis dataKey="wavelength" stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => v.toFixed(0)} />
            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={(v) => v.toFixed(2)} width={45} />
            <Brush dataKey="wavelength" height={15} stroke="hsl(var(--primary))" fill="hsl(var(--muted))" />

            {showOrig && subsetIndices.map((sIdx) => (
              <Line
                key={`orig-${sIdx}`}
                type="monotone"
                dataKey={`o${sIdx}`}
                stroke={getColor(sIdx, true)}
                strokeWidth={selectedSample === sIdx ? 2.5 : 1}
                strokeDasharray="4 2"
                dot={false}
                isAnimationActive={false}
              />
            ))}

            {showProcessed && subsetIndices.map((sIdx) => (
              <Line
                key={`proc-${sIdx}`}
                type="monotone"
                dataKey={`s${sIdx}`}
                stroke={getColor(sIdx, false)}
                strokeWidth={selectedSample === sIdx ? 2.5 : 1}
                dot={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { ProcessedData, ColorConfig } from '@/types/spectral';
import { SpectraChart, YHistogram, PCAPlot, DifferenceScatterPlot, FoldBoxPlots } from './visualizations';
import { SampleDetails } from './SampleDetails';
import { ColorModeSelector } from './ColorModeSelector';
import { FlaskConical, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface MainCanvasProps {
  data: ProcessedData | null;
}

type ChartType = 'spectra' | 'histogram' | 'folds' | 'pca' | 'difference';

const chartConfig: { id: ChartType; label: string }[] = [
  { id: 'spectra', label: 'Spectra' },
  { id: 'histogram', label: 'Y Hist' },
  { id: 'folds', label: 'Folds' },
  { id: 'pca', label: 'PCA' },
  { id: 'difference', label: 'Diff' },
];

export function MainCanvas({ data }: MainCanvasProps) {
  const [visibleCharts, setVisibleCharts] = useState<Set<ChartType>>(
    new Set(['spectra', 'histogram', 'pca', 'difference'])
  );
  const [selectedSample, setSelectedSample] = useState<number | null>(null);
  const [colorConfig, setColorConfig] = useState<ColorConfig>({ mode: 'target' });

  const toggleChart = (chart: ChartType) => {
    setVisibleCharts(prev => {
      const next = new Set(prev);
      if (next.has(chart)) {
        next.delete(chart);
      } else {
        next.add(chart);
      }
      return next;
    });
  };

  if (!data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <FlaskConical className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-semibold text-foreground mb-2">
            NIR Preprocessing Playground
          </h2>
          <p className="text-muted-foreground mb-4">
            Load your spectral data to start experimenting with preprocessing transformations.
          </p>
          <div className="text-sm text-muted-foreground">
            <p className="font-medium mb-2">Expected format:</p>
            <ul className="text-left space-y-1 pl-4">
              <li>• First row: wavelength values</li>
              <li>• Each row: one sample's spectrum</li>
              <li>• Optional Y/Target column</li>
            </ul>
          </div>
        </div>
      </div>
    );
  }

  const visibleCount = visibleCharts.size;
  const gridCols = visibleCount === 1 ? 'grid-cols-1' : visibleCount <= 2 ? 'grid-cols-2' : 'grid-cols-2';
  const gridRows = visibleCount <= 2 ? 'grid-rows-1' : visibleCount <= 4 ? 'grid-rows-2' : 'grid-rows-3';

  return (
    <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
      {selectedSample !== null && (
        <SampleDetails
          data={data}
          sampleIndex={selectedSample}
          onClose={() => setSelectedSample(null)}
        />
      )}

      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border bg-card/50">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground mr-1">Show:</span>
          {chartConfig.map(({ id, label }) => {
            const isVisible = visibleCharts.has(id);
            return (
              <Button
                key={id}
                variant={isVisible ? 'secondary' : 'ghost'}
                size="sm"
                className={cn('h-6 text-[10px] gap-1 px-2', !isVisible && 'opacity-50')}
                onClick={() => toggleChart(id)}
              >
                {isVisible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                {label}
              </Button>
            );
          })}
        </div>
        <ColorModeSelector colorConfig={colorConfig} onChange={setColorConfig} data={data} />
      </div>

      <div className={cn('flex-1 p-3 overflow-auto grid gap-3', gridCols, gridRows)}>
        {visibleCharts.has('spectra') && (
          <div className="bg-card rounded-lg border border-border p-3 min-h-[250px]">
            <SpectraChart
              data={data}
              showOriginal
              maxSamples={30}
              onSelectSample={setSelectedSample}
              selectedSample={selectedSample}
              colorConfig={colorConfig}
            />
          </div>
        )}
        {visibleCharts.has('histogram') && (
          <div className="bg-card rounded-lg border border-border p-3 min-h-[250px]">
            <YHistogram
              data={data}
              onSelectSample={setSelectedSample}
              selectedSample={selectedSample}
            />
          </div>
        )}
        {visibleCharts.has('folds') && (
          <div className="bg-card rounded-lg border border-border p-3 min-h-[250px]">
            <FoldBoxPlots data={data} />
          </div>
        )}
        {visibleCharts.has('pca') && (
          <div className="bg-card rounded-lg border border-border p-3 min-h-[250px]">
            <PCAPlot
              data={data}
              onSelectSample={setSelectedSample}
              selectedSample={selectedSample}
              colorConfig={colorConfig}
            />
          </div>
        )}
        {visibleCharts.has('difference') && (
          <div className="bg-card rounded-lg border border-border p-3 min-h-[250px]">
            <DifferenceScatterPlot
              data={data}
              onSelectSample={setSelectedSample}
              selectedSample={selectedSample}
              colorConfig={colorConfig}
            />
          </div>
        )}
      </div>
    </div>
  );
}

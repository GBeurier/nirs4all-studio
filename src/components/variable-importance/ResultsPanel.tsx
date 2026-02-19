import { useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Droplets, List, Clock, Hash, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { BinningControls } from './BinningControls';
import { SpectralImportanceChart } from './visualizations/SpectralImportanceChart';
import { BeeswarmChart } from './visualizations/BeeswarmChart';
import { WaterfallChart } from './visualizations/WaterfallChart';
import { FeatureImportanceBar } from './visualizations/FeatureImportanceBar';
import { PredictionScatter } from './visualizations/PredictionScatter';
import type { ShapResultsResponse, ShapTab, BinnedImportanceData } from '@/types/shap';

interface ResultsPanelProps {
  results: ShapResultsResponse;
  jobId: string;
  activeTab: ShapTab;
  onTabChange: (tab: ShapTab) => void;
  selectedSamples: number[];
  onSamplesChange: (samples: number[]) => void;
}

export function ResultsPanel({
  results,
  jobId,
  activeTab,
  onTabChange,
  selectedSamples,
  onSamplesChange,
}: ResultsPanelProps) {
  const { t } = useTranslation();

  // Rebinned data lives here — only updated when "Rebin" is clicked
  const [rebinnedData, setRebinnedData] = useState<BinnedImportanceData | null>(null);

  const handleBinnedDataUpdate = useCallback((data: BinnedImportanceData) => {
    setRebinnedData(data);
  }, []);

  // Active sample index for waterfall (first selected sample, or 0)
  const waterfallSampleIdx = selectedSamples.length > 0 ? selectedSamples[0] : 0;

  const handleWaterfallSampleChange = useCallback(
    (idx: number) => {
      onSamplesChange([idx]);
    },
    [onSamplesChange],
  );

  // Stable toggle callback for beeswarm
  const handleBeeswarmSelect = useCallback(
    (sampleIdx: number) => {
      onSamplesChange((prev: number[]) => {
        const set = new Set(prev);
        if (set.has(sampleIdx)) set.delete(sampleIdx);
        else set.add(sampleIdx);
        return Array.from(set).sort((a, b) => a - b);
      });
    },
    [onSamplesChange],
  );

  // Memoize initial binning params to avoid re-init on re-render
  const initialBinParams = useMemo(() => ({
    binSize: results.binned_importance.bin_size,
    binStride: results.binned_importance.bin_stride,
    aggregation: results.binned_importance.aggregation,
  }), [results.binned_importance.bin_size, results.binned_importance.bin_stride, results.binned_importance.aggregation]);

  const activeBinnedData = rebinnedData ?? undefined;

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            {t('shap.results.title', 'SHAP Analysis Results')}
          </CardTitle>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="secondary" className="flex items-center gap-1">
              <Hash className="h-3 w-3" />
              {results.n_samples} {t('shap.results.samples', 'samples')}
            </Badge>
            <Badge variant="secondary" className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {results.explainer_type}
            </Badge>
            <Badge variant="outline" className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {results.execution_time_ms.toFixed(0)}ms
            </Badge>
          </div>
        </div>

        {/* Binning controls bar */}
        <div className="pt-2 border-t mt-2">
          <BinningControls
            jobId={jobId}
            initialBinSize={initialBinParams.binSize}
            initialBinStride={initialBinParams.binStride}
            initialAggregation={initialBinParams.aggregation}
            onBinnedDataUpdate={handleBinnedDataUpdate}
          />
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Prediction scatter — horizontal compact panel */}
        <div className="h-[220px] border rounded-lg p-3">
          <PredictionScatter
            jobId={jobId}
            selectedSamples={selectedSamples}
            onSamplesChange={onSamplesChange}
          />
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(value) => onTabChange(value as ShapTab)}
        >
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="spectral" className="flex items-center gap-1">
              <Activity className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t('shap.tabs.spectral', 'Spectral')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="beeswarm" className="flex items-center gap-1">
              <Droplets className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t('shap.tabs.beeswarm', 'Beeswarm')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="waterfall" className="flex items-center gap-1">
              <BarChart3 className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t('shap.tabs.waterfall', 'Waterfall')}
              </span>
            </TabsTrigger>
            <TabsTrigger value="ranking" className="flex items-center gap-1">
              <List className="h-4 w-4" />
              <span className="hidden sm:inline">
                {t('shap.tabs.ranking', 'Ranking')}
              </span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="spectral" className="mt-4">
            <div className="h-[500px]">
              <SpectralImportanceChart
                jobId={jobId}
                results={results}
                binnedData={activeBinnedData}
                selectedSamples={selectedSamples}
              />
            </div>
          </TabsContent>

          <TabsContent value="beeswarm" className="mt-4">
            <div className="h-[500px]">
              <BeeswarmChart
                jobId={jobId}
                onSampleSelect={handleBeeswarmSelect}
                selectedSamples={selectedSamples}
              />
            </div>
          </TabsContent>

          <TabsContent value="waterfall" className="mt-4">
            <div className="h-[500px]">
              <WaterfallChart
                jobId={jobId}
                sampleIdx={waterfallSampleIdx}
                totalSamples={results.n_samples}
                onSampleChange={handleWaterfallSampleChange}
              />
            </div>
          </TabsContent>

          <TabsContent value="ranking" className="mt-4">
            <div className="h-[500px]">
              <FeatureImportanceBar
                results={results}
                binnedData={activeBinnedData}
              />
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

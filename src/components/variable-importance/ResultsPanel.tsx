import { useState, useCallback } from 'react';
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
import type { ShapResultsResponse, ShapTab, BinAggregation, BinnedImportanceData } from '@/types/shap';

interface ResultsPanelProps {
  results: ShapResultsResponse;
  jobId: string;
  activeTab: ShapTab;
  onTabChange: (tab: ShapTab) => void;
  selectedSamples: number[];
  onSamplesChange: (samples: number[]) => void;
  binSize: number;
  binStride: number;
  binAggregation: BinAggregation;
  onBinSizeChange: (size: number) => void;
  onBinStrideChange: (stride: number) => void;
  onBinAggregationChange: (agg: BinAggregation) => void;
}

export function ResultsPanel({
  results,
  jobId,
  activeTab,
  onTabChange,
  selectedSamples,
  onSamplesChange,
  binSize,
  binStride,
  binAggregation,
  onBinSizeChange,
  onBinStrideChange,
  onBinAggregationChange,
}: ResultsPanelProps) {
  const { t } = useTranslation();

  // Local binned data state for dynamic rebinning
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

  const handleBeeswarmSelect = useCallback(
    (sampleIdx: number) => {
      const current = new Set(selectedSamples);
      if (current.has(sampleIdx)) {
        current.delete(sampleIdx);
      } else {
        current.add(sampleIdx);
      }
      onSamplesChange(Array.from(current).sort((a, b) => a - b));
    },
    [selectedSamples, onSamplesChange],
  );

  return (
    <div className="flex gap-4 h-full">
      {/* Main results area */}
      <Card className="flex-1 min-w-0">
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
              binSize={binSize}
              binStride={binStride}
              binAggregation={binAggregation}
              onBinSizeChange={onBinSizeChange}
              onBinStrideChange={onBinStrideChange}
              onBinAggregationChange={onBinAggregationChange}
              onBinnedDataUpdate={handleBinnedDataUpdate}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(value) => onTabChange(value as ShapTab)}
            className="h-full"
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
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'shap.spectral.description',
                    'Important wavelength regions highlighted on the mean spectrum. Darker colors indicate higher importance.',
                  )}
                </p>
                <div className="h-[500px]">
                  <SpectralImportanceChart
                    jobId={jobId}
                    results={results}
                    binnedData={rebinnedData ?? undefined}
                    selectedSamples={selectedSamples}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="beeswarm" className="mt-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'shap.beeswarm.description',
                    'Distribution of SHAP values across samples. Each point is a sample, colored by feature value.',
                  )}
                </p>
                <div className="h-[500px]">
                  <BeeswarmChart
                    jobId={jobId}
                    onSampleSelect={handleBeeswarmSelect}
                    selectedSamples={selectedSamples}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="waterfall" className="mt-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'shap.waterfall.description',
                    'How features contribute to the prediction for a single sample.',
                  )}
                </p>
                <div className="h-[500px]">
                  <WaterfallChart
                    jobId={jobId}
                    sampleIdx={waterfallSampleIdx}
                    totalSamples={results.n_samples}
                    onSampleChange={handleWaterfallSampleChange}
                  />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="ranking" className="mt-4">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  {t(
                    'shap.ranking.description',
                    'Top wavelength regions ranked by mean absolute SHAP value.',
                  )}
                </p>
                <div className="h-[500px]">
                  <FeatureImportanceBar
                    results={results}
                    binnedData={rebinnedData ?? undefined}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Right sidebar: Prediction scatter */}
      <Card className="w-72 shrink-0 hidden xl:block">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            {t('shap.scatter.title', 'Predictions')}
          </CardTitle>
        </CardHeader>
        <CardContent className="h-[calc(100%-3rem)]">
          <PredictionScatter
            jobId={jobId}
            selectedSamples={selectedSamples}
            onSamplesChange={onSamplesChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}

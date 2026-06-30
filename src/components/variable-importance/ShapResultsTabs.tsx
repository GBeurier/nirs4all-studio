import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Droplets, List } from 'lucide-react';

import { CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BeeswarmChart } from './visualizations/BeeswarmChart';
import { FeatureImportanceBar } from './visualizations/FeatureImportanceBar';
import { PredictionScatter } from './visualizations/PredictionScatter';
import { SpectralImportanceChart } from './visualizations/SpectralImportanceChart';
import { WaterfallChart } from './visualizations/WaterfallChart';
import type { BinnedImportanceData, ShapResultsResponse, ShapTab } from '@/types/shap';

interface ShapResultsTabsProps {
  jobId: string;
  results: ShapResultsResponse;
  binnedData: BinnedImportanceData | null;
  activeTab: ShapTab;
  onTabChange: (tab: ShapTab) => void;
  selectedSamples: number[];
  onSamplesChange: (samples: number[]) => void;
  waterfallSampleIdx: number;
  onWaterfallSampleChange: (sampleIdx: number) => void;
  onBeeswarmSampleSelect: (sampleIdx: number) => void;
}

export function ShapResultsTabs({
  jobId,
  results,
  binnedData,
  activeTab,
  onTabChange,
  selectedSamples,
  onSamplesChange,
  waterfallSampleIdx,
  onWaterfallSampleChange,
  onBeeswarmSampleSelect,
}: ShapResultsTabsProps) {
  const { t } = useTranslation();

  return (
    <CardContent className="space-y-4">
      <div className="h-[220px] border rounded-lg p-3">
        <PredictionScatter
          jobId={jobId}
          selectedSamples={selectedSamples}
          onSamplesChange={onSamplesChange}
        />
      </div>

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
              binnedData={binnedData ?? undefined}
              selectedSamples={selectedSamples}
            />
          </div>
        </TabsContent>

        <TabsContent value="beeswarm" className="mt-4">
          <div className="h-[500px]">
            <BeeswarmChart
              jobId={jobId}
              onSampleSelect={onBeeswarmSampleSelect}
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
              onSampleChange={onWaterfallSampleChange}
            />
          </div>
        </TabsContent>

        <TabsContent value="ranking" className="mt-4">
          <div className="h-[500px]">
            <FeatureImportanceBar
              results={results}
              binnedData={binnedData ?? undefined}
            />
          </div>
        </TabsContent>
      </Tabs>
    </CardContent>
  );
}

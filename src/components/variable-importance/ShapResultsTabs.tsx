import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Droplets, List } from 'lucide-react';
import 'nirs4all-ui/assets/viz.css';

import { CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BeeswarmChart } from './visualizations/BeeswarmChart';
import { FeatureImportanceBar } from './visualizations/FeatureImportanceBar';
import { PredictionScatter } from './visualizations/PredictionScatter';
import { SpectralImportanceChart } from './visualizations/SpectralImportanceChart';
import { WaterfallChart } from './visualizations/WaterfallChart';
import type { BinnedImportanceData, ShapResultsResponse, ShapTab } from '@/types/shap';

/** Map the shared viz design tokens onto Studio's theme so charts follow light/dark mode. */
const VIZ_THEME_CLASS = [
  '[--n4-color-text:hsl(var(--foreground))]',
  '[--n4-color-muted:hsl(var(--muted-foreground))]',
  '[--n4-color-border:hsl(var(--border))]',
  '[--n4-color-surface:hsl(var(--background))]',
  '[--n4-color-focus:hsl(var(--ring))]',
].join(' ');

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
    <CardContent className={`space-y-4 ${VIZ_THEME_CLASS}`}>
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
          <TabsTrigger value="spectral" className="flex items-center gap-1" aria-label={t('shap.tabs.spectral')}>
            <Activity className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('shap.tabs.spectral')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="beeswarm" className="flex items-center gap-1" aria-label={t('shap.tabs.beeswarm')}>
            <Droplets className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('shap.tabs.beeswarm')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="waterfall" className="flex items-center gap-1" aria-label={t('shap.tabs.waterfall')}>
            <BarChart3 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('shap.tabs.waterfall')}
            </span>
          </TabsTrigger>
          <TabsTrigger value="ranking" className="flex items-center gap-1" aria-label={t('shap.tabs.ranking')}>
            <List className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {t('shap.tabs.ranking')}
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="spectral" className="mt-4">
          <SpectralImportanceChart
            jobId={jobId}
            results={results}
            binnedData={binnedData ?? undefined}
            selectedSamples={selectedSamples}
          />
        </TabsContent>

        <TabsContent value="beeswarm" className="mt-4">
          <BeeswarmChart
            jobId={jobId}
            totalSamples={results.n_samples}
            onSampleSelect={onBeeswarmSampleSelect}
            onClearSelection={() => onSamplesChange([])}
            selectedSamples={selectedSamples}
          />
        </TabsContent>

        <TabsContent value="waterfall" className="mt-4">
          <WaterfallChart
            jobId={jobId}
            sampleIdx={waterfallSampleIdx}
            totalSamples={results.n_samples}
            onSampleChange={onWaterfallSampleChange}
          />
        </TabsContent>

        <TabsContent value="ranking" className="mt-4">
          <FeatureImportanceBar
            results={results}
            binnedData={binnedData ?? undefined}
          />
        </TabsContent>
      </Tabs>
    </CardContent>
  );
}

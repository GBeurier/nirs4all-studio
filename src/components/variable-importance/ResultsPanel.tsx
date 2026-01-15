import { useTranslation } from 'react-i18next';
import { Activity, BarChart3, Droplets, List, Clock, Hash, Target } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { SpectralImportanceChart } from './visualizations/SpectralImportanceChart';
import { BeeswarmChart } from './visualizations/BeeswarmChart';
import { WaterfallChart } from './visualizations/WaterfallChart';
import { FeatureImportanceBar } from './visualizations/FeatureImportanceBar';
import type { ShapResultsResponse, ShapTab } from '@/types/shap';

interface ResultsPanelProps {
  results: ShapResultsResponse;
  jobId: string;
  activeTab: ShapTab;
  onTabChange: (tab: ShapTab) => void;
  selectedSampleIdx: number;
  onSampleChange: (idx: number) => void;
}

export function ResultsPanel({
  results,
  jobId,
  activeTab,
  onTabChange,
  selectedSampleIdx,
  onSampleChange,
}: ResultsPanelProps) {
  const { t } = useTranslation();

  return (
    <Card className="h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
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
                  'Important wavelength regions highlighted on the mean spectrum. Darker colors indicate higher importance.'
                )}
              </p>
              <div className="h-[500px]">
                <SpectralImportanceChart jobId={jobId} results={results} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="beeswarm" className="mt-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t(
                  'shap.beeswarm.description',
                  'Distribution of SHAP values across samples. Each point is a sample, colored by feature value.'
                )}
              </p>
              <div className="h-[500px]">
                <BeeswarmChart jobId={jobId} onSampleSelect={onSampleChange} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="waterfall" className="mt-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t(
                  'shap.waterfall.description',
                  'How features contribute to the prediction for a single sample.'
                )}
              </p>
              <div className="h-[500px]">
                <WaterfallChart
                  jobId={jobId}
                  sampleIdx={selectedSampleIdx}
                  totalSamples={results.n_samples}
                  onSampleChange={onSampleChange}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="ranking" className="mt-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                {t(
                  'shap.ranking.description',
                  'Top wavelength regions ranked by mean absolute SHAP value.'
                )}
              </p>
              <div className="h-[500px]">
                <FeatureImportanceBar results={results} />
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

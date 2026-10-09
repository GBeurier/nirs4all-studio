import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Award, Layers, BarChart3, Grid3X3, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DistanceMatrixHeatmap } from './visualizations/DistanceMatrixHeatmap';
import { PreprocessingRankingChart } from './visualizations/PreprocessingRankingChart';
import { TransferPCAScatter } from './visualizations/TransferPCAScatter';
import { MetricConvergenceChart } from './visualizations/MetricConvergenceChart';
import {
  getActivePreprocessingKey,
  getResultsPanelChartModel,
  getResultsPanelControlsModel,
  getResultsPanelSummaryModel,
} from './ResultsPanelData';
import type { TransferAnalysisResponse, TransferMetricType } from '@/types/transfer';

interface ResultsPanelProps {
  results: TransferAnalysisResponse;
  activePreprocessing: string | null;
  onPreprocessingChange: (pp: string | null) => void;
  selectedMetric: TransferMetricType;
  onMetricChange: (metric: TransferMetricType) => void;
}

export function ResultsPanel({
  results,
  activePreprocessing,
  onPreprocessingChange,
  selectedMetric,
  onMetricChange,
}: ResultsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>('summary');
  const summary = getResultsPanelSummaryModel(results);
  const controls = getResultsPanelControlsModel(results, activePreprocessing);
  const chartModel = getResultsPanelChartModel(results, selectedMetric, activePreprocessing);
  const activePreprocessingKey = getActivePreprocessingKey(activePreprocessing);

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">{t('transferAnalysis.results.title')}</CardTitle>
              <CardDescription>
                {[
                  t('transferAnalysis.results.datasetCount', { count: summary.counts.datasets }),
                  t('transferAnalysis.results.preprocessingCount', { count: summary.counts.preprocessings }),
                  t('transferAnalysis.results.pairCount', { count: summary.counts.pairs }),
                ].join(', ')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {summary.executionTimeLabel}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('transferAnalysis.results.bestPreprocessing')}</p>
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{summary.bestPreprocessing}</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('transferAnalysis.results.distanceReduction')}</p>
              <span className={`font-medium text-sm ${summary.reduction.className}`}>
                {summary.reduction.label}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('transferAnalysis.results.datasets')}</p>
              <div className="flex flex-wrap gap-1">
                {summary.datasetBadges.map((dataset) => (
                  <Badge key={dataset.id} variant="outline" className="text-xs">
                    {dataset.label}
                  </Badge>
                ))}
                {summary.datasetOverflowLabel && (
                  <Badge variant="outline" className="text-xs">
                    {summary.datasetOverflowLabel}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('transferAnalysis.results.preprocessings')}</p>
              <span className="font-medium text-sm">{t('transferAnalysis.results.testedCount', { count: summary.preprocessingsTestedCount })}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('transferAnalysis.results.preprocessingLabel')}</span>
          <Select
            value={controls.activePreprocessingSelectValue}
            onValueChange={(v) => onPreprocessingChange(v || null)}
          >
            <SelectTrigger className="w-[180px] h-8">
              <SelectValue placeholder={t('transferAnalysis.results.selectPreprocessing')} />
            </SelectTrigger>
            <SelectContent>
              {controls.preprocessingOptions.map((preprocessing) => (
                <SelectItem key={preprocessing.value} value={preprocessing.value}>
                  {preprocessing.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('transferAnalysis.results.metricLabel')}</span>
          <Select
            value={selectedMetric}
            onValueChange={(v) => onMetricChange(v as TransferMetricType)}
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {controls.metricOptions.map((metric) => (
                <SelectItem key={metric.value} value={metric.value}>
                  {t(metric.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Visualization Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="summary" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('transferAnalysis.results.tabs.ranking')}</span>
          </TabsTrigger>
          <TabsTrigger value="heatmap" className="flex items-center gap-1">
            <Grid3X3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t('transferAnalysis.results.tabs.distances')}</span>
          </TabsTrigger>
          <TabsTrigger value="pca" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">PCA</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">{t('transferAnalysis.results.tabs.metrics')}</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('transferAnalysis.results.ranking.title')}</CardTitle>
              <CardDescription>
                {t('transferAnalysis.results.ranking.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PreprocessingRankingChart
                ranking={chartModel.ranking}
                metric={selectedMetric}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('transferAnalysis.results.heatmap.title')}</CardTitle>
              <CardDescription>
                {t('transferAnalysis.results.heatmap.description', { preprocessing: activePreprocessingKey })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DistanceMatrixHeatmap
                distances={chartModel.distanceRows}
                datasets={chartModel.datasetNames}
                metric={selectedMetric}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pca" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('transferAnalysis.results.pca.title')}</CardTitle>
              <CardDescription>
                {t('transferAnalysis.results.pca.description', { preprocessing: activePreprocessingKey })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TransferPCAScatter
                coordinates={chartModel.pcaCoordinates}
                datasets={chartModel.datasetNames}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('transferAnalysis.results.convergence.title')}</CardTitle>
              <CardDescription>
                {t('transferAnalysis.results.convergence.description')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MetricConvergenceChart convergenceData={chartModel.convergenceData} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

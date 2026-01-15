import { useState } from 'react';
import { Clock, Award, Layers, BarChart3, Grid3X3, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { DistanceMatrixHeatmap } from './visualizations/DistanceMatrixHeatmap';
import { PreprocessingRankingChart } from './visualizations/PreprocessingRankingChart';
import { TransferPCAScatter } from './visualizations/TransferPCAScatter';
import { MetricConvergenceChart } from './visualizations/MetricConvergenceChart';
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
  const [activeTab, setActiveTab] = useState<string>('summary');

  return (
    <div className="space-y-4">
      {/* Summary Header */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">Analysis Results</CardTitle>
              <CardDescription>
                {results.summary.n_datasets} datasets, {results.summary.n_preprocessings} preprocessings,{' '}
                {results.summary.n_pairs} pairwise comparisons
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4" />
              {results.execution_time_ms.toFixed(0)}ms
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Best Preprocessing</p>
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-primary" />
                <span className="font-medium text-sm">{results.summary.best_preprocessing}</span>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Distance Reduction</p>
              <span
                className={`font-medium text-sm ${
                  results.summary.best_reduction_pct > 0 ? 'text-green-600' : 'text-red-600'
                }`}
              >
                {results.summary.best_reduction_pct > 0 ? '+' : ''}
                {results.summary.best_reduction_pct.toFixed(1)}%
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Datasets</p>
              <div className="flex flex-wrap gap-1">
                {results.datasets.slice(0, 3).map((ds) => (
                  <Badge key={ds.id} variant="outline" className="text-xs">
                    {ds.name}
                  </Badge>
                ))}
                {results.datasets.length > 3 && (
                  <Badge variant="outline" className="text-xs">
                    +{results.datasets.length - 3}
                  </Badge>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Preprocessings</p>
              <span className="font-medium text-sm">{results.preprocessings.length} tested</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Controls */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Preprocessing:</span>
          <Select
            value={activePreprocessing || ''}
            onValueChange={(v) => onPreprocessingChange(v || null)}
          >
            <SelectTrigger className="w-[180px] h-8">
              <SelectValue placeholder="Select preprocessing" />
            </SelectTrigger>
            <SelectContent>
              {results.preprocessings.map((pp) => (
                <SelectItem key={pp} value={pp}>
                  {pp}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Metric:</span>
          <Select
            value={selectedMetric}
            onValueChange={(v) => onMetricChange(v as TransferMetricType)}
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="centroid">Centroid</SelectItem>
              <SelectItem value="spread">Spread</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Visualization Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid grid-cols-4 w-full max-w-lg">
          <TabsTrigger value="summary" className="flex items-center gap-1">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">Ranking</span>
          </TabsTrigger>
          <TabsTrigger value="heatmap" className="flex items-center gap-1">
            <Grid3X3 className="h-4 w-4" />
            <span className="hidden sm:inline">Distances</span>
          </TabsTrigger>
          <TabsTrigger value="pca" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">PCA</span>
          </TabsTrigger>
          <TabsTrigger value="metrics" className="flex items-center gap-1">
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">Metrics</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Preprocessing Ranking</CardTitle>
              <CardDescription>
                Which preprocessing methods best reduce inter-dataset distances
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PreprocessingRankingChart
                ranking={results.preprocessing_ranking[selectedMetric] || []}
                metric={selectedMetric}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="heatmap" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Distance Matrices</CardTitle>
              <CardDescription>
                Pairwise distances between datasets for: {activePreprocessing || 'raw'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DistanceMatrixHeatmap
                distances={results.distance_matrices[activePreprocessing || ''] || []}
                datasets={results.datasets.map((d) => d.name)}
                metric={selectedMetric}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pca" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">PCA Visualization</CardTitle>
              <CardDescription>
                Dataset clustering in PCA space: {activePreprocessing || 'raw'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TransferPCAScatter
                coordinates={results.pca_coordinates[activePreprocessing || 'raw'] || []}
                datasets={results.datasets.map((d) => d.name)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Metric Convergence</CardTitle>
              <CardDescription>
                How preprocessing affects quality metric variance across datasets
              </CardDescription>
            </CardHeader>
            <CardContent>
              <MetricConvergenceChart convergenceData={results.metric_convergence} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

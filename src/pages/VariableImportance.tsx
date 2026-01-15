import { useState, useCallback, useEffect } from 'react';
import { motion } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Loader2, PlayCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { VariableImportanceForm } from '@/components/variable-importance/VariableImportanceForm';
import { ResultsPanel } from '@/components/variable-importance/ResultsPanel';
import { computeShapExplanation, getShapResults } from '@/api/shap';
import type {
  ShapComputeRequest,
  ShapResultsResponse,
  ShapTab,
  ModelSource,
  ExplainerType,
  BinAggregation,
  Partition,
} from '@/types/shap';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export default function VariableImportance() {
  const { t } = useTranslation();

  // Selection state
  const [modelSource, setModelSource] = useState<ModelSource>('run');
  const [modelId, setModelId] = useState<string | null>(null);
  const [datasetId, setDatasetId] = useState<string | null>(null);
  const [partition, setPartition] = useState<Partition>('test');

  // Configuration state
  const [explainerType, setExplainerType] = useState<ExplainerType>('auto');
  const [nSamples, setNSamples] = useState<number | null>(null);
  const [binSize, setBinSize] = useState(20);
  const [binStride, setBinStride] = useState(10);
  const [binAggregation, setBinAggregation] = useState<BinAggregation>('sum');

  // Results state
  const [jobId, setJobId] = useState<string | null>(null);
  const [results, setResults] = useState<ShapResultsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<ShapTab>('spectral');
  const [selectedSampleIdx, setSelectedSampleIdx] = useState(0);

  // Reset sample selection when results change
  useEffect(() => {
    if (results) {
      setSelectedSampleIdx(0);
    }
  }, [results]);

  const handleRunAnalysis = useCallback(async () => {
    if (!modelId || !datasetId) {
      setError('Please select a model and dataset.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResults(null);

    try {
      const request: ShapComputeRequest = {
        model_source: modelSource,
        model_id: modelId,
        dataset_id: datasetId,
        partition,
        explainer_type: explainerType,
        n_samples: nSamples,
        n_background: 100,
        bin_size: binSize,
        bin_stride: binStride,
        bin_aggregation: binAggregation,
      };

      const response = await computeShapExplanation(request);
      setJobId(response.job_id);

      if (response.status === 'completed') {
        // Fetch full results
        const fullResults = await getShapResults(response.job_id);
        setResults(fullResults);
      } else {
        setError(response.message || 'SHAP computation failed');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [
    modelSource,
    modelId,
    datasetId,
    partition,
    explainerType,
    nSamples,
    binSize,
    binStride,
    binAggregation,
  ]);

  const canRun = modelId && datasetId && !isLoading;

  return (
    <motion.div
      className="h-full flex flex-col lg:flex-row gap-4"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* Left Sidebar - Configuration */}
      <motion.aside
        variants={itemVariants}
        className="w-full lg:w-80 lg:shrink-0 space-y-4 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
                <TrendingUp className="h-4 w-4 text-primary" />
              </div>
              <CardTitle className="text-lg">
                {t('shap.title', 'Variable Importance')}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <VariableImportanceForm
              modelSource={modelSource}
              onModelSourceChange={setModelSource}
              modelId={modelId}
              onModelIdChange={setModelId}
              datasetId={datasetId}
              onDatasetIdChange={setDatasetId}
              partition={partition}
              onPartitionChange={setPartition}
              explainerType={explainerType}
              onExplainerTypeChange={setExplainerType}
              nSamples={nSamples}
              onNSamplesChange={setNSamples}
              binSize={binSize}
              onBinSizeChange={setBinSize}
              binStride={binStride}
              onBinStrideChange={setBinStride}
              binAggregation={binAggregation}
              onBinAggregationChange={setBinAggregation}
            />

            {error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              className="w-full"
              onClick={handleRunAnalysis}
              disabled={!canRun}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('shap.computing', 'Computing...')}
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  {t('shap.compute', 'Compute Explanations')}
                </>
              )}
            </Button>

            {!modelId && (
              <p className="text-xs text-muted-foreground text-center">
                {t('shap.selectModel', 'Select a model to explain')}
              </p>
            )}
          </CardContent>
        </Card>
      </motion.aside>

      {/* Main Content - Results */}
      <motion.main
        variants={itemVariants}
        className="flex-1 min-w-0 lg:overflow-y-auto lg:max-h-[calc(100vh-8rem)]"
      >
        {results ? (
          <ResultsPanel
            results={results}
            jobId={jobId!}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            selectedSampleIdx={selectedSampleIdx}
            onSampleChange={setSelectedSampleIdx}
          />
        ) : (
          <Card className="h-full min-h-[400px] flex items-center justify-center">
            <CardContent className="text-center py-12">
              <div className="flex h-16 w-16 mx-auto items-center justify-center rounded-full bg-muted mb-4">
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">
                {t('shap.noResults', 'No Results Yet')}
              </h3>
              <p className="text-muted-foreground max-w-md mx-auto mb-4">
                {t(
                  'shap.instructions',
                  'Select a trained model and dataset, then click "Compute Explanations" to analyze which wavelengths are most important for predictions.'
                )}
              </p>
              <div className="flex flex-wrap gap-2 justify-center text-xs text-muted-foreground">
                <span className="px-2 py-1 bg-muted rounded">
                  {t('shap.features.spectral', 'Spectral importance')}
                </span>
                <span className="px-2 py-1 bg-muted rounded">
                  {t('shap.features.beeswarm', 'SHAP distribution')}
                </span>
                <span className="px-2 py-1 bg-muted rounded">
                  {t('shap.features.waterfall', 'Sample breakdown')}
                </span>
              </div>
            </CardContent>
          </Card>
        )}
      </motion.main>
    </motion.div>
  );
}

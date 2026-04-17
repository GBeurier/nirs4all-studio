import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { MlLoadingOverlay } from "@/components/layout/MlLoadingOverlay";
import { motion } from '@/lib/motion';
import { useTranslation } from 'react-i18next';
import { TrendingUp, Loader2, PlayCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { VariableImportanceForm } from '@/components/variable-importance/VariableImportanceForm';
import { ResultsPanel } from '@/components/variable-importance/ResultsPanel';
import { computeShapExplanation, getShapResults, getShapStatus } from '@/api/shap';
import { useJobUpdates } from '@/hooks/useWebSocket';
import {
  loadShapSessionState,
  persistShapSessionState,
} from '@/lib/shapSessionCache';
import type {
  BinnedImportanceData,
  ShapComputeRequest,
  ShapResultsResponse,
  ShapTab,
  ExplainerType,
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
  const persistedSession = useMemo(() => loadShapSessionState(), []);

  // Selection state
  const [chainId, setChainId] = useState<string | null>(() => persistedSession?.chainId ?? null);
  const [datasetName, setDatasetName] = useState<string | null>(() => persistedSession?.datasetName ?? null);
  const [partition, setPartition] = useState<Partition>(() => persistedSession?.partition ?? 'test');

  // Configuration state
  const [explainerType, setExplainerType] = useState<ExplainerType>(() => persistedSession?.explainerType ?? 'auto');

  // Job / results state
  const [jobId, setJobId] = useState<string | null>(() => persistedSession?.jobId ?? null);
  const [results, setResults] = useState<ShapResultsResponse | null>(() => persistedSession?.results ?? null);
  const [rebinnedData, setRebinnedData] = useState<BinnedImportanceData | null>(() => persistedSession?.rebinnedData ?? null);
  const [isSubmitting, setIsSubmitting] = useState(() => persistedSession?.isSubmitting ?? false);
  const [error, setError] = useState<string | null>(null);

  // UI state
  const [activeTab, setActiveTab] = useState<ShapTab>(() => persistedSession?.activeTab ?? 'spectral');
  const [selectedSamples, setSelectedSamples] = useState<number[]>(() => persistedSession?.selectedSamples ?? []);

  // WebSocket progress tracking
  const { status: jobStatus, progress, progressMessage, error: wsError } = useJobUpdates(jobId);

  // `useJobUpdates` does not reset its internal status when jobId changes, so after a failure
  // the stale 'failed' value can briefly leak into the next run. This ref tells the effects
  // below to ignore 'failed' until the new job has reported a fresh (non-failed) status.
  const awaitingFreshStatusRef = useRef(false);

  const isRunning = jobStatus === 'running' || isSubmitting;

  useEffect(() => {
    persistShapSessionState({
      chainId,
      datasetName,
      partition,
      explainerType,
      jobId,
      results,
      rebinnedData,
      isSubmitting,
      activeTab,
      selectedSamples,
    });
  }, [
    activeTab,
    chainId,
    datasetName,
    explainerType,
    isSubmitting,
    jobId,
    partition,
    rebinnedData,
    results,
    selectedSamples,
  ]);

  useEffect(() => {
    if (!jobId) return;
    if (results && !isSubmitting) return;

    let cancelled = false;

    const reconcileJob = async () => {
      try {
        const job = await getShapStatus(jobId) as Record<string, unknown>;
        if (cancelled) return;

        const status = typeof job.status === 'string' ? job.status : null;
        const statusError =
          typeof job.error === 'string'
            ? job.error
            : typeof job.message === 'string'
              ? job.message
              : null;

        if (status === 'completed') {
          const fullResults = await getShapResults(jobId);
          if (cancelled) return;
          setResults(fullResults);
          setRebinnedData(null);
          setSelectedSamples([]);
          setIsSubmitting(false);
          setError(null);
          return;
        }

        if (status === 'running' || status === 'pending') {
          setIsSubmitting(true);
          return;
        }

        if (status === 'failed' || status === 'cancelled') {
          setIsSubmitting(false);
          setJobId(null);
          if (!results) {
            setError(statusError || 'SHAP computation failed');
          }
        }
      } catch (err) {
        if (cancelled) return;

        setIsSubmitting(false);
        if (!results) {
          const message = err instanceof Error ? err.message : 'Failed to restore SHAP analysis';
          setError(message);
          setJobId(null);
        }
      }
    };

    void reconcileJob();

    return () => {
      cancelled = true;
    };
  }, [isSubmitting, jobId, results]);

  // When job completes, fetch full results
  useEffect(() => {
    if (jobStatus && jobStatus !== 'failed') {
      awaitingFreshStatusRef.current = false;
    }
    if (jobStatus === 'completed' && jobId && !results) {
      getShapResults(jobId)
        .then((r) => {
          setResults(r);
          setRebinnedData(null);
          setSelectedSamples([]);
          setIsSubmitting(false);
          setError(null);
        })
        .catch((err) => {
          setError(err.message || 'Failed to fetch results');
          setIsSubmitting(false);
        });
    }
    if (jobStatus === 'failed' && !awaitingFreshStatusRef.current) {
      setError(wsError || 'SHAP computation failed');
      setIsSubmitting(false);
    }
  }, [jobStatus, jobId, results, wsError]);

  const handleChainSelect = useCallback((newChainId: string | null, newDatasetName: string | null) => {
    setChainId(newChainId);
    setDatasetName(newDatasetName);
  }, []);

  const handleRunAnalysis = useCallback(async () => {
    if (!chainId || !datasetName) {
      setError('Please select a model to explain.');
      return;
    }

    awaitingFreshStatusRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setResults(null);
    setRebinnedData(null);
    setSelectedSamples([]);
    setJobId(null);

    try {
      const isBundle = chainId.endsWith('.n4a') || chainId.includes('/') || chainId.includes('\\');

      const request: ShapComputeRequest = {
        chain_id: isBundle ? undefined : chainId,
        bundle_path: isBundle ? chainId : undefined,
        dataset_id: datasetName,
        partition,
        explainer_type: explainerType,
        n_samples: null,
        n_background: 100,
        bin_size: 20,
        bin_stride: 10,
        bin_aggregation: 'sum',
      };

      const response = await computeShapExplanation(request);
      setJobId(response.job_id);

      if (response.status === 'completed') {
        const fullResults = await getShapResults(response.job_id);
        setResults(fullResults);
        setSelectedSamples([]);
        setIsSubmitting(false);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Analysis failed';
      setError(message);
      setIsSubmitting(false);
    }
  }, [chainId, datasetName, partition, explainerType]);

  const canRun = chainId && datasetName && !isRunning;

  return (
    <MlLoadingOverlay>
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
                {t('shap.title', 'SHAP Analysis')}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <VariableImportanceForm
              chainId={chainId}
              onChainSelect={handleChainSelect}
              partition={partition}
              onPartitionChange={setPartition}
              explainerType={explainerType}
              onExplainerTypeChange={setExplainerType}
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
              {isRunning ? (
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

            {isRunning && jobId && (
              <div className="space-y-2">
                <Progress value={progress} className="h-2" />
                <p className="text-xs text-muted-foreground text-center">
                  {progressMessage || 'Starting...'}
                </p>
              </div>
            )}

            {!chainId && (
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
        {results && jobId ? (
          <ResultsPanel
            results={results}
            jobId={jobId}
            binnedData={rebinnedData}
            onBinnedDataChange={setRebinnedData}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            selectedSamples={selectedSamples}
            onSamplesChange={setSelectedSamples}
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
                  'Select a trained model, then click "Compute Explanations" to analyze which wavelengths are most important for predictions.'
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
    </MlLoadingOverlay>
  );
}

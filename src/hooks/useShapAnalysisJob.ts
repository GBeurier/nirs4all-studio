import { useCallback, useEffect, useRef, useState } from 'react';

import { computeShapExplanation, getShapResults, getShapStatus } from '@/api/shap';
import { buildShapComputeRequest } from '@/lib/shapAnalysisRequest';
import { useJobUpdates } from '@/hooks/useWebSocket';
import type { ShapModelRequestRef } from '@/lib/shapAnalysisRequest';
import type {
  BinnedImportanceData,
  ExplainerType,
  Partition,
  ShapResultsResponse,
} from '@/types/shap';

export interface UseShapAnalysisJobInitialState {
  jobId?: string | null;
  results?: ShapResultsResponse | null;
  rebinnedData?: BinnedImportanceData | null;
  isSubmitting?: boolean;
  selectedSamples?: number[];
}

export interface RunShapAnalysisInput {
  chainId: string | null;
  modelRef?: ShapModelRequestRef | null;
  datasetName: string | null;
  partition: Partition;
  explainerType: ExplainerType;
}

function getUnknownErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function readShapJobStatusError(job: Record<string, unknown>): string | null {
  if (typeof job.error === 'string') return job.error;
  if (typeof job.message === 'string') return job.message;
  return null;
}

export function useShapAnalysisJob(initialState: UseShapAnalysisJobInitialState = {}) {
  const [jobId, setJobId] = useState<string | null>(() => initialState.jobId ?? null);
  const [results, setResults] = useState<ShapResultsResponse | null>(() => initialState.results ?? null);
  const [rebinnedData, setRebinnedData] = useState<BinnedImportanceData | null>(() => initialState.rebinnedData ?? null);
  const [isSubmitting, setIsSubmitting] = useState(() => initialState.isSubmitting ?? false);
  const [error, setError] = useState<string | null>(null);
  const [selectedSamples, setSelectedSamples] = useState<number[]>(() => initialState.selectedSamples ?? []);

  const { status: jobStatus, progress, progressMessage, error: wsError } = useJobUpdates(jobId);

  // `useJobUpdates` does not reset its internal status when jobId changes, so after a failure
  // the stale 'failed' value can briefly leak into the next run. This ref tells the effects
  // below to ignore 'failed' until the new job has reported a fresh (non-failed) status.
  const awaitingFreshStatusRef = useRef(false);

  const isRunning = jobStatus === 'running' || isSubmitting;

  const resetResultStateForRun = useCallback(() => {
    awaitingFreshStatusRef.current = true;
    setIsSubmitting(true);
    setError(null);
    setResults(null);
    setRebinnedData(null);
    setSelectedSamples([]);
    setJobId(null);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    if (results && !isSubmitting) return;

    let cancelled = false;

    const reconcileJob = async () => {
      try {
        const job = await getShapStatus(jobId) as Record<string, unknown>;
        if (cancelled) return;

        const status = typeof job.status === 'string' ? job.status : null;
        const statusError = readShapJobStatusError(job);

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
          setError(getUnknownErrorMessage(err, 'Failed to restore SHAP analysis'));
          setJobId(null);
        }
      }
    };

    void reconcileJob();

    return () => {
      cancelled = true;
    };
  }, [isSubmitting, jobId, results]);

  useEffect(() => {
    if (jobStatus && jobStatus !== 'failed') {
      awaitingFreshStatusRef.current = false;
    }

    if (jobStatus === 'completed' && jobId && !results) {
      getShapResults(jobId)
        .then((resolvedResults) => {
          setResults(resolvedResults);
          setRebinnedData(null);
          setSelectedSamples([]);
          setIsSubmitting(false);
          setError(null);
        })
        .catch((err: unknown) => {
          setError(getUnknownErrorMessage(err, 'Failed to fetch results'));
          setIsSubmitting(false);
        });
    }

    if (jobStatus === 'failed' && !awaitingFreshStatusRef.current) {
      setError(wsError || 'SHAP computation failed');
      setIsSubmitting(false);
    }
  }, [jobId, jobStatus, results, wsError]);

  const runAnalysis = useCallback(async ({
    chainId,
    modelRef,
    datasetName,
    partition,
    explainerType,
  }: RunShapAnalysisInput) => {
    const selectedModelRef = modelRef ?? chainId;
    if (!selectedModelRef || !datasetName) {
      setError('Please select a model to explain.');
      return;
    }

    resetResultStateForRun();

    try {
      const request = buildShapComputeRequest({
        modelRef: selectedModelRef,
        datasetName,
        partition,
        explainerType,
      });

      const response = await computeShapExplanation(request);
      setJobId(response.job_id);

      if (response.status === 'completed') {
        const fullResults = await getShapResults(response.job_id);
        setResults(fullResults);
        setSelectedSamples([]);
        setIsSubmitting(false);
      }
    } catch (err) {
      setError(getUnknownErrorMessage(err, 'Analysis failed'));
      setIsSubmitting(false);
    }
  }, [resetResultStateForRun]);

  return {
    jobId,
    results,
    rebinnedData,
    setRebinnedData,
    isSubmitting,
    isRunning,
    error,
    selectedSamples,
    setSelectedSamples,
    progress,
    progressMessage,
    runAnalysis,
  };
}

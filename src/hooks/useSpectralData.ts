import { useState, useCallback, useRef, useEffect } from 'react';
import { SpectralData } from '@/types/spectral';
import { loadWorkspaceDataset } from '@/api/playground';
import { formatApiErrorDetail } from '@/api/transport';
import type { PartitionKey } from '@/types/datasets';
import type { DatasetSchemaRef } from '@/lib/datasetSchema';
import { createSyntheticSpectralData } from '@/lib/playground/syntheticSpectralData';

export interface WorkspaceDatasetInfo {
  datasetId: string;
  datasetName: string;
  partition: PartitionKey;
  trainSamples?: number;
  testSamples?: number;
  schemaRef?: DatasetSchemaRef;
  sourceIndex?: number | null;
  targetIndex?: number | null;
}

export interface LoadWorkspaceDatasetOptions {
  sourceIndex?: number | null;
  targetIndex?: number | null;
}

export function useSpectralData() {
  const [rawData, setRawData] = useState<SpectralData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the source of the current data
  const [dataSource, setDataSource] = useState<'workspace' | 'demo' | null>(null);
  const [currentDatasetInfo, setCurrentDatasetInfo] = useState<WorkspaceDatasetInfo | null>(null);
  const pendingLoad = useRef<AbortController | null>(null);
  useEffect(() => () => pendingLoad.current?.abort(), []);

  const loadDemoData = useCallback(() => {
    pendingLoad.current?.abort();
    pendingLoad.current = null;
    setIsLoading(false);
    setRawData(createSyntheticSpectralData());
    setDataSource('demo');
    setCurrentDatasetInfo(null);
    setError(null);
  }, []);

  const loadFromWorkspace = useCallback(async (
    datasetId: string,
    datasetName: string,
    partition: PartitionKey = 'all',
    datasetInfo?: Pick<WorkspaceDatasetInfo, 'trainSamples' | 'testSamples' | 'schemaRef'>,
    options: LoadWorkspaceDatasetOptions = {},
  ) => {
    pendingLoad.current?.abort();
    const controller = new AbortController();
    pendingLoad.current = controller;
    setIsLoading(true);
    setError(null);
    setRawData(null);

    try {
      const data = await loadWorkspaceDataset(datasetId, datasetName, partition, {
        sourceIndex: options.sourceIndex,
        targetIndex: options.targetIndex,
        signal: controller.signal,
      });
      if (controller.signal.aborted || pendingLoad.current !== controller) return;
      setRawData(data);
      setDataSource('workspace');
      setCurrentDatasetInfo({
        datasetId,
        datasetName,
        partition,
        trainSamples: datasetInfo?.trainSamples,
        testSamples: datasetInfo?.testSamples,
        schemaRef: datasetInfo?.schemaRef,
        sourceIndex: options.sourceIndex,
        targetIndex: options.targetIndex,
      });
    } catch (err) {
      if (controller.signal.aborted || pendingLoad.current !== controller) return;
      setError(err instanceof Error ? err.message : formatApiErrorDetail((err as { detail?: unknown }).detail));
      setRawData(null);
      setDataSource(null);
      setCurrentDatasetInfo(null);
    } finally {
      if (pendingLoad.current === controller) {
        pendingLoad.current = null;
        setIsLoading(false);
      }
    }
  }, []);

  const clearData = useCallback(() => {
    pendingLoad.current?.abort();
    pendingLoad.current = null;
    setIsLoading(false);
    setRawData(null);
    setError(null);
    setDataSource(null);
    setCurrentDatasetInfo(null);
  }, []);

  return {
    rawData,
    isLoading,
    error,
    dataSource,
    currentDatasetInfo,
    loadDemoData,
    loadFromWorkspace,
    clearData,
  };
}

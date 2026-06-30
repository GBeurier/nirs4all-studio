import { useState, useCallback } from 'react';
import { SpectralData } from '@/types/spectral';
import { loadWorkspaceDataset } from '@/api/playground';
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

  const loadDemoData = useCallback(() => {
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
    setIsLoading(true);
    setError(null);

    try {
      const data = await loadWorkspaceDataset(datasetId, datasetName, partition, {
        sourceIndex: options.sourceIndex,
        targetIndex: options.targetIndex,
      });
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
      setError(err instanceof Error ? err.message : 'Failed to load workspace dataset');
      setRawData(null);
      setDataSource(null);
      setCurrentDatasetInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearData = useCallback(() => {
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

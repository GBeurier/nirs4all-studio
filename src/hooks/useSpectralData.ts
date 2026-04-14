import { useState, useCallback } from 'react';
import { SpectralData, SampleMetadata } from '@/types/spectral';
import { loadWorkspaceDataset } from '@/api/playground';
import type { PartitionKey } from '@/types/datasets';

export interface WorkspaceDatasetInfo {
  datasetId: string;
  datasetName: string;
  partition: PartitionKey;
  trainSamples?: number;
  testSamples?: number;
}

export function useSpectralData() {
  const [rawData, setRawData] = useState<SpectralData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the source of the current data
  const [dataSource, setDataSource] = useState<'workspace' | 'demo' | null>(null);
  const [currentDatasetInfo, setCurrentDatasetInfo] = useState<WorkspaceDatasetInfo | null>(null);

  const loadDemoData = useCallback(() => {
    // Generate synthetic NIR spectra with consistent repetitions for testing all charts.
    // 175 biological samples with exactly 4 repetitions each = 700 total measurements.
    // Samples are emitted train-first (140 bio samples) then test-last (35 bio samples),
    // so source_partitions = {has_test, n_train, n_test} with indices [0, n_train)
    // being train and [n_train, n_train + n_test) being the held-out test, matching the
    // contract expected by the backend executor and fold chart.
    const numBioSamples = 175;
    const numReps = 4;
    const numTestBioSamples = 35;
    const numTrainBioSamples = numBioSamples - numTestBioSamples;
    const numWavelengths = 200;
    const startWavelength = 1100;
    const endWavelength = 2500;

    const wavelengths = Array.from(
      { length: numWavelengths },
      (_, i) => startWavelength + (i * (endWavelength - startWavelength)) / (numWavelengths - 1)
    );

    const spectra: number[][] = [];
    const y: number[] = [];
    const sampleIds: string[] = [];
    const metadata: SampleMetadata[] = [];

    for (let bioIdx = 0; bioIdx < numBioSamples; bioIdx++) {
      const trueConcentration = Math.random() * 100;
      const bioId = String(bioIdx + 1).padStart(2, '0');
      const instrumentId = `instrument_${String((bioIdx % 5) + 1).padStart(2, '0')}`;
      const batchId = `batch_${String((bioIdx % 15) + 1).padStart(2, '0')}`;
      const lotId = `lot_${String((bioIdx % 100) + 1).padStart(3, '0')}`;

      for (let rep = 0; rep < numReps; rep++) {
        const measuredConcentration = trueConcentration + (Math.random() - 0.5) * 5;
        y.push(Math.max(0, Math.min(100, measuredConcentration)));
        sampleIds.push(`Sample_${bioId}_r${rep + 1}`);

        // Keep repetition-related metadata for the dedicated chart and add
        // three user-facing columns with fixed cardinalities (5 / 15 / 100).
        metadata.push({
          bio_sample: `Sample_${bioId}`,
          repetition: rep + 1,
          instrument: instrumentId,
          batch: batchId,
          lot: lotId,
        });

        const repVariation = (Math.random() - 0.5) * 0.01;
        const spectrum = wavelengths.map((w) => {
          const baseline = 0.5 + 0.3 * Math.sin(w / 500);
          const noise = (Math.random() - 0.5) * 0.02;
          const scatter = 0.1 * Math.pow((w - 1800) / 1000, 2);
          const peak1 = 0.3 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1450) / 50, 2));
          const peak2 = 0.2 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1940) / 80, 2));
          const peak3 = 0.15 * (1 - trueConcentration / 100) * Math.exp(-Math.pow((w - 2100) / 60, 2));
          return baseline + scatter + peak1 + peak2 + peak3 + noise + repVariation;
        });
        spectra.push(spectrum);
      }
    }

    const nTrain = numTrainBioSamples * numReps;
    const nTest = numTestBioSamples * numReps;

    setRawData({
      wavelengths,
      spectra,
      y,
      sampleIds,
      metadata,
      wavelengthUnit: 'nm',
      sourcePartitions: {
        has_test: true,
        n_train: nTrain,
        n_test: nTest,
      },
    });
    setDataSource('demo');
    setCurrentDatasetInfo(null);
    setError(null);
  }, []);

  const loadFromWorkspace = useCallback(async (
    datasetId: string,
    datasetName: string,
    partition: PartitionKey = 'all',
    datasetInfo?: Pick<WorkspaceDatasetInfo, 'trainSamples' | 'testSamples'>,
  ) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await loadWorkspaceDataset(datasetId, datasetName, partition);
      setRawData(data);
      setDataSource('workspace');
      setCurrentDatasetInfo({
        datasetId,
        datasetName,
        partition,
        trainSamples: datasetInfo?.trainSamples,
        testSamples: datasetInfo?.testSamples,
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

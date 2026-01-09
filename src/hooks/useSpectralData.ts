import { useState, useCallback } from 'react';
import { SpectralData, SampleMetadata } from '@/types/spectral';
import { loadWorkspaceDataset } from '@/api/playground';

export interface WorkspaceDatasetInfo {
  datasetId: string;
  datasetName: string;
}

export function useSpectralData() {
  const [rawData, setRawData] = useState<SpectralData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track the source of the current data
  const [dataSource, setDataSource] = useState<'workspace' | 'demo' | null>(null);
  const [currentDatasetInfo, setCurrentDatasetInfo] = useState<WorkspaceDatasetInfo | null>(null);

  const loadDemoData = useCallback(() => {
    // Generate synthetic NIR spectra with consistent repetitions for testing all charts
    // 25 biological samples with exactly 4 repetitions each = 100 total measurements
    // 80% train (20 samples), 20% test (5 samples)
    const numBioSamples = 25;
    const numReps = 4;
    const numTestSamples = 5;
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

    // Determine which samples are test samples (last numTestSamples)
    const testSampleStart = numBioSamples - numTestSamples;

    // Create biological samples with exactly 4 repetitions each
    for (let bioIdx = 0; bioIdx < numBioSamples; bioIdx++) {
      // Each sample has a true concentration value
      const trueConcentration = Math.random() * 100;
      const bioId = String(bioIdx + 1).padStart(2, '0');
      const isTest = bioIdx >= testSampleStart;

      for (let rep = 0; rep < numReps; rep++) {
        // Small variation in measured concentration between repetitions
        const measuredConcentration = trueConcentration + (Math.random() - 0.5) * 5;
        y.push(Math.max(0, Math.min(100, measuredConcentration)));

        // Sample ID format: Sample_XX_rY (e.g., Sample_01_r1, Sample_01_r2)
        sampleIds.push(`Sample_${bioId}_r${rep + 1}`);

        // Add metadata for this measurement
        metadata.push({
          bio_sample: `Sample_${bioId}`,
          repetition: rep + 1,
          set: isTest ? 'test' : 'train',
        });

        // Generate spectrum with peaks related to concentration
        // Add slight random variation between repetitions
        const repVariation = (Math.random() - 0.5) * 0.01;

        const spectrum = wavelengths.map((w) => {
          const baseline = 0.5 + 0.3 * Math.sin(w / 500);
          const noise = (Math.random() - 0.5) * 0.02;
          const scatter = 0.1 * Math.pow((w - 1800) / 1000, 2);

          // Absorption peaks related to true concentration
          const peak1 = 0.3 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1450) / 50, 2));
          const peak2 = 0.2 * trueConcentration / 100 * Math.exp(-Math.pow((w - 1940) / 80, 2));
          const peak3 = 0.15 * (1 - trueConcentration / 100) * Math.exp(-Math.pow((w - 2100) / 60, 2));

          return baseline + scatter + peak1 + peak2 + peak3 + noise + repVariation;
        });

        spectra.push(spectrum);
      }
    }

    setRawData({ wavelengths, spectra, y, sampleIds, metadata });
    setDataSource('demo');
    setCurrentDatasetInfo(null);
    setError(null);
  }, []);

  const loadFromWorkspace = useCallback(async (datasetId: string, datasetName: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await loadWorkspaceDataset(datasetId, datasetName);
      setRawData(data);
      setDataSource('workspace');
      setCurrentDatasetInfo({ datasetId, datasetName });
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

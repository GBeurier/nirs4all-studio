import { useState, useCallback } from 'react';
import { SpectralData } from '@/types/spectral';
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
    // Generate synthetic NIR spectra with repetitions for testing all charts
    // 35 biological samples with 2-4 repetitions each = ~100 total measurements
    const numBioSamples = 35;
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

    // Create biological samples with repetitions
    for (let bioIdx = 0; bioIdx < numBioSamples; bioIdx++) {
      // Each sample has a true concentration value
      const trueConcentration = Math.random() * 100;

      // Number of repetitions varies: 2-4 per biological sample
      const numReps = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4 reps

      for (let rep = 0; rep < numReps; rep++) {
        // Small variation in measured concentration between repetitions
        const measuredConcentration = trueConcentration + (Math.random() - 0.5) * 5;
        y.push(Math.max(0, Math.min(100, measuredConcentration)));

        // Sample ID format: Sample_XX_rY (e.g., Sample_01_r1, Sample_01_r2)
        const bioId = String(bioIdx + 1).padStart(2, '0');
        sampleIds.push(`Sample_${bioId}_r${rep + 1}`);

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

    setRawData({ wavelengths, spectra, y, sampleIds });
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

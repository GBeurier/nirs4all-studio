import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SpectralData, SampleMetadata } from '@/types/spectral';
import { loadWorkspaceDataset } from '@/api/playground';

export interface WorkspaceDatasetInfo {
  datasetId: string;
  datasetName: string;
}

type DataSelection =
  | { kind: 'workspace'; datasetId: string; datasetName: string }
  | { kind: 'demo' }
  | null;

/**
 * Build the TanStack Query cache key for a workspace dataset load.
 *
 * The key includes every parameter that identifies the fetched matrix
 * (datasetId + datasetName, which both drive `loadWorkspaceDataset`), so two
 * different datasets can never share a cache entry.
 */
function workspaceDatasetQueryKey(datasetId: string, datasetName: string) {
  return ['workspaceDataset', datasetId, datasetName] as const;
}

/**
 * Prefix key matching every cached load for a given dataset id, regardless of
 * the dataset name suffix. The fetched matrix is cached aggressively (30 min)
 * keyed by identity only, so when a dataset is edited/refreshed/reconfigured
 * under the same id the edit site must invalidate this prefix to bust the stale
 * matrix — otherwise Playground keeps serving the pre-edit data.
 */
export function workspaceDatasetQueryKeyPrefix(datasetId: string) {
  return ['workspaceDataset', datasetId] as const;
}

export function useSpectralData() {
  const queryClient = useQueryClient();

  // Which dataset is currently selected. Demo data is generated client-side and
  // kept in local state; workspace data is fetched (and cached) via useQuery.
  const [selection, setSelection] = useState<DataSelection>(null);
  const [demoData, setDemoData] = useState<SpectralData | null>(null);

  const isWorkspace = selection?.kind === 'workspace';

  // Workspace dataset load, cached by dataset identity so navigating away and
  // back reuses the cached matrix instead of re-downloading it.
  const workspaceQuery = useQuery({
    queryKey: isWorkspace
      ? workspaceDatasetQueryKey(selection.datasetId, selection.datasetName)
      : ['workspaceDataset', 'none'],
    queryFn: () => {
      // `enabled` guarantees `selection` is a workspace selection here.
      const sel = selection as Extract<DataSelection, { kind: 'workspace' }>;
      return loadWorkspaceDataset(sel.datasetId, sel.datasetName);
    },
    enabled: isWorkspace,
    // Generous caching: the underlying NIRS matrix is immutable for a given
    // datasetId, so keep it fresh and retained across unmounts/navigation.
    staleTime: 1000 * 60 * 30, // 30 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const loadDemoData = useCallback(() => {
    // Generate synthetic NIR spectra with consistent repetitions for testing all charts
    // 175 biological samples with exactly 4 repetitions each = 700 total measurements
    // 80% train (140 samples), 20% test (35 samples)
    const numBioSamples = 175;
    const numReps = 4;
    const numTestSamples = 35;
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

    setDemoData({ wavelengths, spectra, y, sampleIds, metadata });
    setSelection({ kind: 'demo' });
  }, []);

  const loadFromWorkspace = useCallback(async (datasetId: string, datasetName: string) => {
    // Switch to the workspace selection; the matrix is fetched (or served from
    // cache) by the useQuery above. Prefetch so a warm cache resolves
    // immediately and a cold cache starts loading without waiting for re-render.
    setSelection({ kind: 'workspace', datasetId, datasetName });
    await queryClient.prefetchQuery({
      queryKey: workspaceDatasetQueryKey(datasetId, datasetName),
      queryFn: () => loadWorkspaceDataset(datasetId, datasetName),
      staleTime: 1000 * 60 * 30,
    });
  }, [queryClient]);

  const clearData = useCallback(() => {
    setSelection(null);
    setDemoData(null);
  }, []);

  const isLoading = isWorkspace && workspaceQuery.isLoading;

  const hasWorkspaceError = isWorkspace && !!workspaceQuery.error;

  const error = hasWorkspaceError
    ? workspaceQuery.error instanceof Error
      ? workspaceQuery.error.message
      : 'Failed to load workspace dataset'
    : null;

  // A failed workspace load must not surface as a selected dataset: report no
  // dataSource / datasetInfo so consumers (e.g. Playground session persistence)
  // don't store a phantom selection that can never be reloaded.
  const dataSource: 'workspace' | 'demo' | null = hasWorkspaceError
    ? null
    : selection?.kind ?? null;

  const currentDatasetInfo = useMemo<WorkspaceDatasetInfo | null>(
    () =>
      isWorkspace && !hasWorkspaceError
        ? { datasetId: selection.datasetId, datasetName: selection.datasetName }
        : null,
    [isWorkspace, hasWorkspaceError, selection]
  );

  // Derive the public state from the active selection. Workspace data comes from
  // the cached query; demo data from local state.
  const rawData: SpectralData | null = isWorkspace
    ? workspaceQuery.data ?? null
    : selection?.kind === 'demo'
      ? demoData
      : null;

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

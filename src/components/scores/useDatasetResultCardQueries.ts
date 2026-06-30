import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getChainPartitionDetail } from '@/api/aggregatedPredictions';
import {
  getAllChainsForDataset,
  getAllChainsForResultsDataset,
} from '@/api/enrichedRuns';
import {
  buildDatasetResultHeaderSummary,
  buildPredictionViewerHeader,
  buildPredictionViewerPartitions,
  resolveDatasetResultChains,
  resolveDetailChain,
  shouldUseFullDatasetChains,
} from '@/lib/datasetResultCardData';
import { datasetChainsToRows } from '@/lib/score-adapters';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { EnrichedDatasetRun, TopChainResult } from '@/types/enriched-runs';
import type { ScoreCardRow } from '@/types/score-cards';

export interface UseDatasetResultCardQueriesInput {
  dataset: Pick<EnrichedDatasetRun, 'dataset_name' | 'metric' | 'task_type' | 'top_5'>;
  allChains?: TopChainResult[];
  runId?: string;
  workspaceId?: string;
  expanded: boolean;
  quickViewPred: PartitionPrediction | null;
  quickViewOpen: boolean;
  onOpenDetail: (chain: TopChainResult, focusRow?: ScoreCardRow) => void;
}

export function useDatasetResultCardQueries({
  dataset,
  allChains,
  runId,
  workspaceId,
  expanded,
  quickViewPred,
  quickViewOpen,
  onOpenDetail,
}: UseDatasetResultCardQueriesInput) {
  const useFullDatasetChains = shouldUseFullDatasetChains({ allChains, workspaceId });

  const { data: allChainsData, isLoading: isAllChainsLoading } = useQuery({
    queryKey: ['dataset-all-chains', workspaceId, runId ?? '__results__', dataset.dataset_name],
    queryFn: () => {
      const requiredWorkspaceId = workspaceId!;
      return runId
        ? getAllChainsForDataset(requiredWorkspaceId, runId, dataset.dataset_name)
        : getAllChainsForResultsDataset(requiredWorkspaceId, dataset.dataset_name);
    },
    enabled: expanded && useFullDatasetChains,
    staleTime: 60000,
    refetchOnMount: 'always',
  });

  const chains = useMemo(() => (
    resolveDatasetResultChains({
      allChains,
      allChainEntries: useFullDatasetChains ? allChainsData?.chains : null,
      fallbackChains: dataset.top_5,
      runId,
    })
  ), [allChains, allChainsData, dataset.top_5, runId, useFullDatasetChains]);
  const preserveRunInstances = !runId && useFullDatasetChains && Boolean(allChainsData?.chains);

  const scoreRows = useMemo(() => (
    datasetChainsToRows(chains, dataset.metric, dataset.task_type, { preserveRunInstances })
  ), [chains, dataset.metric, dataset.task_type, preserveRunInstances]);

  const handleViewDetails = useCallback((row: ScoreCardRow) => {
    const chain = chains.find((candidate) => candidate.chain_id === row.chainId);
    if (!chain) return;
    onOpenDetail(resolveDetailChain(chain, row), row);
  }, [chains, onOpenDetail]);

  const quickViewChainId = quickViewPred?.chain_id ?? null;
  const { data: quickViewChainDetail } = useQuery({
    queryKey: ['chain-partition-detail', quickViewChainId],
    queryFn: () => getChainPartitionDetail(quickViewChainId!),
    enabled: quickViewOpen && !!quickViewChainId,
    staleTime: 60000,
  });

  const viewerPartitions = useMemo(() => (
    buildPredictionViewerPartitions(quickViewPred, quickViewChainDetail)
  ), [quickViewPred, quickViewChainDetail]);

  const viewerHeader = useMemo(() => (
    buildPredictionViewerHeader({
      quickViewPrediction: quickViewPred,
      datasetName: dataset.dataset_name,
      taskType: dataset.task_type,
    })
  ), [quickViewPred, dataset.dataset_name, dataset.task_type]);

  const headerSummary = useMemo(() => buildDatasetResultHeaderSummary({
    scoreRows,
    chains,
    metric: dataset.metric,
  }), [scoreRows, chains, dataset.metric]);

  return {
    useFullDatasetChains,
    isAllChainsLoading,
    chains,
    scoreRows,
    handleViewDetails,
    viewerPartitions,
    viewerHeader,
    headerSummary,
    headerBestRow: headerSummary.bestRow,
    headerTopChain: headerSummary.topChain,
  };
}

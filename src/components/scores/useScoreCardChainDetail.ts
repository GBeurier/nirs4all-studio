import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { getChainPartitionDetail } from '@/api/aggregatedPredictions';
import {
  buildScoreCardDisplayRow,
  buildScoreCardTrainChildren,
  findScoreCardPrediction,
  selectPreferredScoreCardPrediction,
} from '@/lib/scoreCardTreeData';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { ScoreCardRow } from '@/types/score-cards';

export interface UseScoreCardChainDetailInput {
  row: ScoreCardRow;
  onViewPrediction?: (predictionId: string, prediction?: PartitionPrediction) => void;
  includeTrainChildren?: boolean;
  enrichCrossval?: boolean;
}

export function useScoreCardChainDetail({
  row,
  onViewPrediction,
  includeTrainChildren = false,
  enrichCrossval = false,
}: UseScoreCardChainDetailInput) {
  const { data: foldData, isLoading } = useQuery({
    queryKey: ['chain-partition-detail', row.chainId],
    queryFn: () => getChainPartitionDetail(row.chainId),
    enabled: !!row.chainId,
    staleTime: 60000,
  });
  const predictions = foldData?.predictions;

  const trainChildren = useMemo(() => (
    includeTrainChildren ? buildScoreCardTrainChildren(row, predictions) : []
  ), [includeTrainChildren, predictions, row]);

  const displayRow = useMemo(() => (
    enrichCrossval ? buildScoreCardDisplayRow(row, predictions) : row
  ), [enrichCrossval, predictions, row]);

  const handleViewPrediction = useCallback((predictionId: string) => {
    if (!onViewPrediction) return;
    onViewPrediction(predictionId, findScoreCardPrediction(predictions, predictionId));
  }, [onViewPrediction, predictions]);

  const handleViewChainChart = useCallback(() => {
    if (!onViewPrediction) return;
    const prediction = selectPreferredScoreCardPrediction(predictions);
    if (!prediction) return;
    onViewPrediction(prediction.prediction_id, prediction);
  }, [onViewPrediction, predictions]);

  return {
    isLoading,
    predictions: predictions ?? [],
    trainChildren,
    displayRow,
    handleViewPrediction,
    handleViewChainChart,
  };
}

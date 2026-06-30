import { useCallback, useState } from 'react';

import {
  buildDatasetResultDetailFocus,
  buildDatasetResultDetailMetaHint,
} from '@/lib/datasetResultCardData';
import type {
  ChainDetailFocus,
  ChainDetailMetaHint,
} from '@/components/predictions/detail/ChainDetailPanel';
import type {
  ChartKind,
  ViewerHeader,
  ViewerPartitionTarget,
} from '@/components/predictions/viewer/types';
import type { PartitionPrediction } from '@/types/aggregated-predictions';
import type { EnrichedDatasetRun, TopChainResult } from '@/types/enriched-runs';
import type { ScoreCardRow } from '@/types/score-cards';

export function useDatasetResultCardViewState(
  dataset: Pick<EnrichedDatasetRun, 'dataset_name' | 'metric' | 'task_type'>,
) {
  const [detailChainId, setDetailChainId] = useState<string | null>(null);
  const [detailMetaHint, setDetailMetaHint] = useState<ChainDetailMetaHint | undefined>(undefined);
  const [detailFocus, setDetailFocus] = useState<ChainDetailFocus | undefined>(undefined);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailViewerHeader, setDetailViewerHeader] = useState<ViewerHeader | null>(null);
  const [detailViewerPartitions, setDetailViewerPartitions] = useState<ViewerPartitionTarget[]>([]);
  const [detailViewerKind, setDetailViewerKind] = useState<ChartKind | undefined>(undefined);
  const [detailViewerOpen, setDetailViewerOpen] = useState(false);
  const [quickViewPred, setQuickViewPred] = useState<PartitionPrediction | null>(null);
  const [quickViewOpen, setQuickViewOpen] = useState(false);

  const openDetail = useCallback((chain: TopChainResult, focusRow?: ScoreCardRow) => {
    setDetailChainId(chain.chain_id);
    setDetailMetaHint(buildDatasetResultDetailMetaHint(chain, dataset));
    setDetailFocus(buildDatasetResultDetailFocus(chain, focusRow));
    setDetailOpen(true);
  }, [dataset]);

  const openDetailViewer = useCallback((
    partitions: ViewerPartitionTarget[],
    header: ViewerHeader,
    kind?: ChartKind,
  ) => {
    setDetailViewerPartitions(partitions);
    setDetailViewerHeader(header);
    setDetailViewerKind(kind);
    setDetailViewerOpen(true);
  }, []);

  const openQuickViewPrediction = useCallback((
    _predictionId: string,
    prediction?: PartitionPrediction,
  ) => {
    if (!prediction) return;
    setQuickViewPred(prediction);
    setQuickViewOpen(true);
  }, []);

  return {
    detailChainId,
    detailMetaHint,
    detailFocus,
    detailOpen,
    setDetailOpen,
    detailViewerHeader,
    detailViewerPartitions,
    detailViewerKind,
    detailViewerOpen,
    setDetailViewerOpen,
    quickViewPred,
    quickViewOpen,
    setQuickViewOpen,
    openDetail,
    openDetailViewer,
    openQuickViewPrediction,
  };
}

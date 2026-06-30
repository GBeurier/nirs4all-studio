import { useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { ShapResultsHeader } from './ShapResultsHeader';
import { ShapResultsTabs } from './ShapResultsTabs';
import {
  getShapInitialBinningParams,
  getShapResultsHeaderSummary,
  getShapWaterfallSampleIndex,
  getShapWaterfallSelection,
  toggleShapSelectedSample,
} from '@/lib/shapResultsPanelData';
import type { ShapResultsResponse, ShapTab, BinnedImportanceData } from '@/types/shap';

interface ResultsPanelProps {
  results: ShapResultsResponse;
  jobId: string;
  binnedData: BinnedImportanceData | null;
  onBinnedDataChange: (data: BinnedImportanceData) => void;
  activeTab: ShapTab;
  onTabChange: (tab: ShapTab) => void;
  selectedSamples: number[];
  onSamplesChange: (samples: number[]) => void;
}

export function ResultsPanel({
  results,
  jobId,
  binnedData,
  onBinnedDataChange,
  activeTab,
  onTabChange,
  selectedSamples,
  onSamplesChange,
}: ResultsPanelProps) {
  const headerSummary = getShapResultsHeaderSummary(results);
  const waterfallSampleIdx = getShapWaterfallSampleIndex(selectedSamples);
  const initialBinParams = getShapInitialBinningParams(results, binnedData);

  const handleWaterfallSampleChange = useCallback(
    (idx: number) => {
      onSamplesChange(getShapWaterfallSelection(idx));
    },
    [onSamplesChange],
  );

  const handleBeeswarmSelect = useCallback(
    (sampleIdx: number) => {
      onSamplesChange(toggleShapSelectedSample(selectedSamples, sampleIdx));
    },
    [onSamplesChange, selectedSamples],
  );

  return (
    <Card className="h-full">
      <ShapResultsHeader
        jobId={jobId}
        summary={headerSummary}
        initialBinParams={initialBinParams}
        onBinnedDataChange={onBinnedDataChange}
      />
      <ShapResultsTabs
        jobId={jobId}
        results={results}
        binnedData={binnedData}
        activeTab={activeTab}
        onTabChange={onTabChange}
        selectedSamples={selectedSamples}
        onSamplesChange={onSamplesChange}
        waterfallSampleIdx={waterfallSampleIdx}
        onWaterfallSampleChange={handleWaterfallSampleChange}
        onBeeswarmSampleSelect={handleBeeswarmSelect}
      />
    </Card>
  );
}

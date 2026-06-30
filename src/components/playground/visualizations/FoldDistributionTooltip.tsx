import type { ReactNode } from 'react';

import type { GlobalColorMode } from '@/lib/playground/colorConfig';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import { formatYValue } from './chartConfig';
import type { FoldsInfo, YStats } from '@/types/playground';

interface FoldDistributionTooltipProps {
  label: ReactNode;
  entry: PartitionBarData;
  partitionBars: PartitionBarData[];
  folds: FoldsInfo | null;
  effectiveColorMode: GlobalColorMode;
  partitionSegmentKeys: string[];
  getPartitionBarColor: (entry: PartitionBarData, isHighlighted: boolean) => string;
  getPartitionSegmentColor: (segmentKey: string, entry: PartitionBarData) => string;
  getSegmentLabel: (segmentKey: string) => string;
}

export function FoldDistributionTooltip({
  label,
  entry,
  partitionBars,
  folds,
  effectiveColorMode,
  partitionSegmentKeys,
  getPartitionBarColor,
  getPartitionSegmentColor,
  getSegmentLabel,
}: FoldDistributionTooltipProps) {
  const totalSamples = partitionBars.reduce((sum, partition) => sum + partition.count, 0);
  const percentage = totalSamples > 0 ? (entry.count / totalSamples) * 100 : 0;
  const partitionTypeLabel = getPartitionTypeLabel(entry.partitionType);
  const foldData = entry.foldIndex !== null ? folds?.folds[entry.foldIndex] : null;
  const yStats: YStats | undefined = entry.partitionType === 'train'
    ? foldData?.y_train_stats
    : foldData?.y_test_stats;
  const visibleSegmentKeys = effectiveColorMode === 'partition'
    ? []
    : partitionSegmentKeys.filter(segmentKey => (entry.segments[segmentKey] ?? 0) > 0);

  return (
    <div className="bg-card border border-border rounded-lg p-2.5 shadow-lg text-xs min-w-[180px]">
      <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-border">
        <span
          className="w-3 h-3 rounded-sm flex-shrink-0"
          style={{ backgroundColor: getPartitionBarColor(entry, true) }}
        />
        <span className="font-semibold text-foreground">{label}</span>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Type:</span>
          <span className="font-medium">{partitionTypeLabel}</span>
        </div>
        {entry.foldIndex !== null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Fold:</span>
            <span className="font-medium">{entry.foldIndex + 1} of {folds?.n_folds}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Samples:</span>
          <span className="font-medium">{entry.count} ({percentage.toFixed(1)}%)</span>
        </div>
      </div>

      {(yStats || entry.yMean !== undefined) && (
        <div className="mt-2 pt-1.5 border-t border-border space-y-1">
          <div className="text-muted-foreground font-medium mb-1">Y Statistics</div>
          {entry.yMean !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mean:</span>
              <span>{formatYValue(entry.yMean)}</span>
            </div>
          )}
          {entry.yStd !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Std:</span>
              <span>{formatYValue(entry.yStd)}</span>
            </div>
          )}
          {yStats?.min !== undefined && yStats?.max !== undefined && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Range:</span>
              <span>[{formatYValue(yStats.min)}, {formatYValue(yStats.max)}]</span>
            </div>
          )}
        </div>
      )}

      {visibleSegmentKeys.length > 0 && (
        <div className="mt-2 pt-1.5 border-t border-border space-y-1">
          <div className="text-muted-foreground font-medium mb-1">Distribution</div>
          {visibleSegmentKeys.map((segmentKey) => {
            const count = entry.segments[segmentKey] ?? 0;
            const pct = entry.count > 0 ? (count / entry.count) * 100 : 0;
            return (
              <div key={segmentKey} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1">
                  <span
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: getPartitionSegmentColor(segmentKey, entry) }}
                  />
                  <span className="text-muted-foreground">{getSegmentLabel(segmentKey)}:</span>
                </span>
                <span>{count} ({pct.toFixed(0)}%)</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 pt-1 text-[10px] text-muted-foreground/70 text-center">
        Click to select samples
      </div>
    </div>
  );
}

function getPartitionTypeLabel(partitionType: PartitionBarData['partitionType']): string {
  switch (partitionType) {
    case 'train':
      return 'Training';
    case 'val':
      return 'Validation';
    case 'test':
      return 'Test (Held-out)';
  }
}

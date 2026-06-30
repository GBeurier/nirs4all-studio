import type { ComponentProps, MouseEventHandler, ReactNode, Ref } from 'react';
import { LayoutGrid } from 'lucide-react';

import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import {
  FoldDistributionFooter,
  type FoldDistributionFooterProps,
} from './FoldDistributionFooter';
import { FoldDistributionHeaderControls } from './FoldDistributionHeaderControls';
import type { FoldViewMode } from './FoldDistributionHeaderControls';

type FoldDistributionHeaderControlsProps = ComponentProps<typeof FoldDistributionHeaderControls>;

interface FoldDistributionChartSurfaceProps {
  viewMode: FoldViewMode;
  hasYStats: boolean;
  renderCountChart: () => ReactNode;
  renderDistributionChart: () => ReactNode;
}

interface FoldDistributionChartViewProps {
  rootRef: Ref<HTMLDivElement>;
  onBackgroundClick: MouseEventHandler<HTMLDivElement>;
  headerControls: FoldDistributionHeaderControlsProps;
  combinedGroupingNote: string | null;
  viewMode: FoldViewMode;
  hasYStats: boolean;
  renderCountChart: () => ReactNode;
  renderDistributionChart: () => ReactNode;
  footer: FoldDistributionFooterProps<PartitionBarData>;
}

export function FoldDistributionEmptyState() {
  return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <div className="text-center">
        <LayoutGrid className="w-8 h-8 text-muted-foreground/50 mx-auto mb-2" />
        <p>No splitter in pipeline</p>
        <p className="text-xs mt-1">Add a splitter to see fold distribution</p>
      </div>
    </div>
  );
}

function FoldDistributionChartSurface({
  viewMode,
  hasYStats,
  renderCountChart,
  renderDistributionChart,
}: FoldDistributionChartSurfaceProps) {
  return (
    <div className="flex-1 min-h-0">
      {viewMode === 'counts' && renderCountChart()}
      {viewMode === 'distribution' && renderDistributionChart()}
      {viewMode === 'both' && hasYStats && (
        <div className="h-full grid grid-rows-2 gap-2">
          {renderCountChart()}
          {renderDistributionChart()}
        </div>
      )}
    </div>
  );
}

export function FoldDistributionChartView({
  rootRef,
  onBackgroundClick,
  headerControls,
  combinedGroupingNote,
  viewMode,
  hasYStats,
  renderCountChart,
  renderDistributionChart,
  footer,
}: FoldDistributionChartViewProps) {
  return (
    <div className="h-full flex flex-col" ref={rootRef} onClick={onBackgroundClick}>
      <FoldDistributionHeaderControls {...headerControls} />

      {combinedGroupingNote && (
        <p className="mb-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
          {combinedGroupingNote}
        </p>
      )}

      <FoldDistributionChartSurface
        viewMode={viewMode}
        hasYStats={hasYStats}
        renderCountChart={renderCountChart}
        renderDistributionChart={renderDistributionChart}
      />

      <FoldDistributionFooter {...footer} />
    </div>
  );
}

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from 'recharts';

import { CHART_THEME, ANIMATION_CONFIG } from './chartConfig';
import type { GlobalColorMode } from '@/lib/playground/colorConfig';
import type { PartitionBarData } from '@/lib/playground/foldDistributionData';
import {
  getFoldDistributionSegmentSelectionState,
  type FoldDistributionRangeOverlayBounds,
} from '@/lib/playground/foldDistributionInteraction';
import type { FoldsInfo } from '@/types/playground';
import { FoldDistributionTooltip } from './FoldDistributionTooltip';

export interface FoldDistributionChartMouseState {
  activeTooltipIndex?: number;
}

interface FoldDistributionCountChartProps {
  partitionBarData: PartitionBarData[];
  partitionSegmentKeys: string[];
  selectedSamples: Set<number>;
  clickedPartitionId: string | null;
  rangeOverlayBounds: FoldDistributionRangeOverlayBounds | null;
  folds: FoldsInfo | null;
  effectiveColorMode: GlobalColorMode;
  getPartitionBarColor: (entry: PartitionBarData, isHighlighted: boolean) => string;
  getPartitionSegmentColor: (segmentKey: string, entry: PartitionBarData) => string;
  getSegmentLabel: (segmentKey: string) => string;
  onMouseDown: (state: FoldDistributionChartMouseState) => void;
  onMouseMove: (state: FoldDistributionChartMouseState) => void;
  onMouseUp: (state: FoldDistributionChartMouseState) => void;
}

export function FoldDistributionCountChart({
  partitionBarData,
  partitionSegmentKeys,
  selectedSamples,
  clickedPartitionId,
  rangeOverlayBounds,
  folds,
  effectiveColorMode,
  getPartitionBarColor,
  getPartitionSegmentColor,
  getSegmentLabel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
}: FoldDistributionCountChartProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0 relative">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={partitionBarData}
            margin={{ top: 10, right: 10, left: 10, bottom: 5 }}
            layout="horizontal"
            onMouseDown={(state) => {
              onMouseDown(state as FoldDistributionChartMouseState);
            }}
            onMouseMove={(state) => {
              onMouseMove(state as FoldDistributionChartMouseState);
            }}
            onMouseUp={(state) => {
              onMouseUp(state as FoldDistributionChartMouseState);
            }}
          >
            <CartesianGrid
              strokeDasharray={CHART_THEME.gridDasharray}
              stroke={CHART_THEME.gridStroke}
              opacity={CHART_THEME.gridOpacity}
              horizontal
              vertical={false}
            />

            <XAxis
              dataKey="index"
              type="number"
              hide
              domain={[-0.5, partitionBarData.length - 0.5]}
            />
            <YAxis stroke={CHART_THEME.axisStroke} fontSize={CHART_THEME.axisFontSize} width={40} />

            <Tooltip
              isAnimationActive={false}
              contentStyle={{
                backgroundColor: CHART_THEME.tooltipBg,
                border: `1px solid ${CHART_THEME.tooltipBorder}`,
                borderRadius: CHART_THEME.tooltipBorderRadius,
                fontSize: CHART_THEME.tooltipFontSize,
              }}
              content={({ payload, label }) => {
                if (!payload || payload.length === 0) return null;
                const entry = partitionBarData.find(d => d.label === label);
                if (!entry) return null;

                return (
                  <FoldDistributionTooltip
                    label={label}
                    entry={entry}
                    partitionBars={partitionBarData}
                    folds={folds}
                    effectiveColorMode={effectiveColorMode}
                    partitionSegmentKeys={partitionSegmentKeys}
                    getPartitionBarColor={getPartitionBarColor}
                    getPartitionSegmentColor={getPartitionSegmentColor}
                    getSegmentLabel={getSegmentLabel}
                  />
                );
              }}
            />

            {partitionSegmentKeys.map((segKey) => (
              <Bar
                key={segKey}
                dataKey={`segments.${segKey}`}
                name={`segments.${segKey}`}
                stackId="a"
                cursor="pointer"
                {...ANIMATION_CONFIG}
              >
                {partitionBarData.map((entry) => {
                  const { showStroke } = getFoldDistributionSegmentSelectionState(
                    entry,
                    segKey,
                    selectedSamples,
                    clickedPartitionId,
                  );
                  const fillColor = effectiveColorMode === 'partition'
                    ? getPartitionBarColor(entry, true)
                    : getPartitionSegmentColor(segKey, entry);

                  return (
                    <Cell
                      key={`${segKey}-${entry.partitionId}`}
                      fill={fillColor}
                      stroke={showStroke ? 'hsl(var(--foreground))' : 'none'}
                      strokeWidth={showStroke ? 2.5 : 0}
                    />
                  );
                })}
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
        {rangeOverlayBounds && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: rangeOverlayBounds.left,
              right: rangeOverlayBounds.right,
              top: 0,
              bottom: 0,
              backgroundColor: 'hsl(var(--primary) / 0.15)',
              border: '1px dashed hsl(var(--primary) / 0.5)',
            }}
          />
        )}
      </div>
      {partitionBarData.length > 0 && (
        <div
          className="flex text-[10px] text-foreground mt-1"
          style={{ marginLeft: '10px', marginRight: '10px' }}
        >
          {partitionBarData.map((entry) => (
            <div key={entry.partitionId} style={{ flex: 1, textAlign: 'center' }}>
              {entry.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

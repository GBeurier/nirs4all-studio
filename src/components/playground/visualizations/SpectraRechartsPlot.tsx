import {
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';

import {
  CHART_THEME,
  CHART_MARGINS,
  formatWavelength,
} from './chartConfig';
import { getAggregationElements } from './SpectraAggregation';
import { SpectraGroupedAggregationSeries } from './SpectraGroupedAggregationSeries';
import { SpectraReferenceAreas } from './SpectraReferenceAreas';
import {
  SpectraSampleLineSeries,
  type SpectraLineColorSettings,
} from './SpectraSampleLineSeries';
import { SpectraSampleTooltip } from './SpectraSampleTooltip';
import type {
  AggregationMode,
  SpectraViewMode,
} from '@/lib/playground/spectraConfig';
import type {
  SpectraDifferenceRegion,
  SpectraRangeBounds,
  SpectraRectBounds,
} from '@/lib/playground/spectraChartData';
import type { SpectraLineBaseColor } from '@/lib/playground/spectraLineColor';
import type { GlobalColorConfig } from '@/lib/playground/colorConfig';

export interface SpectraRechartsPlotProps {
  filteredData: Array<Record<string, unknown>>;
  highDifferenceRegions: SpectraDifferenceRegion[];
  rangeSelectionBounds: SpectraRangeBounds | null;
  rectSelectionBounds: SpectraRectBounds | null;
  showGroupedAggregation: boolean;
  groupKeys: Array<string | number>;
  aggregationMode: AggregationMode;
  categoricalPalette?: GlobalColorConfig['categoricalPalette'];
  viewMode: SpectraViewMode;
  showOriginal: boolean;
  showProcessed: boolean;
  showDifference: boolean;
  viewModeBoth: boolean;
  displayIndices: number[];
  selectedSamples: ReadonlySet<number>;
  pinnedSamples: ReadonlySet<number>;
  hoveredSample: number | null;
  hasSelection: boolean;
  isSelectedOnlyMode: boolean;
  colorConfig: SpectraLineColorSettings;
  getBaseLineColor: (sampleIndex: number, isOriginal: boolean) => SpectraLineBaseColor;
  referenceLineCount: number;
  enableHover: boolean;
  sampleIds?: string[];
  targetValues?: number[];
  foldLabels?: number[];
  wavelengthAxisName: string;
  wavelengthUnitSuffix: string;
  onClick: (event: unknown) => void;
  onMouseDown: (event: unknown) => void;
  onMouseMove: (event: unknown) => void;
  onMouseLeave: () => void;
}

export function SpectraRechartsPlot({
  filteredData,
  highDifferenceRegions,
  rangeSelectionBounds,
  rectSelectionBounds,
  showGroupedAggregation,
  groupKeys,
  aggregationMode,
  categoricalPalette,
  viewMode,
  showOriginal,
  showProcessed,
  showDifference,
  viewModeBoth,
  displayIndices,
  selectedSamples,
  pinnedSamples,
  hoveredSample,
  hasSelection,
  isSelectedOnlyMode,
  colorConfig,
  getBaseLineColor,
  referenceLineCount,
  enableHover,
  sampleIds,
  targetValues,
  foldLabels,
  wavelengthAxisName,
  wavelengthUnitSuffix,
  onClick,
  onMouseDown,
  onMouseMove,
  onMouseLeave,
}: SpectraRechartsPlotProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart
        data={filteredData}
        margin={CHART_MARGINS.spectra}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={onMouseLeave}
      >
        <CartesianGrid
          strokeDasharray={CHART_THEME.gridDasharray}
          stroke={CHART_THEME.gridStroke}
          opacity={CHART_THEME.gridOpacity}
        />
        <XAxis
          dataKey="wavelength"
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          tickFormatter={formatWavelength}
        />
        <YAxis
          stroke={CHART_THEME.axisStroke}
          fontSize={CHART_THEME.axisFontSize}
          tickFormatter={(value: number) => value.toFixed(2)}
          width={45}
        />

        <SpectraReferenceAreas
          highDifferenceRegions={highDifferenceRegions}
          rangeSelectionBounds={rangeSelectionBounds}
          rectSelectionBounds={rectSelectionBounds}
        />

        {showGroupedAggregation && (
          <SpectraGroupedAggregationSeries
            groupKeys={groupKeys}
            aggregationMode={aggregationMode}
            categoricalPalette={categoricalPalette}
          />
        )}

        {aggregationMode !== 'none' && !showGroupedAggregation && getAggregationElements(
          aggregationMode,
          '',
          viewMode === 'both'
        )}

        <SpectraSampleLineSeries
          displayIndices={displayIndices}
          showOriginal={showOriginal}
          showProcessed={showProcessed}
          showDifference={showDifference}
          viewModeBoth={viewModeBoth}
          selectedSamples={selectedSamples}
          pinnedSamples={pinnedSamples}
          hoveredSample={hoveredSample}
          hasSelection={hasSelection}
          isSelectedOnlyMode={isSelectedOnlyMode}
          colorConfig={colorConfig}
          getBaseLineColor={getBaseLineColor}
          referenceLineCount={referenceLineCount}
        />

        <Tooltip
          isAnimationActive={false}
          cursor={enableHover ? { stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 2' } : false}
          content={({ active, payload }) => (
            <SpectraSampleTooltip
              enableHover={enableHover}
              active={active}
              payload={payload}
              hoveredSample={hoveredSample}
              sampleIds={sampleIds}
              targetValues={targetValues}
              foldLabels={foldLabels}
              displayIndices={displayIndices}
              wavelengthAxisName={wavelengthAxisName}
              wavelengthUnitSuffix={wavelengthUnitSuffix}
            />
          )}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

import type { GlobalColorConfig } from '@/lib/playground/colorConfig';
import type { SpectraChartConfig } from '@/lib/playground/spectraConfig';
import type { FoldsInfo } from '@/types/playground';
import type { AggregatedStats } from './SpectraAggregation';
import type { SpectraRechartsPlotProps } from './SpectraRechartsPlot';
import type { SpectraWebGLBranchProps } from './SpectraWebGLBranch';

type SpectraRendererConfig = Pick<
  SpectraChartConfig,
  'aggregation' | 'colorConfig' | 'displayMode' | 'enableHover' | 'viewMode'
>;

type SpectraWebGLRendererConfig = Pick<
  SpectraChartConfig,
  'colorConfig' | 'displayMode' | 'enableHover' | 'viewMode'
>;

export interface BuildSpectraWebGLBranchPropsInput {
  config: SpectraWebGLRendererConfig;
  wavelengthAxisLabel: string;
  originalSpectra: number[][];
  focusedSpectra: number[][];
  focusedWavelengths: number[];
  y?: number[];
  sampleIds?: string[];
  folds?: FoldsInfo | null;
  displayIndices: number[];
  sampleColors?: string[];
  aggregatedStats: AggregatedStats | null;
  groupedStats: Map<string | number, AggregatedStats> | null;
  useSelectionContext: boolean;
  isLoading: boolean;
}

export type BuildSpectraRechartsPlotPropsInput = Omit<
  SpectraRechartsPlotProps,
  | 'aggregationMode'
  | 'categoricalPalette'
  | 'viewMode'
  | 'showDifference'
  | 'viewModeBoth'
  | 'colorConfig'
  | 'referenceLineCount'
  | 'enableHover'
> & {
  config: SpectraRendererConfig;
  categoricalPalette?: GlobalColorConfig['categoricalPalette'];
  referenceSpectraCount: number;
};

function isAggregatedDisplayMode(displayMode: SpectraChartConfig['displayMode']) {
  return displayMode === 'aggregated' || displayMode === 'grouped';
}

function buildSpectraLineColorConfig(colorConfig: SpectraChartConfig['colorConfig']): SpectraRechartsPlotProps['colorConfig'] {
  const colorConfigWithSelection = colorConfig as SpectraChartConfig['colorConfig'] & {
    selectionOverride?: boolean;
  };

  return {
    selectionOverride: colorConfigWithSelection.selectionOverride ?? false,
    highlightPinned: colorConfig.highlightPinned,
    selectionColor: colorConfig.selectionColor,
    unselectedOpacity: colorConfig.unselectedOpacity,
  };
}

export function buildSpectraWebGLBranchProps({
  config,
  wavelengthAxisLabel,
  originalSpectra,
  focusedSpectra,
  focusedWavelengths,
  y,
  sampleIds,
  folds,
  displayIndices,
  sampleColors,
  aggregatedStats,
  groupedStats,
  useSelectionContext,
  isLoading,
}: BuildSpectraWebGLBranchPropsInput): SpectraWebGLBranchProps {
  const aggregatedDisplayMode = isAggregatedDisplayMode(config.displayMode);

  return {
    xLabel: wavelengthAxisLabel,
    spectra: aggregatedDisplayMode
      ? []
      : config.viewMode === 'original'
        ? originalSpectra
        : focusedSpectra,
    originalSpectra: config.viewMode === 'both' && !aggregatedDisplayMode ? originalSpectra : undefined,
    wavelengths: focusedWavelengths,
    y: aggregatedDisplayMode ? undefined : y,
    sampleIds,
    folds: folds ?? undefined,
    visibleIndices: aggregatedDisplayMode ? undefined : displayIndices,
    sampleColors,
    aggregatedStats: config.displayMode === 'aggregated' && aggregatedStats ? aggregatedStats : undefined,
    groupedStats: config.displayMode === 'grouped' && groupedStats ? groupedStats : undefined,
    useSelectionContext: !aggregatedDisplayMode && useSelectionContext,
    selectedColor: config.colorConfig.selectionColor,
    applySelectionColoring: config.displayMode !== 'selected_only',
    unselectedOpacity: config.colorConfig.unselectedOpacity,
    enableHover: config.enableHover,
    showHoverTooltip: config.enableHover,
    isLoading,
    className: 'absolute inset-0',
  };
}

export function buildSpectraRechartsPlotProps({
  config,
  categoricalPalette,
  referenceSpectraCount,
  ...props
}: BuildSpectraRechartsPlotPropsInput): SpectraRechartsPlotProps {
  return {
    ...props,
    aggregationMode: config.aggregation.mode,
    categoricalPalette,
    viewMode: config.viewMode,
    showDifference: config.viewMode === 'difference',
    viewModeBoth: config.viewMode === 'both',
    colorConfig: buildSpectraLineColorConfig(config.colorConfig),
    referenceLineCount: Math.min(referenceSpectraCount, props.displayIndices.length),
    enableHover: config.enableHover,
  };
}

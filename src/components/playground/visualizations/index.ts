// Chart components
export { SpectraChart } from './SpectraChart';
export { SpectraChartV2 } from './SpectraChartV2';
export { YHistogram } from './YHistogram';
export { YHistogramV2 } from './YHistogramV2';
export { PCAPlot } from './PCAPlot';
export { DimensionReductionChart } from './DimensionReductionChart';
export { FoldDistributionChart } from './FoldDistributionChart';
export { FoldDistributionChartV2 } from './FoldDistributionChartV2';
export { RepetitionsChart } from './RepetitionsChart';
export type { RepetitionColorMode, DistanceMetric } from './RepetitionsChart';
export { ScatterPlot3D } from './ScatterPlot3D';
export { ChartSkeleton } from './ChartSkeleton';

// Phase 6: WebGL Renderers for high-performance visualization
export { SpectraWebGL } from './SpectraWebGL';
export type { SpectraWebGLProps, QualityMode } from './SpectraWebGL';
export { ScatterWebGL } from './ScatterWebGL';
export type { ScatterWebGLProps } from './ScatterWebGL';

// Error boundary for chart safety
export { ChartErrorBoundary } from './ChartErrorBoundary';

// Shared config
export * from './chartConfig';

// Phase 2: Enhanced Spectra Chart components
export { SpectraChartToolbar } from './SpectraChartToolbar';
export { WavelengthRangePicker } from './WavelengthRangePicker';
export { SpectraFilterPanel } from './SpectraFilterPanel';
export { SourceDatasetSelector, buildSourceOptions } from './SourceDatasetSelector';
export type { SourceOption, SourceDatasetSelectorProps } from './SourceDatasetSelector';
export * from './SpectraAggregation';

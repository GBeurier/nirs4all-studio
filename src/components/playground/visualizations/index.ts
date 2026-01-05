// Legacy components (deprecated - use *New versions)
export { SpectraChart } from './SpectraChart';
export { YHistogram } from './YHistogram';
export { PCAPlot } from './PCAPlot';
export { DifferenceScatterPlot } from './DifferenceScatterPlot';
export { FoldBoxPlots } from './FoldBoxPlots';
export { ChartSkeleton } from './ChartSkeleton';

// New components using backend data
export { SpectraChartNew } from './SpectraChartNew';
export { PCAPlotNew } from './PCAPlotNew';
export { YHistogramNew } from './YHistogramNew';
export { FoldDistributionChart } from './FoldDistributionChart';

// Error boundary for chart safety
export { ChartErrorBoundary } from './ChartErrorBoundary';

// Shared config
export * from './chartConfig';

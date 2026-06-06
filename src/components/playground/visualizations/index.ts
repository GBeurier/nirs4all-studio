/**
 * Playground Visualization Components
 */

// ============= Primary Chart Components =============

// SpectraChart - Enhanced with Phase 3 features + WebGL support
export { SpectraChart } from './SpectraChart';

// YHistogram - Enhanced with KDE, ridge plots, etc.
export { YHistogram } from './histogram';

// FoldDistributionChart - Enhanced with SelectionContext and advanced coloring
export { FoldDistributionChart } from './FoldDistributionChart';

// Unified components (no V1/V2 variants)
export { DimensionReductionChart } from './DimensionReductionChart';
export { RepetitionsChart } from './RepetitionsChart';
export { ScatterPlot3D } from './ScatterPlot3D';

// ============= Utility Components =============

export { ChartSkeleton } from './ChartSkeleton';
export { ChartErrorBoundary } from './ChartErrorBoundary';

// ============= WebGL Renderers (Phase 6) =============

export { SpectraWebGL } from './SpectraWebGL';
export type { SpectraWebGLProps, QualityMode } from './SpectraWebGL';
export { ScatterWebGL } from './ScatterWebGL';
export type { ScatterWebGLProps } from './ScatterWebGL';

// ============= Shared Configuration =============

export * from './chartConfig';

// ============= Spectra Chart Sub-components (Phase 2) =============

export { SpectraChartToolbar } from './SpectraChartToolbar';
export { WavelengthRangePicker } from './WavelengthRangePicker';
export { SpectraFilterPanel } from './SpectraFilterPanel';
export { SourceDatasetSelector, buildSourceOptions } from './SourceDatasetSelector';
export type { SourceOption, SourceDatasetSelectorProps } from './SourceDatasetSelector';
export * from './SpectraAggregation';

// ============= Phase 3: Enhanced Settings Popup =============

export { SpectraSettingsPopup } from './SpectraSettingsPopup';
export { SpectraContextMenu } from './SpectraContextMenu';

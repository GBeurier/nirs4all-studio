/**
 * Playground Components
 *
 * Phase 1 Refactoring: Component Modularization
 */

// Core components
export { PlaygroundSidebar } from './PlaygroundSidebar';
export { MainCanvas } from './MainCanvas';
export { DataUpload } from './DataUpload';
export { OperatorPalette } from './OperatorPalette';
export { PipelineBuilder } from './PipelineBuilder';
export { UnifiedOperatorCard } from './UnifiedOperatorCard';
export { ExecutionStatus, ExecutionTrace, ErrorDisplay } from './ExecutionStatus';
export { StepComparisonSlider } from './StepComparisonSlider';

// Phase 1: Extracted components for better modularity
export { CanvasToolbar, CHART_CONFIG } from './CanvasToolbar';
export type { ChartType, ChartConfig as ToolbarChartConfig, CanvasToolbarProps } from './CanvasToolbar';
export { ChartPanel, ChartLoadingOverlay, ChartErrorBoundary } from './ChartPanel';
export type { ChartPanelProps } from './ChartPanel';

// Phase 1: Extracted hooks
export * from './hooks';

// Selection components
export {
  SelectionContainer,
  SelectionModeToggle,
  SelectionActionsBar,
  SelectionOverlay,
  isPointInPolygon,
  isPointInBox,
  type SelectionToolType,
  type Point,
  type SelectionBounds,
  type SelectionResult,
} from './SelectionTools';

// Utility components
export { SampleDetails } from './SampleDetails';
export { ColorLegend } from './ColorLegend';

// Phase 4: Repetitions and Chart Registry
export { RepetitionSetupDialog } from './RepetitionSetupDialog';
export type { RepetitionConfig, DetectionMethod } from './RepetitionSetupDialog';
export {
  chartRegistry,
  getChartConfig,
  buildEffectiveVisibility,
  computeRecommendedVisibility,
  getToggleableCharts,
  CHART_DEFINITIONS,
} from './ChartRegistry';
export type {
  ChartDefinition,
  ChartVisibility,
  BaseChartProps,
} from './ChartRegistry';

// Phase 4: Display Filtering System
export { DisplayFilters } from './DisplayFilters';
export type { DisplayFiltersProps } from './DisplayFilters';

// Phase 6: Performance & Polish components
export { SavedSelections } from './SavedSelections';
export { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

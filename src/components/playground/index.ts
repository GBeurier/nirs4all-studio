// Core components
export { PlaygroundSidebar } from './PlaygroundSidebar';
export { MainCanvas } from './MainCanvas';
export { DataUpload } from './DataUpload';
export { OperatorPalette } from './OperatorPalette';
export { PipelineBuilder } from './PipelineBuilder';
export { UnifiedOperatorCard } from './UnifiedOperatorCard';
export { ExecutionStatus, ExecutionTrace, ErrorDisplay } from './ExecutionStatus';
export { StepComparisonSlider } from './StepComparisonSlider';

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
export { ColorModeSelector } from './ColorModeSelector';
export { SampleDetails } from './SampleDetails';

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

// Phase 6: Performance & Polish components
export { SavedSelections } from './SavedSelections';
export { KeyboardShortcutsHelp } from './KeyboardShortcutsHelp';

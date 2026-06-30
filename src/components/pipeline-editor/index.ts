// Core pipeline components
export { StepPalette } from "./StepPalette";
export { PipelineCanvas } from "./PipelineCanvas";
export { PipelineTree } from "./PipelineTree";
export { TreeNode } from "./TreeNode";
export { PipelineNode } from "./PipelineNode";
export { StepConfigPanel } from "./StepConfigPanel";
export { PipelineDndProvider } from "./PipelineDndContext";
export { usePipelineDnd } from "./usePipelineDnd";
export { PipelineEditorActionsMenu } from "./PipelineEditorActionsMenu";
export { PipelineEditorHeader } from "./PipelineEditorHeader";
export { PipelineEditorHeaderBadges } from "./PipelineEditorHeaderBadges";
export { PipelineEditorRouteOverlays } from "./PipelineEditorRouteOverlays";
export { PipelineEditorSettingsPopover } from "./PipelineEditorSettingsPopover";
export { PipelineEditorWorkspace } from "./PipelineEditorWorkspace";

// Phase 1: Foundation - Shared components and contexts
export * from "./shared";
export * from "./contexts";

// Phase 2: Generation UX components
export { SweepConfigPopover, SweepActivator, SweepBadge } from "./SweepConfigPopover";
export {
  OrOptionItem,
  OrGeneratorContainer,
  OrGeneratorDropZone,
  WrapInOrGeneratorPopover,
} from "./OrGenerator";
export {
  CartesianStage,
  CartesianGeneratorContainer,
  CartesianPreview,
} from "./CartesianGenerator";
export { SweepsSummaryPanel, SweepVsFinetuningAdvisor } from "./SweepsSummaryPanel";
export {
  StepContextMenu,
  GeneratorContextMenu,
  BranchContextMenu,
} from "./StepContextMenu";

// Phase 3: Finetuning UX components
export {
  FinetuneTab,
  FinetuneEnableToggle,
  FinetuneSearchConfig,
  FinetuneParamList,
  FinetuneParamEditor,
  FinetuningBadge,
  QuickFinetuneButton,
  defaultFinetuneConfig,
} from "./FinetuneConfig";

// Phase 4: Advanced Pipeline Features
export {
  YProcessingPanel,
  YProcessingCompact,
  YProcessingBadge,
  YProcessingQuickSetup,
} from "./YProcessingPanel";
export {
  Y_PROCESSING_OPTIONS,
  defaultYProcessingConfig,
  type YProcessingConfig,
} from "./yProcessingConfig";

export {
  FeatureAugmentationPanel,
  FeatureAugmentationCompact,
  FeatureAugmentationBadge,
} from "./FeatureAugmentationPanel";
export {
  defaultFeatureAugmentationConfig,
  type FeatureAugmentationConfig,
  type FeatureAugmentationTransform,
  type FeatureAugmentationAction,
} from "./featureAugmentationConfig";

export {
  StackingPanel,
  StackingBadge,
  MergeStackingSetup,
} from "./StackingPanel";
export {
  defaultStackingConfig,
  type StackingConfig,
} from "./stackingConfig";

export {
  EnhancedBranchHeader,
  BranchSummary,
  BranchOutputIndicator,
  CollapsibleBranchContainer,
  AddBranchButton,
  CollapseAllButton,
  type BranchMetadata,
} from "./BranchEnhancements";

// Phase 5: UX Polish
export { CommandPalette, type CommandPaletteProps } from "./CommandPalette";
export { KeyboardShortcutsDialog } from "./KeyboardShortcutsDialog";
export {
  ExecutionPreviewPanel,
  ExecutionPreviewCompact,
} from "./ExecutionPreviewPanel";
export type { ExecutionBreakdown } from "./executionAnalysis";
export {
  FocusPanelRing,
  FocusBadge,
  NavigationHint,
  NavigationStatusBar,
  StepNavigationHighlight,
} from "./FocusIndicator";

// Phase 6: Integration & Documentation
export { PipelineExecutionDialog } from "./PipelineExecutionDialog";
export {
  HelpTooltip,
  ParameterHelp,
  OperatorHelpCard,
  WhatsThisButton,
  OperatorHelpPanel,
  InfoCallout,
} from "./HelpSystem";
export { HelpModeProvider } from "./HelpModeProvider";
export { useHelpMode } from "./useHelpMode";
export { getOperatorHelp, type OperatorHelp } from "./helpContent";

// Phase 4 (Roadmap): Pipeline-Dataset Integration
export {
  DatasetBinding,
  DatasetShapeDisplay,
  ShapeChangeIndicator,
  DimensionWarningBadge,
  type BoundDataset,
  type DataShape,
  type DatasetBindingProps,
  type DatasetShapeDisplayProps,
  type ShapeChangeIndicatorProps,
  type DimensionWarningBadgeProps,
} from "./DatasetBinding";

// Phase 5: Native Pipeline Format
export { PipelineYAMLView, type PipelineYAMLViewProps } from "./PipelineYAMLView";

// Types and utilities
export * from "./types";

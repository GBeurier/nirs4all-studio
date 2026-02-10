// Core pipeline components
export { StepPalette } from "./StepPalette";
export { PipelineCanvas } from "./PipelineCanvas";
export { PipelineTree } from "./PipelineTree";
export { TreeNode } from "./TreeNode";
export { PipelineNode } from "./PipelineNode";
export { StepConfigPanel } from "./StepConfigPanel";
export { PipelineDndProvider, usePipelineDnd } from "./PipelineDndContext";

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
  Y_PROCESSING_OPTIONS,
  defaultYProcessingConfig,
  type YProcessingConfig,
} from "./YProcessingPanel";

export {
  FeatureAugmentationPanel,
  FeatureAugmentationCompact,
  FeatureAugmentationBadge,
  defaultFeatureAugmentationConfig,
  type FeatureAugmentationConfig,
  type FeatureAugmentationTransform,
  type FeatureAugmentationAction,
} from "./FeatureAugmentationPanel";

export {
  StackingPanel,
  StackingBadge,
  MergeStackingSetup,
  defaultStackingConfig,
  type StackingConfig,
} from "./StackingPanel";

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
  type ExecutionBreakdown,
} from "./ExecutionPreviewPanel";
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
  HelpModeProvider,
  useHelpMode,
  getOperatorHelp,
  type OperatorHelp,
} from "./HelpSystem";

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

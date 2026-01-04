/**
 * Shared types for TreeNode components
 *
 * @see docs/_internals/component_refactoring_specs.md
 */

import type { PipelineStep, StepType } from "../../types";
import type { LucideIcon } from "lucide-react";

/**
 * Color configuration for step types
 */
export interface StepColors {
  bg: string;
  border: string;
  text: string;
  hover?: string;
  selected?: string;
  active?: string;
}

/**
 * Base props for all tree node components
 */
export interface TreeNodeBaseProps {
  step: PipelineStep;
  isSelected: boolean;
  depth: number;
}

/**
 * Props for TreeNode main component
 */
export interface TreeNodeProps {
  step: PipelineStep;
  index: number;
  path: string[];
  depth: number;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddBranch?: () => void;
  onRemoveBranch?: (branchIndex: number) => void;
  // For nested recursion
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranchNested?: (stepId: string, path?: string[]) => void;
  onRemoveBranchNested?: (stepId: string, branchIndex: number, path?: string[]) => void;
  // For container children
  onAddChild?: (stepId: string, path?: string[]) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  onUpdateStep?: (stepId: string, updates: Partial<PipelineStep>, path?: string[]) => void;
}

/**
 * Props for BranchNode component
 */
export interface BranchNodeProps {
  branch: PipelineStep[];
  branchIndex: number;
  parentPath: string[];
  parentStepId: string;
  depth: number;
  canRemove: boolean;
  onRemoveBranch?: (branchIndex: number) => void;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveStep: (id: string, path?: string[]) => void;
  onDuplicateStep: (id: string, path?: string[]) => void;
  onAddBranchNested?: (stepId: string, path?: string[]) => void;
  onRemoveBranchNested?: (stepId: string, branchIndex: number, path?: string[]) => void;
  onAddChild?: (stepId: string, path?: string[]) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  isGenerator?: boolean;
  branchLabel?: string;
}

/**
 * Props for ContainerChildrenNode component
 */
export interface ContainerChildrenNodeProps {
  children: PipelineStep[];
  parentStep: PipelineStep;
  parentPath: string[];
  depth: number;
  childLabel: string;
  selectedStepId: string | null;
  onSelectStep: (id: string | null) => void;
  onRemoveChild?: (stepId: string, childId: string, path?: string[]) => void;
  onAddChild?: (stepId: string, path?: string[]) => void;
  colors: StepColors;
}

/**
 * Props for ContainerChildItem component
 */
export interface ContainerChildItemProps {
  child: PipelineStep;
  index: number;
  parentStep: PipelineStep;
  parentPath: string[];
  childLabel: string;
  isSelected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  colors: StepColors;
}

/**
 * Props for NodeHeader component
 */
export interface NodeHeaderProps {
  step: PipelineStep;
  Icon: LucideIcon;
  colors: StepColors;
  hasSweeps: boolean;
  totalVariants: number;
  sweepCount: number;
  sweepSummary: string;
  hasFinetuning: boolean;
  finetuneTrials: number;
  finetuneParamCount: number;
  displayParams: string;
  isContainer: boolean;
  containerChildren: PipelineStep[];
  childLabel: string;
}

/**
 * Props for NodeActions component
 */
export interface NodeActionsProps {
  onDuplicate: () => void;
  onRemove: () => void;
  visible?: boolean;
}

/**
 * Props for NodeDragHandle component
 */
export interface NodeDragHandleProps {
  attributes: Record<string, unknown>;
  listeners: Record<string, unknown>;
}

/**
 * Props for BranchDropZone component
 */
export interface BranchDropZoneProps {
  id: string;
  path: string[];
  index: number;
}

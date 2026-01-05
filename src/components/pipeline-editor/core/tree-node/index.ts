/**
 * tree-node module exports
 *
 * Provides the refactored TreeNode component and its sub-components.
 */

export { TreeNode } from "./TreeNode";
export { NodeHeader } from "./NodeHeader";
export { NodeActions } from "./NodeActions";
export { NodeDragHandle } from "./NodeDragHandle";
export { BranchNode } from "./BranchNode";
export { BranchDropZone } from "./BranchDropZone";
export { ContainerChildrenNode, ContainerChildItem } from "./ContainerChildren";

// Re-export types
export type {
  TreeNodeProps,
  BranchNodeProps,
  ContainerChildrenNodeProps,
  ContainerChildItemProps,
  NodeHeaderProps,
  NodeActionsProps,
  BranchDropZoneProps,
} from "./types";

// Re-export utilities
export {
  stepIcons,
  isContainerStep,
  hasChildren,
  getContainerChildLabel,
  isBranchableStep,
  getBranchLabel,
  computeSweepInfo,
  computeFinetuneInfo,
  computeGeneratorInfo,
} from "./utils";

export type { SweepInfo, FinetuneInfo, GeneratorInfo } from "./utils";

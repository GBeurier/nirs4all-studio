/**
 * TreeNode - Re-export for backwards compatibility
 *
 * The TreeNode component has been refactored into the core/tree-node/ module
 * with separate sub-components for better maintainability.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/component_refactoring_specs.md
 */

export { TreeNode } from "./core/tree-node";
export type { TreeNodeProps, BranchNodeProps } from "./core/tree-node";

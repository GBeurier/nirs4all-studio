/**
 * Custom Node Module
 *
 * Provides custom node storage, validation, and React hooks
 * for user-defined operators in the pipeline editor.
 *
 * @see docs/_internals/node_specifications.md Section 6
 */

export {
  CustomNodeStorage,
  type CustomNodeNamespace,
  type CustomNodeSecurityConfig,
  type CustomNodeValidationResult,
  type CustomNodeStorageEvent,
  NAMESPACE_PRIORITY,
  DEFAULT_ALLOWED_PACKAGES,
  generateCustomNodeId,
  parseNamespace,
  isCustomNodeId,
  createCustomNodeTemplate,
  createParameterTemplate,
} from './CustomNodeStorage';

export {
  useCustomNodes,
  type UseCustomNodesReturn,
} from './useCustomNodes';

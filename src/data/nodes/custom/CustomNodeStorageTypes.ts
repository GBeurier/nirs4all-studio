/**
 * CustomNodeStorageTypes - Shared types & constants for custom node storage.
 *
 * Pure, dependency-free declarations (no localStorage, no API, no class state).
 * Extracted from CustomNodeStorage so the sibling helper modules
 * (Sync / Workspace / Policy) can depend on these contracts without importing
 * the orchestrator class, breaking the type-only cycle through CustomNodeStorage.
 *
 * CustomNodeStorage re-exports every symbol here, so public consumers are
 * unaffected.
 */

import type { NodeDefinition } from '../types';

// ============================================================================
// Source tracking
// ============================================================================

/**
 * Source of a custom node.
 */
export type CustomNodeSource = 'local' | 'workspace' | 'admin';

/**
 * Priority levels for source resolution.
 * Higher priority = wins on conflict.
 */
export const SOURCE_PRIORITY: Record<CustomNodeSource, number> = {
  admin: 100,
  workspace: 50,
  local: 25,
};

/**
 * Default allowed packages for custom node classPath validation.
 */
export const DEFAULT_ALLOWED_PACKAGES = [
  'nirs4all',
  'sklearn',
  'scipy',
  'numpy',
  'pandas',
];

// ============================================================================
// Security configuration
// ============================================================================

/**
 * Configuration for custom node security.
 */
export interface CustomNodeSecurityConfig {
  /** Master switch for custom nodes */
  allowCustomNodes: boolean;
  /** Allowed package prefixes for classPath */
  allowedPackages: string[];
  /** Require admin approval for custom nodes */
  requireApproval: boolean;
  /** Allow users to add packages to allowlist */
  allowUserPackages: boolean;
}

// ============================================================================
// Validation
// ============================================================================

/**
 * Result of validating a custom node definition.
 */
export interface CustomNodeValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

// ============================================================================
// Events
// ============================================================================

/**
 * Storage event for custom node changes.
 */
export interface CustomNodeStorageEvent {
  type: 'add' | 'update' | 'remove' | 'clear' | 'import' | 'sync';
  nodeId?: string;
  timestamp: number;
}

// ============================================================================
// Tracked node definition
// ============================================================================

/**
 * Extended node definition with source tracking.
 */
export interface TrackedNodeDefinition extends NodeDefinition {
  _storageSource?: CustomNodeSource;
  _lastSynced?: string;
}

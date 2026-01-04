/**
 * Validation System Types
 *
 * Core types for the pipeline validation system.
 * Provides multi-level validation with clear error reporting.
 *
 * @see docs/_internals/implementation_roadmap.md Phase 4
 */

import type { PipelineStep, StepType } from "../types";
import type { ParameterDefinition } from "@/data/nodes/types";

// ============================================================================
// Validation Severity & Codes
// ============================================================================

/**
 * Validation issue severity levels.
 * - error: Blocks pipeline execution, must be fixed
 * - warning: May cause issues, should be reviewed
 * - info: Informational, optional improvement
 */
export type ValidationSeverity = "error" | "warning" | "info";

/**
 * Validation rule categories for organization and filtering.
 */
export type ValidationCategory =
  | "parameter"       // Parameter-level validation
  | "step"            // Single step validation
  | "pipeline"        // Pipeline structure validation
  | "dependency"      // Step ordering and dependencies
  | "compatibility";  // nirs4all compatibility

/**
 * Standardized validation error codes.
 * Format: CATEGORY_ISSUE
 */
export type ValidationErrorCode =
  // Parameter validation
  | "PARAM_REQUIRED"
  | "PARAM_TYPE_MISMATCH"
  | "PARAM_OUT_OF_RANGE"
  | "PARAM_INVALID_VALUE"
  | "PARAM_PATTERN_MISMATCH"
  | "PARAM_LENGTH_EXCEEDED"
  // Step validation
  | "STEP_UNKNOWN_TYPE"
  | "STEP_INVALID_NAME"
  | "STEP_DUPLICATE_ID"
  | "STEP_EMPTY_CONTAINER"
  | "STEP_EMPTY_BRANCHES"
  // Pipeline structure
  | "PIPELINE_NO_MODEL"
  | "PIPELINE_NO_SPLITTER"
  | "PIPELINE_EMPTY"
  | "PIPELINE_MODEL_BEFORE_SPLITTER"
  | "PIPELINE_MERGE_WITHOUT_BRANCH"
  | "PIPELINE_MULTIPLE_MODELS"
  // Dependency validation
  | "DEP_INVALID_ORDER"
  | "DEP_MISSING_PREREQUISITE"
  | "DEP_CIRCULAR_REFERENCE"
  // Compatibility
  | "COMPAT_DEPRECATED"
  | "COMPAT_VERSION_MISMATCH"
  | "COMPAT_UNKNOWN_CLASS";

// ============================================================================
// Validation Issue
// ============================================================================

/**
 * Location context for a validation issue.
 */
export interface ValidationLocation {
  /** Step ID where the issue occurs */
  stepId?: string;
  /** Step name for display */
  stepName?: string;
  /** Step type */
  stepType?: StepType;
  /** Step index in pipeline (0-based) */
  stepIndex?: number;
  /** Parameter name if parameter-level issue */
  paramName?: string;
  /** Branch index for nested issues */
  branchIndex?: number;
  /** Path to nested step (for deep nesting) */
  path?: string[];
}

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  /** Unique issue ID */
  id: string;
  /** Error code for programmatic handling */
  code: ValidationErrorCode;
  /** Severity level */
  severity: ValidationSeverity;
  /** Category for grouping */
  category: ValidationCategory;
  /** Human-readable message */
  message: string;
  /** Extended help text */
  details?: string;
  /** Location in the pipeline */
  location: ValidationLocation;
  /** Suggested fix */
  suggestion?: string;
  /** Related issue IDs */
  relatedIssues?: string[];
  /** Quick fix action ID */
  quickFix?: string;
}

// ============================================================================
// Validation Context
// ============================================================================

/**
 * Context passed to validators.
 */
export interface ValidationContext {
  /** All steps in the pipeline */
  steps: PipelineStep[];
  /** Currently selected step ID */
  selectedStepId?: string;
  /** Whether validation should be strict */
  strictMode?: boolean;
  /** Disable specific rule codes */
  disabledRules?: ValidationErrorCode[];
  /** Custom validation options */
  options?: Record<string, unknown>;
}

// ============================================================================
// Validation Result
// ============================================================================

/**
 * Per-step validation summary.
 */
export interface StepValidationResult {
  stepId: string;
  stepName: string;
  stepType: StepType;
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
}

/**
 * Complete pipeline validation result.
 */
export interface PipelineValidationResult {
  /** Whether pipeline is valid (no errors) */
  isValid: boolean;
  /** Timestamp of validation */
  timestamp: number;
  /** All validation issues */
  issues: ValidationIssue[];
  /** Grouped by severity */
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  infos: ValidationIssue[];
  /** Per-step results for step highlighting */
  stepResults: Map<string, StepValidationResult>;
  /** Summary counts */
  summary: {
    errorCount: number;
    warningCount: number;
    infoCount: number;
    stepsWithErrors: number;
    stepsWithWarnings: number;
    totalSteps: number;
  };
}

// ============================================================================
// Validator Interface
// ============================================================================

/**
 * Base validator interface for implementing custom validators.
 */
export interface Validator {
  /** Unique validator name */
  name: string;
  /** Validator category */
  category: ValidationCategory;
  /** Validation priority (lower runs first) */
  priority: number;
  /** Whether validator is enabled */
  enabled: boolean;
  /** Run validation */
  validate(context: ValidationContext): ValidationIssue[];
}

/**
 * Parameter validator for single parameter validation.
 */
export interface ParameterValidator {
  /** Validate a parameter value */
  validate(
    value: unknown,
    definition: ParameterDefinition,
    step: PipelineStep
  ): ValidationIssue[];
}

/**
 * Step validator for single step validation.
 */
export interface StepValidator {
  /** Validate a single step */
  validate(
    step: PipelineStep,
    context: ValidationContext
  ): ValidationIssue[];
}

/**
 * Pipeline validator for structure validation.
 */
export interface PipelineValidator {
  /** Validate pipeline structure */
  validate(context: ValidationContext): ValidationIssue[];
}

// ============================================================================
// Validation Rules
// ============================================================================

/**
 * Rule definition for configurable validation.
 */
export interface ValidationRule {
  /** Rule code */
  code: ValidationErrorCode;
  /** Default severity */
  severity: ValidationSeverity;
  /** Category */
  category: ValidationCategory;
  /** Human-readable name */
  name: string;
  /** Description */
  description: string;
  /** Whether rule can be disabled */
  canDisable: boolean;
  /** Whether rule is enabled by default */
  defaultEnabled: boolean;
}

// ============================================================================
// Quick Fixes
// ============================================================================

/**
 * Quick fix action definition.
 */
export interface QuickFix {
  /** Fix ID */
  id: string;
  /** Display label */
  label: string;
  /** Description */
  description?: string;
  /** Apply the fix */
  apply: (
    issue: ValidationIssue,
    steps: PipelineStep[],
    updateSteps: (steps: PipelineStep[]) => void
  ) => void;
}

// ============================================================================
// Validation State
// ============================================================================

/**
 * Validation state for the UI.
 */
export interface ValidationState {
  /** Current validation result */
  result: PipelineValidationResult | null;
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Last validation timestamp */
  lastValidated: number | null;
  /** Validation is stale (steps changed since last validation) */
  isStale: boolean;
  /** Disabled rule codes */
  disabledRules: Set<ValidationErrorCode>;
}

/**
 * Initial validation state.
 */
export const initialValidationState: ValidationState = {
  result: null,
  isValidating: false,
  lastValidated: null,
  isStale: true,
  disabledRules: new Set(),
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique issue ID.
 */
export function generateIssueId(): string {
  return `issue-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Create an empty validation result.
 */
export function createEmptyValidationResult(): PipelineValidationResult {
  return {
    isValid: true,
    timestamp: Date.now(),
    issues: [],
    errors: [],
    warnings: [],
    infos: [],
    stepResults: new Map(),
    summary: {
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
      stepsWithErrors: 0,
      stepsWithWarnings: 0,
      totalSteps: 0,
    },
  };
}

/**
 * Check if a validation result has any issues of given severity.
 */
export function hasSeverity(
  result: PipelineValidationResult,
  severity: ValidationSeverity
): boolean {
  switch (severity) {
    case "error":
      return result.errors.length > 0;
    case "warning":
      return result.warnings.length > 0;
    case "info":
      return result.infos.length > 0;
  }
}

/**
 * Get issues for a specific step.
 */
export function getStepIssues(
  result: PipelineValidationResult,
  stepId: string
): ValidationIssue[] {
  return result.issues.filter((issue) => issue.location.stepId === stepId);
}

/**
 * Get issues for a specific parameter.
 */
export function getParameterIssues(
  result: PipelineValidationResult,
  stepId: string,
  paramName: string
): ValidationIssue[] {
  return result.issues.filter(
    (issue) =>
      issue.location.stepId === stepId &&
      issue.location.paramName === paramName
  );
}

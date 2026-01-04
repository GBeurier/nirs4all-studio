/**
 * ValidationContext
 *
 * React context for sharing validation state across the pipeline editor.
 * Provides validation result and utilities to all child components.
 *
 * @see docs/_internals/implementation_roadmap.md Phase 4
 */

import React, { createContext, useContext, useMemo, useCallback } from "react";
import type { PipelineStep } from "../types";
import type {
  PipelineValidationResult,
  ValidationIssue,
  ValidationErrorCode,
} from "./types";
import { useValidation, type UseValidationOptions } from "./useValidation";

// ============================================================================
// Context Types
// ============================================================================

export interface ValidationContextValue {
  /** Current validation result */
  result: PipelineValidationResult;
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Whether the result is stale */
  isStale: boolean;
  /** Whether pipeline is valid */
  isValid: boolean;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Info count */
  infoCount: number;
  /** Trigger manual validation */
  validateNow: () => void;
  /** Clear validation state */
  clearValidation: () => void;
  /** Get issues for a step */
  getStepIssues: (stepId: string) => ValidationIssue[];
  /** Get issues for a parameter */
  getParameterIssues: (stepId: string, paramName: string) => ValidationIssue[];
  /** Check if step has errors */
  stepHasErrors: (stepId: string) => boolean;
  /** Check if step has warnings */
  stepHasWarnings: (stepId: string) => boolean;
  /** Check if parameter has errors */
  parameterHasErrors: (stepId: string, paramName: string) => boolean;
  /** Navigate to an issue */
  navigateToIssue: (issue: ValidationIssue, onSelect?: (stepId: string) => void) => void;
  /** Disabled rules */
  disabledRules: Set<ValidationErrorCode>;
  /** Disable a rule */
  disableRule: (code: ValidationErrorCode) => void;
  /** Enable a rule */
  enableRule: (code: ValidationErrorCode) => void;
}

// ============================================================================
// Context Creation
// ============================================================================

const ValidationContextInternal = createContext<ValidationContextValue | null>(null);

/**
 * Hook to access validation context.
 * Throws if used outside of ValidationProvider.
 */
export function useValidationContext(): ValidationContextValue {
  const context = useContext(ValidationContextInternal);
  if (!context) {
    throw new Error(
      "useValidationContext must be used within a ValidationProvider"
    );
  }
  return context;
}

/**
 * Hook to optionally access validation context.
 * Returns null if used outside of ValidationProvider.
 */
export function useOptionalValidationContext(): ValidationContextValue | null {
  return useContext(ValidationContextInternal);
}

// ============================================================================
// Provider
// ============================================================================

export interface ValidationProviderProps {
  /** Pipeline steps to validate */
  steps: PipelineStep[];
  /** Callback to select a step (for issue navigation) */
  onSelectStep?: (stepId: string) => void;
  /** Validation options */
  options?: UseValidationOptions;
  /** Children to render */
  children: React.ReactNode;
}

/**
 * Provides validation state to the component tree.
 */
export function ValidationProvider({
  steps,
  onSelectStep,
  options = {},
  children,
}: ValidationProviderProps): React.ReactElement {
  const validation = useValidation(steps, options);

  // Enhanced navigate function that uses the onSelectStep callback
  const navigateToIssue = useCallback(
    (issue: ValidationIssue, customOnSelect?: (stepId: string) => void) => {
      const selectCallback = customOnSelect ?? onSelectStep;
      if (issue.location.stepId && selectCallback) {
        selectCallback(issue.location.stepId);
      }
    },
    [onSelectStep]
  );

  // Memoize context value
  const value = useMemo<ValidationContextValue>(
    () => ({
      result: validation.result,
      isValidating: validation.isValidating,
      isStale: validation.isStale,
      isValid: validation.isValid,
      errorCount: validation.errorCount,
      warningCount: validation.warningCount,
      infoCount: validation.result.summary.infoCount,
      validateNow: validation.validateNow,
      clearValidation: validation.clearValidation,
      getStepIssues: validation.getStepIssues,
      getParameterIssues: validation.getParameterIssues,
      stepHasErrors: validation.stepHasErrors,
      stepHasWarnings: validation.stepHasWarnings,
      parameterHasErrors: validation.parameterHasErrors,
      navigateToIssue,
      disabledRules: validation.disabledRules,
      disableRule: validation.disableRule,
      enableRule: validation.enableRule,
    }),
    [validation, navigateToIssue]
  );

  return (
    <ValidationContextInternal.Provider value={value}>
      {children}
    </ValidationContextInternal.Provider>
  );
}

// Re-export as ValidationContext for convenient access
export { ValidationContextInternal as ValidationContext };

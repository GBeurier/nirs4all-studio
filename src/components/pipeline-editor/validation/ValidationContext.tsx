/**
 * ValidationContext
 *
 * React context for sharing validation state across the pipeline editor.
 * Provides validation result and utilities to all child components.
 *
 * @see docs/_internals/implementation_roadmap.md Phase 4
 */

import { useMemo, useCallback, type ReactElement } from "react";
import type { ValidationIssue } from "./types";
import { useValidation } from "./useValidation";
import {
  ValidationContext,
  type ValidationContextValue,
  type ValidationProviderProps,
} from "./useValidationContext";

// ============================================================================
// Provider
// ============================================================================

/**
 * Provides validation state to the component tree.
 */
export function ValidationProvider({
  steps,
  onSelectStep,
  options = {},
  children,
}: ValidationProviderProps): ReactElement {
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
    <ValidationContext.Provider value={value}>
      {children}
    </ValidationContext.Provider>
  );
}

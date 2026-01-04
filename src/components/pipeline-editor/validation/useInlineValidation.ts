/**
 * useInlineValidation - Hook for connecting validation to inline inputs
 *
 * This hook provides a bridge between the validation context and individual
 * parameter inputs, making it easy to display validation errors/warnings
 * directly in the input components.
 *
 * @example
 * // In a parameter editor component:
 * function ParameterEditor({ stepId, paramKey, value, onChange }) {
 *   const { error, warning } = useInlineValidation(stepId, paramKey);
 *
 *   return (
 *     <ParameterInput
 *       paramKey={paramKey}
 *       value={value}
 *       onChange={onChange}
 *       error={error}
 *       warning={warning}
 *     />
 *   );
 * }
 */

import { useMemo } from "react";
import type { ValidationIssue, ValidationSeverity } from "./types";
import { useValidationContext } from "./ValidationContext";

export interface InlineValidationResult {
  /** Error message (highest severity issue) */
  error: string | undefined;
  /** Warning message (if no error) */
  warning: string | undefined;
  /** All issues for this parameter */
  issues: ValidationIssue[];
  /** Whether there are any issues */
  hasIssues: boolean;
  /** Most severe issue */
  severity: ValidationSeverity | undefined;
}

/**
 * Hook to get validation feedback for a specific parameter
 *
 * @param stepId - The step ID containing the parameter
 * @param paramKey - The parameter key/name
 * @returns Validation feedback for inline display
 */
export function useInlineValidation(
  stepId: string,
  paramKey: string
): InlineValidationResult {
  const { getStepIssues, result } = useValidationContext();

  return useMemo(() => {
    const stepIssues = getStepIssues(stepId);

    // Filter to just this parameter's issues
    const paramIssues = stepIssues.filter(
      (issue: ValidationIssue) => issue.location?.paramName === paramKey
    );

    if (paramIssues.length === 0) {
      return {
        error: undefined,
        warning: undefined,
        issues: [],
        hasIssues: false,
        severity: undefined,
      };
    }

    // Find most severe issue
    const errorIssue = paramIssues.find((i: ValidationIssue) => i.severity === "error");
    const warningIssue = paramIssues.find((i: ValidationIssue) => i.severity === "warning");

    return {
      error: errorIssue?.message,
      warning: warningIssue?.message,
      issues: paramIssues,
      hasIssues: true,
      severity: errorIssue ? "error" : warningIssue ? "warning" : "info",
    };
  }, [stepId, paramKey, getStepIssues, result]);
}

export interface StepValidationResult {
  /** All issues for this step (including parameter issues) */
  issues: ValidationIssue[];
  /** Step-level issues (not parameter-specific) */
  stepIssues: ValidationIssue[];
  /** Parameter-level issues grouped by parameter key */
  parameterIssues: Map<string, ValidationIssue[]>;
  /** Whether there are any issues */
  hasIssues: boolean;
  /** Whether there are any errors */
  hasErrors: boolean;
  /** Whether there are any warnings */
  hasWarnings: boolean;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Most severe issue */
  severity: ValidationSeverity | undefined;
}

/**
 * Hook to get all validation feedback for a specific step
 *
 * @param stepId - The step ID
 * @returns Complete validation feedback for the step
 */
export function useStepInlineValidation(stepId: string): StepValidationResult {
  const { getStepIssues, result } = useValidationContext();

  return useMemo(() => {
    const issues = getStepIssues(stepId);

    if (issues.length === 0) {
      return {
        issues: [],
        stepIssues: [],
        parameterIssues: new Map(),
        hasIssues: false,
        hasErrors: false,
        hasWarnings: false,
        errorCount: 0,
        warningCount: 0,
        severity: undefined,
      };
    }

    // Separate step-level from parameter-level issues
    const stepIssues: ValidationIssue[] = [];
    const parameterIssues = new Map<string, ValidationIssue[]>();

    for (const issue of issues) {
      if (issue.location?.paramName) {
        const existing = parameterIssues.get(issue.location.paramName) || [];
        existing.push(issue);
        parameterIssues.set(issue.location.paramName, existing);
      } else {
        stepIssues.push(issue);
      }
    }

    const errorCount = issues.filter((i: ValidationIssue) => i.severity === "error").length;
    const warningCount = issues.filter((i: ValidationIssue) => i.severity === "warning").length;
    const hasErrors = errorCount > 0;
    const hasWarnings = warningCount > 0;

    return {
      issues,
      stepIssues,
      parameterIssues,
      hasIssues: true,
      hasErrors,
      hasWarnings,
      errorCount,
      warningCount,
      severity: hasErrors ? "error" : hasWarnings ? "warning" : "info",
    };
  }, [stepId, getStepIssues, result]);
}

/**
 * Get validation messages for a parameter with formatting
 *
 * @param stepId - The step ID
 * @param paramKey - The parameter key
 * @returns Formatted validation messages
 */
export function useParameterMessages(
  stepId: string,
  paramKey: string
): {
  messages: Array<{ message: string; severity: ValidationSeverity; suggestion?: string }>;
  hasMessages: boolean;
} {
  const { issues } = useInlineValidation(stepId, paramKey);

  return useMemo(() => {
    const messages = issues.map((issue) => ({
      message: issue.message,
      severity: issue.severity,
      suggestion: issue.suggestion,
    }));

    return {
      messages,
      hasMessages: messages.length > 0,
    };
  }, [issues]);
}

export default useInlineValidation;

/**
 * useValidation Hook
 *
 * React hook that integrates validation with pipeline state.
 * Provides debounced validation and issue navigation.
 *
 * @see docs/_internals/implementation_roadmap.md Task 4.5, 4.6
 */

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import type { PipelineStep } from "../types";
import type {
  PipelineValidationResult,
  ValidationIssue,
  ValidationErrorCode,
  ValidationState,
} from "./types";
import { createEmptyValidationResult, getStepIssues, getParameterIssues } from "./types";
import { validate } from "./engine";

// ============================================================================
// Hook Configuration
// ============================================================================

/** Default debounce delay in milliseconds */
const DEFAULT_DEBOUNCE_MS = 300;

/** Maximum debounce delay (for stability) */
const MAX_DEBOUNCE_MS = 1000;

/** Minimum delay for validation to run immediately */
const IMMEDIATE_THRESHOLD_MS = 50;

// ============================================================================
// useValidation Hook
// ============================================================================

export interface UseValidationOptions {
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Auto-validate on mount */
  validateOnMount?: boolean;
  /** Auto-validate on steps change */
  validateOnChange?: boolean;
  /** Disabled validation rules */
  disabledRules?: ValidationErrorCode[];
  /** Strict mode (fail on warnings) */
  strictMode?: boolean;
  /** Currently selected step ID */
  selectedStepId?: string;
  /** Callback when validation completes */
  onValidationComplete?: (result: PipelineValidationResult) => void;
  /** Callback when navigating to an issue (e.g., to select a step) */
  onNavigateToIssue?: (issue: ValidationIssue) => void;
}

export interface UseValidationReturn {
  /** Current validation result */
  result: PipelineValidationResult;
  /** Whether validation is in progress */
  isValidating: boolean;
  /** Whether the result is stale (steps changed since last validation) */
  isStale: boolean;
  /** Whether pipeline is valid (no errors) */
  isValid: boolean;
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Trigger manual validation */
  validateNow: () => void;
  /** Clear validation result */
  clearValidation: () => void;
  /** Get issues for a specific step */
  getStepIssues: (stepId: string) => ValidationIssue[];
  /** Get issues for a specific parameter */
  getParameterIssues: (stepId: string, paramName: string) => ValidationIssue[];
  /** Check if a step has errors */
  stepHasErrors: (stepId: string) => boolean;
  /** Check if a step has warnings */
  stepHasWarnings: (stepId: string) => boolean;
  /** Check if a parameter has errors */
  parameterHasErrors: (stepId: string, paramName: string) => boolean;
  /** Navigate to an issue's location */
  navigateToIssue: (issue: ValidationIssue) => void;
  /** Disable a rule */
  disableRule: (code: ValidationErrorCode) => void;
  /** Enable a rule */
  enableRule: (code: ValidationErrorCode) => void;
  /** Set of disabled rules */
  disabledRules: Set<ValidationErrorCode>;
}

/**
 * Hook for pipeline validation with debouncing.
 */
export function useValidation(
  steps: PipelineStep[],
  options: UseValidationOptions = {}
): UseValidationReturn {
  const {
    debounceMs = DEFAULT_DEBOUNCE_MS,
    validateOnMount = true,
    validateOnChange = true,
    disabledRules: initialDisabledRules = [],
    strictMode = false,
    selectedStepId,
    onValidationComplete,
    onNavigateToIssue,
  } = options;

  // State
  const [result, setResult] = useState<PipelineValidationResult>(
    createEmptyValidationResult()
  );
  const [isValidating, setIsValidating] = useState(false);
  const [isStale, setIsStale] = useState(true);
  const [disabledRules, setDisabledRules] = useState<Set<ValidationErrorCode>>(
    () => new Set(initialDisabledRules)
  );

  // Refs for debouncing
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastStepsRef = useRef<string>("");
  const callbackRef = useRef(onValidationComplete);

  // Update callback ref
  callbackRef.current = onValidationComplete;

  // Perform validation
  const performValidation = useCallback(() => {
    setIsValidating(true);

    // Use requestIdleCallback or setTimeout for non-blocking validation
    const runValidation = () => {
      const validationResult = validate(steps, {
        strictMode,
        disabledRules: Array.from(disabledRules),
        selectedStepId,
      });

      setResult(validationResult);
      setIsValidating(false);
      setIsStale(false);

      // Call completion callback
      callbackRef.current?.(validationResult);
    };

    // Use requestIdleCallback if available for better performance
    if ("requestIdleCallback" in window) {
      (window as unknown as { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(runValidation);
    } else {
      setTimeout(runValidation, 0);
    }
  }, [steps, strictMode, disabledRules, selectedStepId]);

  // Debounced validation trigger
  const validateDebounced = useCallback(() => {
    // Clear existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Mark as stale immediately
    setIsStale(true);

    // Clamp debounce time
    const effectiveDebounce = Math.min(
      Math.max(debounceMs, IMMEDIATE_THRESHOLD_MS),
      MAX_DEBOUNCE_MS
    );

    // Set new timer
    debounceTimerRef.current = setTimeout(() => {
      performValidation();
    }, effectiveDebounce);
  }, [debounceMs, performValidation]);

  // Immediate validation (no debounce)
  const validateNow = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    performValidation();
  }, [performValidation]);

  // Clear validation
  const clearValidation = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setResult(createEmptyValidationResult());
    setIsStale(true);
    setIsValidating(false);
  }, []);

  // Effect: Validate on mount
  useEffect(() => {
    if (validateOnMount) {
      validateNow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Effect: Validate on steps change
  useEffect(() => {
    if (!validateOnChange) return;

    // Create a stable representation of steps to detect changes
    const stepsJson = JSON.stringify(steps);
    if (stepsJson === lastStepsRef.current) {
      return;
    }
    lastStepsRef.current = stepsJson;

    validateDebounced();
  }, [steps, validateOnChange, validateDebounced]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Get issues for a step
  const getStepIssuesCallback = useCallback(
    (stepId: string): ValidationIssue[] => {
      return getStepIssues(result, stepId);
    },
    [result]
  );

  // Get issues for a parameter
  const getParameterIssuesCallback = useCallback(
    (stepId: string, paramName: string): ValidationIssue[] => {
      return getParameterIssues(result, stepId, paramName);
    },
    [result]
  );

  // Check if step has errors
  const stepHasErrors = useCallback(
    (stepId: string): boolean => {
      const stepResult = result.stepResults.get(stepId);
      return stepResult ? stepResult.errors.length > 0 : false;
    },
    [result]
  );

  // Check if step has warnings
  const stepHasWarnings = useCallback(
    (stepId: string): boolean => {
      const stepResult = result.stepResults.get(stepId);
      return stepResult ? stepResult.warnings.length > 0 : false;
    },
    [result]
  );

  // Check if parameter has errors
  const parameterHasErrors = useCallback(
    (stepId: string, paramName: string): boolean => {
      const issues = getParameterIssues(result, stepId, paramName);
      return issues.some((i) => i.severity === "error");
    },
    [result]
  );

  // Navigate to issue location
  const navigateToIssue = useCallback((issue: ValidationIssue) => {
    // Use callback if provided, otherwise log for debugging
    if (onNavigateToIssue) {
      onNavigateToIssue(issue);
    } else {
      console.log("Navigate to issue:", issue.location);
    }
  }, [onNavigateToIssue]);

  // Disable a rule
  const disableRule = useCallback((code: ValidationErrorCode) => {
    setDisabledRules((prev) => {
      const next = new Set(prev);
      next.add(code);
      return next;
    });
    setIsStale(true);
  }, []);

  // Enable a rule
  const enableRule = useCallback((code: ValidationErrorCode) => {
    setDisabledRules((prev) => {
      const next = new Set(prev);
      next.delete(code);
      return next;
    });
    setIsStale(true);
  }, []);

  // Derived state
  const isValid = result.isValid;
  const errorCount = result.summary.errorCount;
  const warningCount = result.summary.warningCount;

  return {
    result,
    isValidating,
    isStale,
    isValid,
    errorCount,
    warningCount,
    validateNow,
    clearValidation,
    getStepIssues: getStepIssuesCallback,
    getParameterIssues: getParameterIssuesCallback,
    stepHasErrors,
    stepHasWarnings,
    parameterHasErrors,
    navigateToIssue,
    disableRule,
    enableRule,
    disabledRules,
  };
}

// ============================================================================
// useParameterValidation Hook
// ============================================================================

/**
 * Focused hook for single parameter validation.
 * Useful for inline validation in input components.
 */
export function useParameterValidation(
  stepId: string,
  paramName: string,
  result: PipelineValidationResult | null
): {
  issues: ValidationIssue[];
  hasError: boolean;
  hasWarning: boolean;
  errorMessage: string | null;
} {
  const issues = useMemo(() => {
    if (!result) return [];
    return getParameterIssues(result, stepId, paramName);
  }, [result, stepId, paramName]);

  const hasError = useMemo(
    () => issues.some((i) => i.severity === "error"),
    [issues]
  );

  const hasWarning = useMemo(
    () => issues.some((i) => i.severity === "warning"),
    [issues]
  );

  const errorMessage = useMemo(() => {
    const error = issues.find((i) => i.severity === "error");
    return error?.message ?? null;
  }, [issues]);

  return {
    issues,
    hasError,
    hasWarning,
    errorMessage,
  };
}

// ============================================================================
// useStepValidation Hook
// ============================================================================

/**
 * Focused hook for single step validation.
 */
export function useStepValidation(
  stepId: string,
  result: PipelineValidationResult | null
): {
  issues: ValidationIssue[];
  hasError: boolean;
  hasWarning: boolean;
  errorCount: number;
  warningCount: number;
} {
  const issues = useMemo(() => {
    if (!result) return [];
    return getStepIssues(result, stepId);
  }, [result, stepId]);

  const errorCount = useMemo(
    () => issues.filter((i) => i.severity === "error").length,
    [issues]
  );

  const warningCount = useMemo(
    () => issues.filter((i) => i.severity === "warning").length,
    [issues]
  );

  return {
    issues,
    hasError: errorCount > 0,
    hasWarning: warningCount > 0,
    errorCount,
    warningCount,
  };
}

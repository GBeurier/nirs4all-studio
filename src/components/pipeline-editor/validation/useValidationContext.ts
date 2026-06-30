import { createContext, useContext, type ReactNode } from "react";
import type { PipelineStep } from "../types";
import type {
  PipelineValidationResult,
  ValidationErrorCode,
  ValidationIssue,
} from "./types";
import type { UseValidationOptions } from "./useValidation";

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

export interface ValidationProviderProps {
  /** Pipeline steps to validate */
  steps: PipelineStep[];
  /** Callback to select a step (for issue navigation) */
  onSelectStep?: (stepId: string) => void;
  /** Validation options */
  options?: UseValidationOptions;
  /** Children to render */
  children: ReactNode;
}

export const ValidationContext = createContext<ValidationContextValue | null>(null);

export function useValidationContext(): ValidationContextValue {
  const context = useContext(ValidationContext);
  if (!context) {
    throw new Error(
      "useValidationContext must be used within a ValidationProvider"
    );
  }
  return context;
}

export function useOptionalValidationContext(): ValidationContextValue | null {
  return useContext(ValidationContext);
}

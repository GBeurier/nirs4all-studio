/**
 * ParameterInput - Reusable parameter input with label and tooltip
 *
 * A unified input component for numeric and string parameters with:
 * - Consistent label/tooltip formatting
 * - Sweep indicator badge
 * - Disabled state when sweep is active
 * - Automatic step inference for number inputs
 * - Validation error/warning display
 *
 * Extracted from the renderParamInput pattern in StepConfigPanel.
 *
 * @example
 * <ParameterInput
 *   paramKey="n_components"
 *   value={10}
 *   onChange={(value) => handleChange("n_components", value)}
 *   tooltip="Number of PLS components to use"
 *   error="Value must be at least 1"
 * />
 */

import { useCallback } from "react";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./InfoTooltip";

export type ParameterValue = string | number;

export interface ParameterInputProps {
  /** The parameter key (used for label formatting) */
  paramKey: string;
  /** Current parameter value */
  value: ParameterValue;
  /** Callback when value changes */
  onChange: (value: ParameterValue) => void;
  /** Optional tooltip content for the info icon */
  tooltip?: string;
  /** Whether this parameter has an active sweep */
  hasSweep?: boolean;
  /** Custom label (default: formatted paramKey) */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the input is disabled */
  disabled?: boolean;
  /** Additional classes for the container */
  className?: string;
  /** Whether to show the label (default: true) */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Input type override (auto-detected from value type) */
  type?: "text" | "number";
  /** Min value for number inputs */
  min?: number;
  /** Max value for number inputs */
  max?: number;
  /** Step value for number inputs (auto-inferred if not provided) */
  step?: number;
  /** Error message to display (validation error) */
  error?: string;
  /** Warning message to display (validation warning) */
  warning?: string;
  /** Additional content to render after the input (e.g., SweepConfigPopover) */
  suffix?: React.ReactNode;
}

/**
 * Formats a parameter key into a human-readable label.
 * Replaces underscores with spaces and handles camelCase.
 *
 * @example
 * formatParamLabel("n_components") // "n components"
 * formatParamLabel("learningRate") // "learning rate"
 * formatParamLabel("max_iter") // "max iter"
 */
export function formatParamLabel(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2") // camelCase to spaces
    .toLowerCase();
}

/**
 * Infers an appropriate step value for number inputs.
 */
function inferStep(value: number): number {
  if (!Number.isFinite(value)) return 1;
  if (value > 0 && value < 1) return 0.01;
  if (Math.abs(value) >= 1000) return 10;
  if (Math.abs(value) >= 100) return 1;
  return 1;
}

export function ParameterInput({
  paramKey,
  value,
  onChange,
  tooltip,
  hasSweep = false,
  label,
  placeholder,
  disabled = false,
  className,
  showLabel = true,
  size = "md",
  type,
  min,
  max,
  step,
  error,
  warning,
  suffix,
}: ParameterInputProps) {
  const isNumber = type === "number" || typeof value === "number";
  const inputType = type ?? (isNumber ? "number" : "text");
  const isDisabled = disabled || hasSweep;

  // Infer step for number inputs if not provided
  const computedStep = step ?? (isNumber && typeof value === "number" ? inferStep(value) : undefined);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isNumber) {
        const parsed = parseFloat(e.target.value);
        onChange(isNaN(parsed) ? 0 : parsed);
      } else {
        onChange(e.target.value);
      }
    },
    [onChange, isNumber]
  );

  const displayLabel = label ?? formatParamLabel(paramKey);
  const hasError = !!error;
  const hasWarning = !hasError && !!warning;

  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && (
        <div className="flex items-center gap-2">
          <Label
            className={cn(
              "text-sm capitalize",
              hasSweep && "text-orange-500",
              hasError && "text-destructive",
              hasWarning && "text-orange-500",
              size === "sm" && "text-xs"
            )}
          >
            {displayLabel}
          </Label>
          {tooltip && <InfoTooltip content={tooltip} />}
          {hasSweep && (
            <Badge
              variant="outline"
              className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500"
            >
              sweep
            </Badge>
          )}
        </div>
      )}

      <Input
        type={inputType}
        value={value}
        onChange={handleChange}
        step={computedStep}
        min={min}
        max={max}
        placeholder={placeholder}
        disabled={isDisabled}
        className={cn(
          "font-mono",
          size === "sm" && "h-8 text-xs",
          hasError && "border-destructive focus-visible:ring-destructive",
          hasWarning && "border-orange-500/50 focus-visible:ring-orange-500"
        )}
        aria-invalid={hasError}
        aria-describedby={
          error ? `${paramKey}-error` : warning ? `${paramKey}-warning` : undefined
        }
      />

      {hasError && (
        <div id={`${paramKey}-error`} className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {hasWarning && (
        <div id={`${paramKey}-warning`} className="flex items-center gap-1.5 text-xs text-orange-500">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span>{warning}</span>
        </div>
      )}

      {suffix}
    </div>
  );
}

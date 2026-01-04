/**
 * ParameterSelect - Reusable select component with label and tooltip
 *
 * A unified select component for parameter options with:
 * - Consistent label/tooltip formatting
 * - Sweep indicator badge
 * - Support for simple and rich option definitions
 * - Disabled state when sweep is active
 *
 * Extracted from select patterns in StepConfigPanel (kernel, norm, activation, etc.)
 *
 * @example
 * // Simple options
 * <ParameterSelect
 *   paramKey="kernel"
 *   value="rbf"
 *   options={["rbf", "linear", "poly"]}
 *   onChange={(value) => handleChange("kernel", value)}
 * />
 *
 * // Rich options with descriptions
 * <ParameterSelect
 *   paramKey="kernel"
 *   value="rbf"
 *   options={[
 *     { value: "rbf", label: "RBF (Radial Basis Function)" },
 *     { value: "linear", label: "Linear" },
 *   ]}
 *   onChange={(value) => handleChange("kernel", value)}
 * />
 */

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./InfoTooltip";
import { formatParamLabel } from "./ParameterInput";

export type SelectOptionValue = string | number;

/** Simple option definition: just the value (label = value) */
type SimpleOption = SelectOptionValue;

/** Rich option definition with explicit label and optional description */
export interface SelectOptionDef {
  value: SelectOptionValue;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

export type SelectOption = SimpleOption | SelectOptionDef;

export interface ParameterSelectProps {
  /** The parameter key (used for label formatting) */
  paramKey: string;
  /** Current selected value */
  value: SelectOptionValue;
  /** Callback when selection changes */
  onChange: (value: SelectOptionValue) => void;
  /** Array of options (simple values or rich objects) */
  options: SelectOption[];
  /** Optional tooltip content for the info icon */
  tooltip?: string;
  /** Whether this parameter has an active sweep */
  hasSweep?: boolean;
  /** Custom label (default: formatted paramKey) */
  label?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the select is disabled */
  disabled?: boolean;
  /** Additional classes for the container */
  className?: string;
  /** Whether to show the label (default: true) */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "md";
  /** Error message to display */
  error?: string;
  /** Additional content to render after the select (e.g., SweepConfigPopover) */
  suffix?: React.ReactNode;
}

/**
 * Normalizes an option to the rich format.
 */
function normalizeOption(option: SelectOption): SelectOptionDef {
  if (typeof option === "object" && option !== null && "value" in option) {
    return option;
  }
  return {
    value: option,
    label: String(option),
  };
}

export function ParameterSelect({
  paramKey,
  value,
  onChange,
  options,
  tooltip,
  hasSweep = false,
  label,
  placeholder = "Select...",
  disabled = false,
  className,
  showLabel = true,
  size = "md",
  error,
  suffix,
}: ParameterSelectProps) {
  const isDisabled = disabled || hasSweep;
  const displayLabel = label ?? formatParamLabel(paramKey);
  const normalizedOptions = options.map(normalizeOption);

  return (
    <div className={cn("space-y-2", className)}>
      {showLabel && (
        <div className="flex items-center gap-2">
          <Label
            className={cn(
              "text-sm capitalize",
              hasSweep && "text-orange-500",
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

      <Select
        value={String(value)}
        onValueChange={(v) => {
          // Try to preserve the original type (number vs string)
          const originalOption = normalizedOptions.find(
            (opt) => String(opt.value) === v
          );
          onChange(originalOption?.value ?? v);
        }}
        disabled={isDisabled}
      >
        <SelectTrigger
          className={cn(
            size === "sm" && "h-8 text-xs",
            error && "border-destructive focus:ring-destructive"
          )}
          aria-invalid={!!error}
          aria-describedby={error ? `${paramKey}-error` : undefined}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {normalizedOptions.map((option) => (
            <SelectItem
              key={String(option.value)}
              value={String(option.value)}
              disabled={option.disabled}
            >
              <div className="flex items-center gap-2">
                {option.icon}
                <div className="flex flex-col">
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <span className="text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </div>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {error && (
        <p id={`${paramKey}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}

      {suffix}
    </div>
  );
}

/**
 * ParameterSwitch - Reusable switch component with label and tooltip
 *
 * A unified switch component for boolean parameters with:
 * - Consistent label/tooltip formatting
 * - Sweep indicator badge
 * - Optional description text
 * - Disabled state when sweep is active
 *
 * Extracted from boolean parameter patterns in StepConfigPanel.
 *
 * @example
 * <ParameterSwitch
 *   paramKey="shuffle"
 *   checked={true}
 *   onChange={(checked) => handleChange("shuffle", checked)}
 *   tooltip="Whether to shuffle data before splitting"
 * />
 *
 * <ParameterSwitch
 *   paramKey="enabled"
 *   checked={config.enabled}
 *   onChange={setEnabled}
 *   label="Enable Feature"
 *   description="Turn on this experimental feature"
 * />
 */

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "./InfoTooltip";
import { formatParamLabel } from "./ParameterInput";

export interface ParameterSwitchProps {
  /** The parameter key (used for label formatting) */
  paramKey: string;
  /** Current checked state */
  checked: boolean;
  /** Callback when checked state changes */
  onChange: (checked: boolean) => void;
  /** Optional tooltip content for the info icon */
  tooltip?: string;
  /** Whether this parameter has an active sweep */
  hasSweep?: boolean;
  /** Custom label (default: formatted paramKey) */
  label?: string;
  /** Optional description shown below the label */
  description?: string;
  /** Whether the switch is disabled */
  disabled?: boolean;
  /** Additional classes for the container */
  className?: string;
  /** Size variant */
  size?: "sm" | "md";
  /** Layout direction: inline (label and switch on same line) or stacked */
  layout?: "inline" | "stacked";
  /** Additional content to render after the switch (e.g., SweepConfigPopover) */
  suffix?: React.ReactNode;
}

export function ParameterSwitch({
  paramKey,
  checked,
  onChange,
  tooltip,
  hasSweep = false,
  label,
  description,
  disabled = false,
  className,
  size = "md",
  layout = "inline",
  suffix,
}: ParameterSwitchProps) {
  const isDisabled = disabled || hasSweep;
  const displayLabel = label ?? formatParamLabel(paramKey);

  if (layout === "stacked") {
    return (
      <div className={cn("space-y-2", className)}>
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

        <div className="flex items-center gap-3">
          <Switch
            checked={checked}
            onCheckedChange={onChange}
            disabled={isDisabled}
            aria-label={displayLabel}
            className={size === "sm" ? "scale-90" : undefined}
          />
          {description && (
            <span className="text-xs text-muted-foreground">{description}</span>
          )}
        </div>

        {suffix}
      </div>
    );
  }

  // Inline layout (default)
  return (
    <div className={cn("space-y-1", className)}>
      <div
        className={cn(
          "flex items-center justify-between",
          size === "md" ? "py-2" : "py-1"
        )}
      >
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
        <Switch
          checked={checked}
          onCheckedChange={onChange}
          disabled={isDisabled}
          aria-label={displayLabel}
          className={size === "sm" ? "scale-90" : undefined}
        />
      </div>

      {description && (
        <p className="text-xs text-muted-foreground pl-0">{description}</p>
      )}

      {suffix}
    </div>
  );
}

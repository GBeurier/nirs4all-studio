/**
 * SweepConfigPopover - Rich sweep configuration UI
 *
 * Provides an intuitive interface for configuring parameter sweeps with:
 * - Sweep type selection (range, log_range, choices)
 * - Interactive value preview
 * - Quick presets for common ranges
 * - Live variant count estimation
 * - Visual feedback for sweep status
 */

import { useState, useMemo, useCallback } from "react";
import {
  Repeat,
  ChevronDown,
  ChevronUp,
  X,
  Info,
  Sparkles,
  TrendingUp,
  List,
  Grid,
  Zap,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import type { ParameterSweep, SweepType } from "./types";
import { calculateSweepVariants } from "./types";

// Sweep type configurations
const sweepTypes: {
  type: SweepType;
  label: string;
  description: string;
  icon: typeof Repeat;
  color: string;
}[] = [
  {
    type: "range",
    label: "Range",
    description: "Linear sequence of values",
    icon: TrendingUp,
    color: "text-orange-500",
  },
  {
    type: "log_range",
    label: "Log Range",
    description: "Logarithmically spaced values",
    icon: Sparkles,
    color: "text-purple-500",
  },
  {
    type: "or",
    label: "Choices",
    description: "Pick from discrete options",
    icon: List,
    color: "text-blue-500",
  },
];

// Quick presets for common parameter ranges
interface Preset {
  label: string;
  sweep: ParameterSweep;
  forParams?: string[]; // Parameter names this preset is suitable for
}

const quickPresets: Preset[] = [
  // n_components presets
  {
    label: "1-10",
    sweep: { type: "range", from: 1, to: 10, step: 1 },
    forParams: ["n_components", "n_splits"],
  },
  {
    label: "1-20",
    sweep: { type: "range", from: 1, to: 20, step: 1 },
    forParams: ["n_components"],
  },
  {
    label: "1-30",
    sweep: { type: "range", from: 1, to: 30, step: 1 },
    forParams: ["n_components"],
  },
  {
    label: "5-25 (step 5)",
    sweep: { type: "range", from: 5, to: 25, step: 5 },
    forParams: ["n_components", "n_estimators"],
  },
  // Regularization presets
  {
    label: "α: 0.001-100 (log)",
    sweep: { type: "log_range", from: 0.001, to: 100, count: 10 },
    forParams: ["alpha", "C", "gamma"],
  },
  {
    label: "α: 0.01-10 (log)",
    sweep: { type: "log_range", from: 0.01, to: 10, count: 5 },
    forParams: ["alpha", "C"],
  },
  // Learning rate presets
  {
    label: "LR: 0.0001-0.1",
    sweep: { type: "log_range", from: 0.0001, to: 0.1, count: 5 },
    forParams: ["learning_rate", "lr"],
  },
  // Window/order presets
  {
    label: "3-15 (odd)",
    sweep: { type: "range", from: 3, to: 15, step: 2 },
    forParams: ["window_length", "window", "window_size"],
  },
  {
    label: "5-21 (odd)",
    sweep: { type: "range", from: 5, to: 21, step: 2 },
    forParams: ["window_length", "window"],
  },
  // Derivatives
  {
    label: "0, 1, 2",
    sweep: { type: "or", choices: [0, 1, 2] },
    forParams: ["deriv", "order", "polyorder"],
  },
  // Generic
  {
    label: "50-200 (step 50)",
    sweep: { type: "range", from: 50, to: 200, step: 50 },
    forParams: ["n_estimators", "epochs", "max_iter"],
  },
];

interface SweepConfigPopoverProps {
  paramKey: string;
  currentValue: string | number | boolean;
  sweep: ParameterSweep | undefined;
  onSweepChange: (sweep: ParameterSweep | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function SweepConfigPopover({
  paramKey,
  currentValue,
  sweep,
  onSweepChange,
  disabled = false,
  className,
}: SweepConfigPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [localSweep, setLocalSweep] = useState<ParameterSweep | undefined>(sweep);

  const isNumeric = typeof currentValue === "number";
  const hasSweep = !!sweep;

  // Calculate variant count
  const variantCount = useMemo(
    () => (localSweep ? calculateSweepVariants(localSweep) : 0),
    [localSweep]
  );

  // Generate preview values
  const previewValues = useMemo(() => {
    if (!localSweep) return [];

    switch (localSweep.type) {
      case "range": {
        const from = localSweep.from ?? 0;
        const to = localSweep.to ?? 10;
        const step = localSweep.step ?? 1;
        const values: number[] = [];
        for (let v = from; v <= to && values.length < 7; v += step) {
          values.push(v);
        }
        return values;
      }
      case "log_range": {
        const from = localSweep.from ?? 0.001;
        const to = localSweep.to ?? 100;
        const count = localSweep.count ?? 5;
        const logFrom = Math.log10(from);
        const logTo = Math.log10(to);
        const logStep = (logTo - logFrom) / (count - 1);
        const values: number[] = [];
        for (let i = 0; i < count && values.length < 7; i++) {
          values.push(Math.pow(10, logFrom + i * logStep));
        }
        return values;
      }
      case "or":
        return (localSweep.choices ?? []).slice(0, 7);
      default:
        return [];
    }
  }, [localSweep]);

  // Get relevant presets for this parameter
  const relevantPresets = useMemo(() => {
    return quickPresets.filter(
      (preset) =>
        !preset.forParams ||
        preset.forParams.some(
          (p) =>
            paramKey.toLowerCase().includes(p.toLowerCase()) ||
            p.toLowerCase().includes(paramKey.toLowerCase())
        )
    );
  }, [paramKey]);

  // Handle enabling sweep
  const handleEnableSweep = useCallback(() => {
    if (isNumeric) {
      const val = currentValue as number;
      const defaultSweep: ParameterSweep = {
        type: "range",
        from: Math.max(1, Math.floor(val * 0.5)),
        to: Math.ceil(val * 1.5) || val + 10,
        step: val >= 10 ? Math.ceil(val * 0.1) : 1,
      };
      setLocalSweep(defaultSweep);
    } else {
      setLocalSweep({
        type: "or",
        choices: [currentValue as string | boolean],
      });
    }
  }, [currentValue, isNumeric]);

  // Handle type change
  const handleTypeChange = useCallback(
    (type: SweepType) => {
      if (type === "range") {
        const val = typeof currentValue === "number" ? currentValue : 10;
        setLocalSweep({
          type: "range",
          from: Math.max(1, Math.floor(val * 0.5)),
          to: Math.ceil(val * 1.5) || val + 10,
          step: 1,
        });
      } else if (type === "log_range") {
        const val = typeof currentValue === "number" ? Math.max(0.001, currentValue) : 1;
        setLocalSweep({
          type: "log_range",
          from: Math.max(0.0001, val * 0.1),
          to: val * 10,
          count: 5,
        });
      } else if (type === "or") {
        setLocalSweep({
          type: "or",
          choices: [currentValue],
        });
      }
    },
    [currentValue]
  );

  // Apply sweep
  const handleApply = useCallback(() => {
    onSweepChange(localSweep);
    setIsOpen(false);
  }, [localSweep, onSweepChange]);

  // Clear sweep
  const handleClear = useCallback(() => {
    setLocalSweep(undefined);
    onSweepChange(undefined);
    setIsOpen(false);
  }, [onSweepChange]);

  // Apply preset
  const handleApplyPreset = useCallback((preset: Preset) => {
    setLocalSweep(preset.sweep);
  }, []);

  // Update when prop changes
  useMemo(() => {
    setLocalSweep(sweep);
  }, [sweep]);

  // Sync local state when popover opens
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        setLocalSweep(sweep);
        if (!sweep) {
          handleEnableSweep();
        }
      }
      setIsOpen(open);
    },
    [sweep, handleEnableSweep]
  );

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={hasSweep ? "default" : "ghost"}
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 px-2 text-xs gap-1.5 transition-all",
            hasSweep
              ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              : "hover:bg-orange-500/10 hover:text-orange-500",
            className
          )}
        >
          <Repeat className="h-3.5 w-3.5" />
          {hasSweep ? (
            <>
              {variantCount} variant{variantCount !== 1 ? "s" : ""}
            </>
          ) : (
            "Sweep"
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className="w-80 bg-popover p-0 shadow-lg"
      >
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Repeat className="h-4 w-4 text-orange-500" />
              <h4 className="font-medium text-sm">
                Sweep: <span className="font-mono">{paramKey}</span>
              </h4>
            </div>
            {localSweep && (
              <Badge
                variant="secondary"
                className="bg-orange-500/20 text-orange-600 text-xs"
              >
                {variantCount} variant{variantCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Sweep Type Selection */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Sweep Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {sweepTypes
                .filter((t) => t.type === "or" || isNumeric)
                .map((typeConfig) => {
                  const Icon = typeConfig.icon;
                  const isActive = localSweep?.type === typeConfig.type;
                  return (
                    <Button
                      key={typeConfig.type}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleTypeChange(typeConfig.type)}
                      className={cn(
                        "h-auto py-2 flex flex-col items-center gap-1",
                        isActive && "bg-orange-500 hover:bg-orange-600"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="text-xs">{typeConfig.label}</span>
                    </Button>
                  );
                })}
            </div>
          </div>

          {/* Configuration based on type */}
          {localSweep?.type === "range" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="number"
                    value={localSweep.from ?? 0}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        from: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="number"
                    value={localSweep.to ?? 10}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        to: parseFloat(e.target.value) || 10,
                      })
                    }
                    className="h-8 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Step</Label>
                  <Input
                    type="number"
                    value={localSweep.step ?? 1}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        step: parseFloat(e.target.value) || 1,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    min={1}
                  />
                </div>
              </div>
            </div>
          )}

          {localSweep?.type === "log_range" && (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input
                    type="number"
                    value={localSweep.from ?? 0.001}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        from: parseFloat(e.target.value) || 0.001,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    step={0.001}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input
                    type="number"
                    value={localSweep.to ?? 100}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        to: parseFloat(e.target.value) || 100,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    step={0.001}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Count</Label>
                  <Input
                    type="number"
                    value={localSweep.count ?? 5}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        count: parseInt(e.target.value) || 5,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    min={2}
                    max={20}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Info className="h-3 w-3" />
                Values are logarithmically spaced (10^x)
              </p>
            </div>
          )}

          {localSweep?.type === "or" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Choices (comma-separated)
              </Label>
              <Input
                value={localSweep.choices?.join(", ") ?? ""}
                onChange={(e) => {
                  const choices = e.target.value
                    .split(",")
                    .map((s) => {
                      const trimmed = s.trim();
                      const num = parseFloat(trimmed);
                      if (!isNaN(num) && isNumeric) return num;
                      if (trimmed === "true") return true;
                      if (trimmed === "false") return false;
                      return trimmed;
                    })
                    .filter((v) => v !== "");
                  setLocalSweep({ ...localSweep, choices });
                }}
                className="h-8 text-xs font-mono"
                placeholder="value1, value2, value3"
              />
            </div>
          )}

          {/* Value Preview */}
          {previewValues.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Preview</Label>
              <div className="flex flex-wrap gap-1">
                {previewValues.map((val, idx) => (
                  <Badge
                    key={idx}
                    variant="outline"
                    className="text-xs font-mono py-0.5 px-1.5"
                  >
                    {typeof val === "number"
                      ? val < 0.01 || val >= 1000
                        ? val.toExponential(2)
                        : val % 1 === 0
                        ? val
                        : val.toFixed(3)
                      : String(val)}
                  </Badge>
                ))}
                {variantCount > 7 && (
                  <Badge
                    variant="secondary"
                    className="text-xs font-mono py-0.5 px-1.5"
                  >
                    +{variantCount - 7} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Quick Presets */}
          {relevantPresets.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Quick Presets
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {relevantPresets.slice(0, 4).map((preset, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => handleApplyPreset(preset)}
                    className="h-6 px-2 text-xs hover:bg-orange-500/10 hover:text-orange-500"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="text-xs text-muted-foreground hover:text-destructive"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              Clear
            </Button>
            <Button
              size="sm"
              onClick={handleApply}
              className="bg-orange-500 hover:bg-orange-600 text-xs"
            >
              <Check className="h-3.5 w-3.5 mr-1" />
              Apply Sweep
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * SweepActivator - Inline hover icon for parameter sweep activation
 *
 * Shows a subtle icon on hover that can be clicked to open sweep config.
 */
interface SweepActivatorProps {
  paramKey: string;
  currentValue: string | number | boolean;
  sweep: ParameterSweep | undefined;
  onSweepChange: (sweep: ParameterSweep | undefined) => void;
  disabled?: boolean;
  className?: string;
}

export function SweepActivator({
  paramKey,
  currentValue,
  sweep,
  onSweepChange,
  disabled = false,
  className,
}: SweepActivatorProps) {
  const hasSweep = !!sweep;
  const variantCount = useMemo(
    () => (sweep ? calculateSweepVariants(sweep) : 0),
    [sweep]
  );

  return (
    <div className={cn("relative group", className)}>
      <SweepConfigPopover
        paramKey={paramKey}
        currentValue={currentValue}
        sweep={sweep}
        onSweepChange={onSweepChange}
        disabled={disabled}
      />
    </div>
  );
}

/**
 * SweepBadge - Compact badge showing sweep status for a parameter
 */
interface SweepBadgeProps {
  sweep: ParameterSweep;
  onClick?: () => void;
  className?: string;
}

export function SweepBadge({ sweep, onClick, className }: SweepBadgeProps) {
  const variantCount = calculateSweepVariants(sweep);

  return (
    <Badge
      variant="secondary"
      onClick={onClick}
      className={cn(
        "text-xs bg-orange-500/20 text-orange-600 cursor-pointer hover:bg-orange-500/30 transition-colors",
        className
      )}
    >
      <Repeat className="h-3 w-3 mr-1" />
      {variantCount} variant{variantCount !== 1 ? "s" : ""}
    </Badge>
  );
}

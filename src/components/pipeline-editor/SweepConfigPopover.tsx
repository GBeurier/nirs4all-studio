/**
 * SweepConfigPopover - Rich sweep configuration UI
 *
 * Provides an intuitive interface for configuring parameter sweeps with:
 * - Sweep type selection (range, log_range, choices)
 * - Clear input layout with proper labels
 * - Interactive value preview
 * - Quick presets for common ranges
 * - Live variant count estimation
 *
 * REDESIGNED for better readability and clarity.
 */

import { useState, useMemo, useCallback } from "react";
import {
  Repeat,
  X,
  Sparkles,
  TrendingUp,
  List,
  Check,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ParameterSweep, SweepType } from "./types";
import { calculateSweepVariants } from "./types";

// Sweep type configurations
const sweepTypeConfig: Record<
  SweepType,
  { label: string; description: string; icon: typeof Repeat; color: string }
> = {
  range: {
    label: "Linear Range",
    description: "Values with fixed step",
    icon: TrendingUp,
    color: "text-blue-500",
  },
  log_range: {
    label: "Log Range",
    description: "Logarithmically spaced",
    icon: Sparkles,
    color: "text-purple-500",
  },
  or: {
    label: "Discrete",
    description: "Specific values",
    icon: List,
    color: "text-green-500",
  },
  grid: {
    label: "Grid",
    description: "Grid search",
    icon: List,
    color: "text-orange-500",
  },
};

// Quick presets for common parameter ranges
interface Preset {
  label: string;
  sweep: ParameterSweep;
  forParams?: string[];
}

const quickPresets: Preset[] = [
  { label: "1→10", sweep: { type: "range", from: 1, to: 10, step: 1 }, forParams: ["n_components", "n_splits"] },
  { label: "1→20", sweep: { type: "range", from: 1, to: 20, step: 1 }, forParams: ["n_components"] },
  { label: "1→30", sweep: { type: "range", from: 1, to: 30, step: 1 }, forParams: ["n_components"] },
  { label: "5→25 step 5", sweep: { type: "range", from: 5, to: 25, step: 5 }, forParams: ["n_components", "n_estimators"] },
  { label: "0.001→100 log", sweep: { type: "log_range", from: 0.001, to: 100, count: 10 }, forParams: ["alpha", "C", "gamma"] },
  { label: "0.0001→0.1 log", sweep: { type: "log_range", from: 0.0001, to: 0.1, count: 5 }, forParams: ["learning_rate", "lr"] },
  { label: "3→15 odd", sweep: { type: "range", from: 3, to: 15, step: 2 }, forParams: ["window_length", "window"] },
  { label: "0, 1, 2", sweep: { type: "or", choices: [0, 1, 2] }, forParams: ["deriv", "order", "polyorder"] },
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
        for (let v = from; v <= to && values.length < 8; v += step) {
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
        for (let i = 0; i < count && values.length < 8; i++) {
          values.push(Math.pow(10, logFrom + i * logStep));
        }
        return values;
      }
      case "or":
        return (localSweep.choices ?? []).slice(0, 8);
      default:
        return [];
    }
  }, [localSweep]);

  // Get relevant presets
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
      setLocalSweep({
        type: "range",
        from: Math.max(1, Math.floor(val * 0.5)),
        to: Math.ceil(val * 1.5) || val + 10,
        step: val >= 10 ? Math.ceil(val * 0.1) : 1,
      });
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
          choices: typeof currentValue === "number" ? [currentValue] : [currentValue as string | boolean],
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

  // Format value for display
  const formatValue = (val: unknown): string => {
    if (typeof val === "number") {
      if (val < 0.001 || val >= 10000) return val.toExponential(1);
      if (val % 1 !== 0) return val.toPrecision(3);
      return String(val);
    }
    return String(val);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={hasSweep ? "default" : "ghost"}
          size="sm"
          disabled={disabled}
          className={cn(
            "h-7 px-2 text-xs gap-1.5 transition-all shrink-0",
            hasSweep
              ? "bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              : "hover:bg-orange-500/10 hover:text-orange-500",
            className
          )}
        >
          <Repeat className="h-3.5 w-3.5" />
          {hasSweep ? `${variantCount}×` : "Sweep"}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        side="bottom"
        className="w-96 bg-popover p-0 shadow-xl"
        sideOffset={4}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-orange-500/10">
              <Repeat className="h-4 w-4 text-orange-500" />
            </div>
            <div>
              <h4 className="font-medium text-sm">Parameter Sweep</h4>
              <p className="text-xs text-muted-foreground font-mono">{paramKey}</p>
            </div>
          </div>
          <Badge
            variant="secondary"
            className="bg-orange-500/10 text-orange-600 text-xs px-2"
          >
            {variantCount} value{variantCount !== 1 ? "s" : ""}
          </Badge>
        </div>

        <div className="p-4 space-y-4">
          {/* Sweep Type Selection */}
          <div className="space-y-2">
            <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Sweep Type
            </Label>
            <div className="flex gap-2">
              {(["range", "log_range", "or"] as SweepType[])
                .filter((t) => t === "or" || isNumeric)
                .map((type) => {
                  const config = sweepTypeConfig[type];
                  const Icon = config.icon;
                  const isActive = localSweep?.type === type;
                  return (
                    <Button
                      key={type}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      onClick={() => handleTypeChange(type)}
                      className={cn(
                        "flex-1 h-9 gap-1.5",
                        isActive
                          ? "bg-orange-500 hover:bg-orange-600 text-white"
                          : "hover:border-orange-500/50"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-xs">{config.label}</span>
                    </Button>
                  );
                })}
            </div>
          </div>

          <Separator />

          {/* Range Configuration */}
          {localSweep?.type === "range" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Start</Label>
                  <Input
                    type="number"
                    value={localSweep.from ?? 0}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        from: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">End</Label>
                  <Input
                    type="number"
                    value={localSweep.to ?? 10}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        to: parseFloat(e.target.value) || 10,
                      })
                    }
                    className="h-9 text-sm font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Step</Label>
                  <Input
                    type="number"
                    value={localSweep.step ?? 1}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        step: Math.max(0.001, parseFloat(e.target.value) || 1),
                      })
                    }
                    className="h-9 text-sm font-mono"
                    min={0.001}
                    step={0.1}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <TrendingUp className="h-3.5 w-3.5" />
                <span>
                  {localSweep.from} → {localSweep.to} (step {localSweep.step})
                </span>
              </div>
            </div>
          )}

          {/* Log Range Configuration */}
          {localSweep?.type === "log_range" && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Min (10^x)</Label>
                  <Input
                    type="number"
                    value={localSweep.from ?? 0.001}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        from: Math.max(0.0000001, parseFloat(e.target.value) || 0.001),
                      })
                    }
                    className="h-9 text-sm font-mono"
                    step={0.001}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Max (10^x)</Label>
                  <Input
                    type="number"
                    value={localSweep.to ?? 100}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        to: parseFloat(e.target.value) || 100,
                      })
                    }
                    className="h-9 text-sm font-mono"
                    step={0.001}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">Count</Label>
                  <Input
                    type="number"
                    value={localSweep.count ?? 5}
                    onChange={(e) =>
                      setLocalSweep({
                        ...localSweep,
                        count: Math.max(2, Math.min(50, parseInt(e.target.value) || 5)),
                      })
                    }
                    className="h-9 text-sm font-mono"
                    min={2}
                    max={50}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5" />
                <span>
                  {formatValue(localSweep.from)} → {formatValue(localSweep.to)} ({localSweep.count} values, log scale)
                </span>
              </div>
            </div>
          )}

          {/* Discrete Choices Configuration */}
          {localSweep?.type === "or" && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Values (comma-separated)</Label>
                <Input
                  value={localSweep.choices?.join(", ") ?? ""}
                  onChange={(e) => {
                    const choices = e.target.value
                      .split(",")
                      .map((s) => {
                        const trimmed = s.trim();
                        if (trimmed === "") return null;
                        const num = parseFloat(trimmed);
                        if (!isNaN(num) && isNumeric) return num;
                        if (trimmed === "true") return true;
                        if (trimmed === "false") return false;
                        return trimmed;
                      })
                      .filter((v): v is string | number | boolean => v !== null);
                    setLocalSweep({ ...localSweep, choices });
                  }}
                  className="h-9 text-sm font-mono"
                  placeholder="1, 2, 3 or value1, value2"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <List className="h-3.5 w-3.5" />
                <span>{localSweep.choices?.length || 0} discrete value(s)</span>
              </div>
            </div>
          )}

          {/* Value Preview */}
          {previewValues.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Preview
              </Label>
              <div className="flex flex-wrap gap-1.5 p-3 rounded-lg bg-muted/50 border">
                {previewValues.map((val, idx) => (
                  <span key={idx}>
                    <Badge variant="outline" className="font-mono text-xs px-2 py-0.5">
                      {formatValue(val)}
                    </Badge>
                    {idx < previewValues.length - 1 && idx < 6 && (
                      <ArrowRight className="inline h-3 w-3 text-muted-foreground/50 mx-0.5" />
                    )}
                  </span>
                ))}
                {variantCount > 8 && (
                  <Badge variant="secondary" className="text-xs px-2 py-0.5">
                    +{variantCount - 8} more
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Quick Presets */}
          {relevantPresets.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Quick Presets
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {relevantPresets.slice(0, 6).map((preset, idx) => (
                  <Button
                    key={idx}
                    variant="outline"
                    size="sm"
                    onClick={() => setLocalSweep(preset.sweep)}
                    className="h-7 px-2.5 text-xs hover:bg-orange-500/10 hover:text-orange-600 hover:border-orange-500/50"
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="h-8 px-3 text-xs text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5 mr-1.5" />
            Clear Sweep
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            className="h-8 px-4 bg-orange-500 hover:bg-orange-600 text-xs font-medium"
          >
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Apply ({variantCount} values)
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * SweepActivator - Inline hover icon for parameter sweep activation
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
      {variantCount}×
    </Badge>
  );
}

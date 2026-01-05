/**
 * GeneratorRenderer - Generator step configuration renderer
 *
 * Provides UI for configuring generator steps with:
 * - Selection mode (choose with pick/arrange)
 * - Pick/Arrange as single value OR range [from, to]
 * - Second-order selection (then_pick, then_arrange) also as single value OR range
 * - Count limiter
 * - Variant preview
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback, useMemo, useState } from "react";
import {
  Sparkles,
  Info,
  Shuffle,
  Layers,
  ArrowRight,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";
import type { PipelineStep, GeneratorKind } from "../../types";

// Selection mode types - simplified to just pick/arrange with optional range
type PrimarySelectionMode = "none" | "pick" | "arrange";
type SecondarySelectionMode = "none" | "then_pick" | "then_arrange";

// Value can be a single number or a range [from, to]
type SelectionValue = number | [number, number];

interface SelectionConfig {
  primaryMode: PrimarySelectionMode;
  primaryValue?: SelectionValue;  // Single value or [from, to] range
  secondaryMode: SecondarySelectionMode;
  secondaryValue?: SelectionValue;  // Single value or [from, to] range
  count?: number;
}

// Check if value is a range
function isRange(value: SelectionValue | undefined): value is [number, number] {
  return Array.isArray(value) && value.length === 2;
}

// Calculate combinations C(n, k)
function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

// Calculate permutations P(n, k)
function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

// Calculate variants for a selection value (single or range)
function calculateVariantsForValue(
  optionCount: number,
  mode: "pick" | "arrange",
  value: SelectionValue
): number {
  if (isRange(value)) {
    // Range [from, to]: sum of all variants from 'from' to 'to'
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      if (mode === "pick") {
        total += combinations(optionCount, k);
      } else {
        total += permutations(optionCount, k);
      }
    }
    return total;
  } else {
    // Single value
    if (mode === "pick") {
      return combinations(optionCount, value);
    } else {
      return permutations(optionCount, value);
    }
  }
}

// Calculate variant count based on selection config
function calculateVariants(optionCount: number, config: SelectionConfig): number {
  let primary: number;

  switch (config.primaryMode) {
    case "none":
      // No pick/arrange = try each option (pick 1)
      primary = optionCount;
      break;
    case "pick":
      primary = calculateVariantsForValue(optionCount, "pick", config.primaryValue || 1);
      break;
    case "arrange":
      primary = calculateVariantsForValue(optionCount, "arrange", config.primaryValue || 1);
      break;
    default:
      primary = optionCount;
  }

  if (config.secondaryMode === "none") {
    return config.count ? Math.min(primary, config.count) : primary;
  }

  // Second-order calculation
  let secondary: number;
  switch (config.secondaryMode) {
    case "then_pick":
      secondary = calculateVariantsForValue(primary, "pick", config.secondaryValue || 2);
      break;
    case "then_arrange":
      secondary = calculateVariantsForValue(primary, "arrange", config.secondaryValue || 2);
      break;
    default:
      secondary = primary;
  }

  return config.count ? Math.min(secondary, config.count) : secondary;
}

// Extract config from step's generatorOptions
function extractConfig(step: PipelineStep): SelectionConfig {
  const opts = step.generatorOptions || {};

  // Determine primary mode
  let primaryMode: PrimarySelectionMode = "none";
  let primaryValue: SelectionValue | undefined;

  if (opts.arrange !== undefined) {
    primaryMode = "arrange";
    primaryValue = opts.arrange;
  } else if (opts.pick !== undefined) {
    primaryMode = "pick";
    primaryValue = opts.pick;
  }

  // Determine secondary mode
  let secondaryMode: SecondarySelectionMode = "none";
  let secondaryValue: SelectionValue | undefined;

  if (opts.then_arrange !== undefined) {
    secondaryMode = "then_arrange";
    secondaryValue = opts.then_arrange;
  } else if (opts.then_pick !== undefined) {
    secondaryMode = "then_pick";
    secondaryValue = opts.then_pick;
  }

  return {
    primaryMode,
    primaryValue,
    secondaryMode,
    secondaryValue,
    count: opts.count,
  };
}

// Convert config back to generatorOptions
function configToOptions(config: SelectionConfig): PipelineStep["generatorOptions"] {
  const opts: PipelineStep["generatorOptions"] = {};

  if (config.primaryMode === "pick" && config.primaryValue !== undefined) {
    opts.pick = config.primaryValue;
  } else if (config.primaryMode === "arrange" && config.primaryValue !== undefined) {
    opts.arrange = config.primaryValue;
  }
  // "none" mode means no pick/arrange - each option is tried individually

  if (config.secondaryMode === "then_pick" && config.secondaryValue !== undefined) {
    opts.then_pick = config.secondaryValue;
  }
  if (config.secondaryMode === "then_arrange" && config.secondaryValue !== undefined) {
    opts.then_arrange = config.secondaryValue;
  }

  if (config.count) {
    opts.count = config.count;
  }

  return opts;
}

const PRIMARY_MODE_OPTIONS: { value: PrimarySelectionMode; label: string; description: string; icon: typeof Sparkles }[] = [
  {
    value: "none",
    label: "Try Each",
    description: "Test each option individually",
    icon: Sparkles,
  },
  {
    value: "pick",
    label: "Pick",
    description: "Combinations (order ignored)",
    icon: Layers,
  },
  {
    value: "arrange",
    label: "Arrange",
    description: "Permutations (order matters)",
    icon: Shuffle,
  },
];

const SECONDARY_MODE_OPTIONS: { value: SecondarySelectionMode; label: string; description: string }[] = [
  {
    value: "none",
    label: "None",
    description: "No second-order selection",
  },
  {
    value: "then_pick",
    label: "Then Pick",
    description: "Combinations from results",
  },
  {
    value: "then_arrange",
    label: "Then Arrange",
    description: "Permutations from results",
  },
];

/**
 * RangeValueInput - Input for a value that can be a single number or a range [from, to]
 */
interface RangeValueInputProps {
  value: SelectionValue | undefined;
  onChange: (value: SelectionValue) => void;
  maxValue: number;
  label: string;
  rangeLabel?: string;
}

function RangeValueInput({ value, onChange, maxValue, label, rangeLabel }: RangeValueInputProps) {
  const isRangeMode = isRange(value);
  const singleValue = isRangeMode ? undefined : (value ?? 1);
  const rangeFrom = isRangeMode ? value[0] : 1;
  const rangeTo = isRangeMode ? value[1] : maxValue;

  const handleToggleRange = useCallback(() => {
    if (isRangeMode) {
      // Switch to single value (use the 'to' value)
      onChange(value[1] ?? 2);
    } else {
      // Switch to range [1, current value or max]
      onChange([1, singleValue ?? Math.min(2, maxValue)]);
    }
  }, [isRangeMode, value, singleValue, maxValue, onChange]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Range</Label>
          <Switch
            checked={isRangeMode}
            onCheckedChange={handleToggleRange}
            className="scale-75"
          />
        </div>
      </div>

      {isRangeMode ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={rangeTo}
            value={rangeFrom}
            onChange={(e) => {
              const newFrom = Math.max(1, Math.min(rangeTo, parseInt(e.target.value) || 1));
              onChange([newFrom, rangeTo]);
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="number"
            min={rangeFrom}
            max={maxValue}
            value={rangeTo}
            onChange={(e) => {
              const newTo = Math.max(rangeFrom, Math.min(maxValue, parseInt(e.target.value) || rangeFrom));
              onChange([rangeFrom, newTo]);
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-xs text-muted-foreground">
            {rangeLabel || `(all from ${rangeFrom} to ${rangeTo})`}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={maxValue}
            value={singleValue}
            onChange={(e) => {
              onChange(Math.max(1, Math.min(maxValue, parseInt(e.target.value) || 1)));
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-sm text-muted-foreground">of {maxValue}</span>
        </div>
      )}
    </div>
  );
}

/**
 * GeneratorRenderer - Configuration UI for generator steps
 */
export function GeneratorRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  // Get generator kind for display
  const generatorKind = step.generatorKind || "or";
  const isCartesian = generatorKind === "cartesian";
  const generatorLabel = step.name === "Grid"
    ? "Grid Search"
    : isCartesian
      ? "Cartesian Product"
      : "Choose";
  const generatorKeyword = step.name === "Grid"
    ? "_grid_"
    : isCartesian
      ? "_cartesian_"
      : "_or_";

  // Get option count from branches
  const optionCount = step.branches?.length || 0;

  // Extract current config
  const config = useMemo(() => extractConfig(step), [step]);

  // Calculate variants
  const variantCount = useMemo(
    () => calculateVariants(optionCount, config),
    [optionCount, config]
  );

  // Update config
  const handleConfigChange = useCallback(
    (updates: Partial<SelectionConfig>) => {
      const newConfig = { ...config, ...updates };
      onUpdate(step.id, {
        generatorOptions: configToOptions(newConfig),
      });
    },
    [config, onUpdate, step.id]
  );

  // Handle primary mode change
  const handlePrimaryModeChange = useCallback(
    (mode: PrimarySelectionMode) => {
      handleConfigChange({
        primaryMode: mode,
        primaryValue: mode === "none" ? undefined : config.primaryValue || 2,
      });
    },
    [handleConfigChange, config.primaryValue]
  );

  // Handle secondary mode change
  const handleSecondaryModeChange = useCallback(
    (mode: SecondarySelectionMode) => {
      handleConfigChange({
        secondaryMode: mode,
        secondaryValue: mode === "none" ? undefined : config.secondaryValue || 2,
      });
    },
    [handleConfigChange, config.secondaryValue]
  );

  const hasSecondarySelection = config.secondaryMode !== "none";
  const hasPrimarySelection = config.primaryMode !== "none";

  // Format value for display
  const formatValue = (value: SelectionValue | undefined): string => {
    if (value === undefined) return "";
    if (isRange(value)) {
      return `${value[0]} to ${value[1]}`;
    }
    return String(value);
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Generator Type Header */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <Sparkles className="h-5 w-5 text-orange-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{generatorLabel}</span>
                <Badge variant="outline" className="text-xs font-mono border-orange-500/50 text-orange-600">
                  {generatorKeyword}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {optionCount} option{optionCount !== 1 ? "s" : ""} → {variantCount} variant{variantCount !== 1 ? "s" : ""}
              </p>
            </div>
          </div>

          <Separator />

          {/* Selection Mode */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Selection Mode</Label>
            <Select
              value={config.primaryMode}
              onValueChange={(v) => handlePrimaryModeChange(v as PrimarySelectionMode)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {PRIMARY_MODE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <span className="font-medium">{opt.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      – {opt.description}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Pick/Arrange value - supports single value or range */}
            {hasPrimarySelection && (
              <div className="p-3 rounded-lg bg-muted/50 space-y-2">
                <RangeValueInput
                  value={config.primaryValue}
                  onChange={(value) => handleConfigChange({ primaryValue: value })}
                  maxValue={optionCount}
                  label={config.primaryMode === "pick" ? "Pick" : "Arrange"}
                />
                <div className="text-xs text-muted-foreground">
                  {isRange(config.primaryValue)
                    ? `All ${config.primaryMode === "pick" ? "combinations" : "permutations"} from ${config.primaryValue[0]} to ${config.primaryValue[1]}`
                    : config.primaryMode === "pick"
                      ? `C(${optionCount}, ${config.primaryValue || 1}) = ${combinations(optionCount, (config.primaryValue as number) || 1)} combinations`
                      : `P(${optionCount}, ${config.primaryValue || 1}) = ${permutations(optionCount, (config.primaryValue as number) || 1)} permutations`
                  }
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Second-Order Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Second-Order</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-48">
                    Apply a second selection on the primary results.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                checked={hasSecondarySelection}
                onCheckedChange={(checked) =>
                  handleSecondaryModeChange(checked ? "then_pick" : "none")
                }
              />
            </div>

            {hasSecondarySelection && (
              <div className="p-3 rounded-lg border border-dashed border-orange-500/30 bg-orange-500/5 space-y-3">
                <Select
                  value={config.secondaryMode}
                  onValueChange={(v) => handleSecondaryModeChange(v as SecondarySelectionMode)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    {SECONDARY_MODE_OPTIONS.filter((opt) => opt.value !== "none").map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <span className="font-medium">{opt.label}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          – {opt.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-orange-500 flex-shrink-0" />
                </div>
                <RangeValueInput
                  value={config.secondaryValue}
                  onChange={(value) => handleConfigChange({ secondaryValue: value })}
                  maxValue={variantCount}
                  label={config.secondaryMode === "then_pick" ? "Then Pick" : "Then Arrange"}
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Limit Variants */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Limit Variants</Label>
              <Switch
                checked={!!config.count}
                onCheckedChange={(checked) =>
                  handleConfigChange({ count: checked ? Math.min(10, variantCount) : undefined })
                }
              />
            </div>

            {config.count !== undefined && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Label className="text-sm text-muted-foreground">Max</Label>
                <Input
                  type="number"
                  min={1}
                  value={config.count}
                  onChange={(e) =>
                    handleConfigChange({
                      count: Math.max(1, parseInt(e.target.value) || 1),
                    })
                  }
                  className="w-20 h-8"
                />
                <span className="text-sm text-muted-foreground">
                  of {variantCount}
                </span>
              </div>
            )}
          </div>

          <Separator />

          {/* Summary */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
            <Settings2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              <p className="font-medium">
                {config.primaryMode === "none" && "Each option tested individually"}
                {config.primaryMode === "pick" && (
                  isRange(config.primaryValue)
                    ? `All combinations from ${config.primaryValue[0]} to ${config.primaryValue[1]}`
                    : `All ${config.primaryValue}-combinations`
                )}
                {config.primaryMode === "arrange" && (
                  isRange(config.primaryValue)
                    ? `All permutations from ${config.primaryValue[0]} to ${config.primaryValue[1]}`
                    : `All ${config.primaryValue}-permutations`
                )}
              </p>
              {hasSecondarySelection && (
                <p className="text-xs text-muted-foreground mt-1">
                  {config.secondaryMode === "then_pick" &&
                    `→ Then pick ${formatValue(config.secondaryValue)} from results`}
                  {config.secondaryMode === "then_arrange" &&
                    `→ Then arrange ${formatValue(config.secondaryValue)} from results`}
                </p>
              )}
              <p className="text-xs text-orange-600 mt-1">
                Total: {config.count ? Math.min(config.count, variantCount) : variantCount} variant{(config.count ? Math.min(config.count, variantCount) : variantCount) !== 1 ? "s" : ""}
              </p>
            </div>
          </div>
        </div>
      </ScrollArea>

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}

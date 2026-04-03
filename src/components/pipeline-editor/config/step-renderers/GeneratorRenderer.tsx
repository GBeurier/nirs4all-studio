/**
 * GeneratorRenderer - Generator step configuration renderer
 *
 * Provides UI for configuring generator steps (_or_, _cartesian_, _grid_,
 * _zip_, _chain_, _sample_, _range_, _log_range_) with:
 * - Selection mode (pick/arrange) for _or_ and _cartesian_
 * - Pick/Arrange as single value OR range [from, to]
 * - Second-order selection (then_pick, then_arrange) for _or_
 * - Count limiter and seed
 * - Variant count preview
 */

import { useCallback, useMemo } from "react";
import {
  Sparkles,
  Info,
  Shuffle,
  Layers,
  ArrowRight,
  Settings2,
  Hash,
  Link2,
  ListOrdered,
  BarChart3,
  GitBranch,
  Ruler,
} from "lucide-react";
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

// ---------------------------------------------------------------------------
// Selection types
// ---------------------------------------------------------------------------

type PrimarySelectionMode = "none" | "pick" | "arrange";
type SecondarySelectionMode = "none" | "then_pick" | "then_arrange";
type SelectionValue = number | [number, number];

interface SelectionConfig {
  primaryMode: PrimarySelectionMode;
  primaryValue?: SelectionValue;
  secondaryMode: SecondarySelectionMode;
  secondaryValue?: SelectionValue;
  count?: number;
  seed?: number;
}

// ---------------------------------------------------------------------------
// Generator kind metadata
// ---------------------------------------------------------------------------

interface GeneratorKindMeta {
  label: string;
  keyword: string;
  icon: typeof Sparkles;
  description: string;
  supportsPickArrange: boolean;
  supportsSecondOrder: boolean;
  variantLabel: string;
  branchLabel: string;
}

const GENERATOR_KINDS: Record<string, GeneratorKindMeta> = {
  or: {
    label: "Or (Choose)",
    keyword: "_or_",
    icon: Sparkles,
    description: "Choose from alternatives — each branch is one option",
    supportsPickArrange: true,
    supportsSecondOrder: true,
    variantLabel: "variant",
    branchLabel: "option",
  },
  cartesian: {
    label: "Cartesian Product",
    keyword: "_cartesian_",
    icon: Layers,
    description: "Cross all stages — each branch is a stage",
    supportsPickArrange: true,
    supportsSecondOrder: false,
    variantLabel: "combination",
    branchLabel: "stage",
  },
  grid: {
    label: "Grid Search",
    keyword: "_grid_",
    icon: Hash,
    description: "Cartesian product of parameter values",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "combination",
    branchLabel: "param",
  },
  zip: {
    label: "Zip",
    keyword: "_zip_",
    icon: Link2,
    description: "Pair parameter values by position",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "pair",
    branchLabel: "param",
  },
  chain: {
    label: "Chain",
    keyword: "_chain_",
    icon: ListOrdered,
    description: "Ordered sequence of configurations",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "config",
    branchLabel: "config",
  },
  sample: {
    label: "Sample",
    keyword: "_sample_",
    icon: BarChart3,
    description: "Random samples from a distribution",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "sample",
    branchLabel: "sample",
  },
  range: {
    label: "Range",
    keyword: "_range_",
    icon: Ruler,
    description: "Linear numeric sequence",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "value",
    branchLabel: "value",
  },
  log_range: {
    label: "Log Range",
    keyword: "_log_range_",
    icon: GitBranch,
    description: "Logarithmically-spaced values",
    supportsPickArrange: false,
    supportsSecondOrder: false,
    variantLabel: "value",
    branchLabel: "value",
  },
};

function getKindMeta(kind: string): GeneratorKindMeta {
  return GENERATOR_KINDS[kind] ?? GENERATOR_KINDS.or;
}

// ---------------------------------------------------------------------------
// Combinatorics helpers
// ---------------------------------------------------------------------------

function isRange(value: SelectionValue | undefined): value is [number, number] {
  return Array.isArray(value) && value.length === 2;
}

function combinations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result = (result * (n - i)) / (i + 1);
  }
  return Math.round(result);
}

function permutations(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 0; i < k; i++) {
    result *= n - i;
  }
  return result;
}

function calculateVariantsForValue(
  optionCount: number,
  mode: "pick" | "arrange",
  value: SelectionValue
): number {
  if (isRange(value)) {
    const [from, to] = value;
    let total = 0;
    for (let k = from; k <= to; k++) {
      total += mode === "pick" ? combinations(optionCount, k) : permutations(optionCount, k);
    }
    return total;
  }
  return mode === "pick" ? combinations(optionCount, value) : permutations(optionCount, value);
}

// ---------------------------------------------------------------------------
// Variant count calculator
// ---------------------------------------------------------------------------

function calculateVariants(optionCount: number, config: SelectionConfig, kind: string): number {
  // For grid: Cartesian product of branch sizes (would need branch info — approximate with optionCount)
  if (kind === "grid") {
    // Each branch is a param dimension; total = product of branch sizes
    // Since we don't have individual branch sizes, use optionCount as a proxy
    return applyCountLimit(optionCount, config.count);
  }

  // For zip: min of branch sizes — approximate with optionCount
  if (kind === "zip") {
    return applyCountLimit(optionCount, config.count);
  }

  // For chain: flat count of branches
  if (kind === "chain") {
    return applyCountLimit(optionCount, config.count);
  }

  // For sample/range/log_range: driven by their own params, not branches
  if (kind === "sample" || kind === "range" || kind === "log_range") {
    return applyCountLimit(optionCount, config.count);
  }

  // For or/cartesian: use pick/arrange logic
  let primary: number;

  switch (config.primaryMode) {
    case "none":
      if (kind === "cartesian") {
        // Cartesian = product of options per stage. Without per-stage sizes, show branch count
        primary = optionCount;
      } else {
        primary = optionCount; // or: try each
      }
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

  if (config.secondaryMode !== "none") {
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
    return applyCountLimit(secondary, config.count);
  }

  return applyCountLimit(primary, config.count);
}

function applyCountLimit(total: number, count?: number): number {
  return count && count > 0 ? Math.min(total, count) : total;
}

// ---------------------------------------------------------------------------
// Config extraction / serialization
// ---------------------------------------------------------------------------

function extractConfig(step: PipelineStep): SelectionConfig {
  const opts = step.generatorOptions || {};

  let primaryMode: PrimarySelectionMode = "none";
  let primaryValue: SelectionValue | undefined;

  if (opts.arrange !== undefined) {
    primaryMode = "arrange";
    primaryValue = opts.arrange;
  } else if (opts.pick !== undefined) {
    primaryMode = "pick";
    primaryValue = opts.pick;
  }

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
    seed: (step.params as Record<string, unknown>)?._seed_ as number | undefined,
  };
}

function configToOptions(config: SelectionConfig): PipelineStep["generatorOptions"] {
  const opts: PipelineStep["generatorOptions"] = {};

  if (config.primaryMode === "pick" && config.primaryValue !== undefined) {
    opts.pick = config.primaryValue;
  } else if (config.primaryMode === "arrange" && config.primaryValue !== undefined) {
    opts.arrange = config.primaryValue;
  }

  if (config.secondaryMode === "then_pick" && config.secondaryValue !== undefined) {
    opts.then_pick = config.secondaryValue;
  }
  if (config.secondaryMode === "then_arrange" && config.secondaryValue !== undefined) {
    opts.then_arrange = config.secondaryValue;
  }

  if (config.count && config.count > 0) {
    opts.count = config.count;
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Selection mode options
// ---------------------------------------------------------------------------

const PRIMARY_MODE_OPTIONS: { value: PrimarySelectionMode; label: string; description: string; icon: typeof Sparkles }[] = [
  { value: "none", label: "Try Each", description: "Test each option individually", icon: Sparkles },
  { value: "pick", label: "Pick", description: "Combinations (order ignored)", icon: Layers },
  { value: "arrange", label: "Arrange", description: "Permutations (order matters)", icon: Shuffle },
];

const SECONDARY_MODE_OPTIONS: { value: SecondarySelectionMode; label: string; description: string }[] = [
  { value: "none", label: "None", description: "No second-order selection" },
  { value: "then_pick", label: "Then Pick", description: "Combinations from results" },
  { value: "then_arrange", label: "Then Arrange", description: "Permutations from results" },
];

// ---------------------------------------------------------------------------
// RangeValueInput
// ---------------------------------------------------------------------------

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
      onChange(value[1] ?? 2);
    } else {
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

// ---------------------------------------------------------------------------
// GeneratorRenderer
// ---------------------------------------------------------------------------

export function GeneratorRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepRendererProps) {
  const generatorKind = (() => {
    if (step.generatorKind) return step.generatorKind as string;
    console.warn(
      `[GeneratorRenderer] step "${step.id}" (${step.name}) missing generatorKind, defaulting to "or"`
    );
    return "or";
  })();
  const meta = getKindMeta(generatorKind);
  const Icon = meta.icon;

  const optionCount = step.branches?.length || 0;
  const config = useMemo(() => extractConfig(step), [step]);

  const variantCount = useMemo(
    () => calculateVariants(optionCount, config, generatorKind),
    [optionCount, config, generatorKind]
  );

  const handleConfigChange = useCallback(
    (updates: Partial<SelectionConfig>) => {
      const newConfig = { ...config, ...updates };
      const updatePayload: Record<string, unknown> = {
        generatorOptions: configToOptions(newConfig),
      };
      // Persist seed in params
      if (updates.seed !== undefined) {
        updatePayload.params = { ...step.params, _seed_: updates.seed || undefined };
      }
      onUpdate(step.id, updatePayload);
    },
    [config, onUpdate, step.id, step.params]
  );

  const handlePrimaryModeChange = useCallback(
    (mode: PrimarySelectionMode) => {
      handleConfigChange({
        primaryMode: mode,
        primaryValue: mode === "none" ? undefined : config.primaryValue || 2,
      });
    },
    [handleConfigChange, config.primaryValue]
  );

  const handleSecondaryModeChange = useCallback(
    (mode: SecondarySelectionMode) => {
      handleConfigChange({
        secondaryMode: mode,
        secondaryValue: mode === "none" ? undefined : config.secondaryValue || 2,
      });
    },
    [handleConfigChange, config.secondaryValue]
  );

  const hasPrimarySelection = config.primaryMode !== "none";
  const hasSecondarySelection = config.secondaryMode !== "none";

  const formatValue = (value: SelectionValue | undefined): string => {
    if (value === undefined) return "";
    if (isRange(value)) return `${value[0]} to ${value[1]}`;
    return String(value);
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Generator Type Header */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
            <Icon className="h-5 w-5 text-orange-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm">{meta.label}</span>
                <Badge variant="outline" className="text-xs font-mono border-orange-500/50 text-orange-600">
                  {meta.keyword}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {meta.description}
              </p>
              {optionCount > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {optionCount} {meta.branchLabel}{optionCount !== 1 ? "s" : ""} {" \u2192 "} {variantCount} {meta.variantLabel}{variantCount !== 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>

          {/* Selection Mode — only for _or_ and _cartesian_ */}
          {meta.supportsPickArrange && (
            <>
              <Separator />
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
                          {" \u2013 "}{opt.description}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

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
            </>
          )}

          {/* Second-Order Selection — only for _or_ */}
          {meta.supportsSecondOrder && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">Second-Order</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-48">
                        Apply a second selection (then_pick / then_arrange) on the primary results.
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
                              {" \u2013 "}{opt.description}
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
            </>
          )}

          <Separator />

          {/* Limit Variants (count) — available for all generator kinds */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Limit Variants</Label>
              <Switch
                checked={!!config.count && config.count > 0}
                onCheckedChange={(checked) =>
                  handleConfigChange({ count: checked ? Math.min(10, variantCount) : undefined })
                }
              />
            </div>

            {config.count !== undefined && config.count > 0 && (
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

          {/* Seed — available for all generator kinds */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium">Seed</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="right" className="max-w-48">
                    Set a seed for deterministic, reproducible generation.
                  </TooltipContent>
                </Tooltip>
              </div>
              <Switch
                checked={config.seed !== undefined}
                onCheckedChange={(checked) =>
                  handleConfigChange({ seed: checked ? 42 : undefined })
                }
              />
            </div>

            {config.seed !== undefined && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
                <Label className="text-sm text-muted-foreground">_seed_</Label>
                <Input
                  type="number"
                  min={0}
                  value={config.seed}
                  onChange={(e) =>
                    handleConfigChange({
                      seed: Math.max(0, parseInt(e.target.value) || 0),
                    })
                  }
                  className="w-24 h-8"
                />
              </div>
            )}
          </div>

          <Separator />

          {/* Summary */}
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
            <Settings2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="text-sm min-w-0">
              {meta.supportsPickArrange && (
                <p className="font-medium">
                  {config.primaryMode === "none" && (
                    generatorKind === "cartesian"
                      ? "All stage combinations"
                      : "Each option tested individually"
                  )}
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
              )}
              {!meta.supportsPickArrange && (
                <p className="font-medium">
                  {meta.description}
                </p>
              )}
              {hasSecondarySelection && (
                <p className="text-xs text-muted-foreground mt-1">
                  {config.secondaryMode === "then_pick" &&
                    `\u2192 Then pick ${formatValue(config.secondaryValue)} from results`}
                  {config.secondaryMode === "then_arrange" &&
                    `\u2192 Then arrange ${formatValue(config.secondaryValue)} from results`}
                </p>
              )}
              <p className="text-xs text-orange-600 mt-1">
                Total: {applyCountLimit(variantCount, config.count)} {meta.variantLabel}{applyCountLimit(variantCount, config.count) !== 1 ? "s" : ""}
                {config.seed !== undefined && ` (seed: ${config.seed})`}
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

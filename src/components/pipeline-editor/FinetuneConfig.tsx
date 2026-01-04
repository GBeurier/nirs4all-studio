/**
 * FinetuneConfig - Optuna-based hyperparameter optimization UI
 *
 * Phase 3 Implementation:
 * - FinetuneTab: Main tab content for model step finetuning
 * - FinetuneEnableToggle: Master on/off with visual indicator
 * - FinetuneSearchConfig: Trials, timeout, approach, eval_mode settings
 * - FinetuneParamList: List of parameters to optimize
 * - FinetuneParamEditor: Individual parameter search space configuration
 *
 * Color scheme: Purple (vs orange for sweeps)
 */

import { useState, useMemo, useCallback } from "react";
import {
  Sparkles,
  Plus,
  Trash2,
  Info,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Edit3,
  X,
  Check,
  Lightbulb,
  Zap,
  Target,
  Settings2,
  Clock,
  Hash,
  BarChart3,
  List,
  TrendingUp,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type {
  PipelineStep,
  FinetuneConfig,
  FinetuneParamConfig,
  FinetuneParamType,
  TrainingConfig,
} from "./types";

// Default finetuning configuration
export const defaultFinetuneConfig: FinetuneConfig = {
  enabled: false,
  n_trials: 50,
  timeout: undefined,
  approach: "grouped",
  eval_mode: "best",
  model_params: [],
};

// Common parameter presets for different models
interface ParamPreset {
  name: string;
  type: FinetuneParamType;
  low?: number;
  high?: number;
  step?: number;
  choices?: (string | number)[];
  description: string;
  forModels?: string[];
}

const paramPresets: ParamPreset[] = [
  // PLS parameters
  {
    name: "n_components",
    type: "int",
    low: 1,
    high: 30,
    step: 1,
    description: "Number of PLS components",
    forModels: ["PLSRegression", "PLSDA", "OPLS", "OPLSDA", "IKPLS", "SparsePLS", "LWPLS", "IntervalPLS"],
  },
  // Regularization
  {
    name: "alpha",
    type: "log_float",
    low: 0.0001,
    high: 100,
    description: "Regularization strength (log scale)",
    forModels: ["Ridge", "Lasso", "ElasticNet", "SparsePLS"],
  },
  {
    name: "l1_ratio",
    type: "float",
    low: 0,
    high: 1,
    description: "L1/L2 ratio for ElasticNet",
    forModels: ["ElasticNet"],
  },
  // SVM
  {
    name: "C",
    type: "log_float",
    low: 0.01,
    high: 100,
    description: "SVM regularization parameter",
    forModels: ["SVR", "SVC"],
  },
  {
    name: "epsilon",
    type: "log_float",
    low: 0.001,
    high: 1,
    description: "SVR epsilon",
    forModels: ["SVR"],
  },
  {
    name: "gamma",
    type: "log_float",
    low: 0.0001,
    high: 10,
    description: "RBF kernel gamma",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  {
    name: "kernel",
    type: "categorical",
    choices: ["rbf", "linear", "poly"],
    description: "SVM kernel type",
    forModels: ["SVR", "SVC", "KernelPLS"],
  },
  // Ensemble
  {
    name: "n_estimators",
    type: "int",
    low: 50,
    high: 500,
    step: 50,
    description: "Number of trees in ensemble",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "max_depth",
    type: "int",
    low: 3,
    high: 20,
    step: 1,
    description: "Maximum tree depth",
    forModels: ["RandomForestRegressor", "RandomForestClassifier", "XGBoost", "LightGBM"],
  },
  {
    name: "learning_rate",
    type: "log_float",
    low: 0.001,
    high: 0.3,
    description: "Gradient boosting learning rate",
    forModels: ["XGBoost", "LightGBM"],
  },
  // LWPLS
  {
    name: "n_neighbors",
    type: "int",
    low: 10,
    high: 100,
    step: 10,
    description: "Number of neighbors for local weighting",
    forModels: ["LWPLS"],
  },
  // IntervalPLS
  {
    name: "n_intervals",
    type: "int",
    low: 5,
    high: 50,
    step: 5,
    description: "Number of spectral intervals",
    forModels: ["IntervalPLS"],
  },
];

// Get relevant presets for a model
function getPresetsForModel(modelName: string): ParamPreset[] {
  return paramPresets.filter(
    (p) => !p.forModels || p.forModels.includes(modelName)
  );
}

// Format parameter type for display
function formatParamType(type: FinetuneParamType): string {
  switch (type) {
    case "int":
      return "Integer";
    case "float":
      return "Float";
    case "log_float":
      return "Log Float";
    case "categorical":
      return "Categorical";
    default:
      return type;
  }
}

// Get icon for parameter type
function getParamTypeIcon(type: FinetuneParamType): typeof Hash {
  switch (type) {
    case "int":
      return Hash;
    case "float":
      return TrendingUp;
    case "log_float":
      return Sparkles;
    case "categorical":
      return List;
    default:
      return Hash;
  }
}

// =============================================================================
// FinetuneEnableToggle - Master on/off with visual indicator
// =============================================================================

interface FinetuneEnableToggleProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  paramCount: number;
}

export function FinetuneEnableToggle({
  enabled,
  onToggle,
  paramCount,
}: FinetuneEnableToggleProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between p-4 rounded-lg border-2 transition-all",
        enabled
          ? "border-purple-500 bg-purple-500/5"
          : "border-border hover:border-purple-500/30"
      )}
    >
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg transition-colors",
            enabled ? "bg-purple-500/20" : "bg-muted"
          )}
        >
          <Sparkles
            className={cn(
              "h-5 w-5 transition-colors",
              enabled ? "text-purple-500" : "text-muted-foreground"
            )}
          />
        </div>
        <div>
          <h4 className="font-medium">Optuna Finetuning</h4>
          <p className="text-sm text-muted-foreground">
            {enabled
              ? `Optimizing ${paramCount} parameter${paramCount !== 1 ? "s" : ""}`
              : "Enable intelligent hyperparameter search"}
          </p>
        </div>
      </div>

      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-purple-500"
      />
    </div>
  );
}

// =============================================================================
// FinetuneSearchConfig - Trials, timeout, approach, eval_mode settings
// =============================================================================

interface FinetuneSearchConfigProps {
  config: FinetuneConfig;
  onUpdate: (updates: Partial<FinetuneConfig>) => void;
}

export function FinetuneSearchConfig({
  config,
  onUpdate,
}: FinetuneSearchConfigProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div className="space-y-4">
      {/* Primary settings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Number of Trials</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px]">
                How many configurations Optuna will try. More trials = better results but longer runtime.
              </TooltipContent>
            </Tooltip>
          </div>
          <Input
            type="number"
            value={config.n_trials}
            onChange={(e) =>
              onUpdate({ n_trials: Math.max(1, parseInt(e.target.value) || 10) })
            }
            min={1}
            max={1000}
            className="font-mono"
          />
          <div className="flex gap-1">
            {[20, 50, 100, 200].map((n) => (
              <Button
                key={n}
                variant={config.n_trials === n ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onUpdate({ n_trials: n })}
              >
                {n}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm">Timeout (seconds)</Label>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent className="max-w-[200px]">
                Maximum time for optimization. Leave empty for no limit.
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="relative">
            <Input
              type="number"
              value={config.timeout ?? ""}
              onChange={(e) =>
                onUpdate({
                  timeout: e.target.value
                    ? Math.max(60, parseInt(e.target.value))
                    : undefined,
                })
              }
              placeholder="No limit"
              min={60}
              className="font-mono pr-10"
            />
            <Timer className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex gap-1">
            {[
              { label: "1h", value: 3600 },
              { label: "2h", value: 7200 },
              { label: "No limit", value: undefined },
            ].map((opt) => (
              <Button
                key={opt.label}
                variant={config.timeout === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={() => onUpdate({ timeout: opt.value })}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced settings */}
      <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-between h-8 text-muted-foreground"
          >
            <span className="text-xs">Advanced Settings</span>
            {showAdvanced ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="pt-3">
          <div className="grid grid-cols-2 gap-4">
            {/* Approach */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Optimization Approach</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px]">
                    <p className="font-medium">Grouped</p>
                    <p className="text-xs">Same parameters for all CV folds (faster)</p>
                    <p className="font-medium mt-2">Individual</p>
                    <p className="text-xs">Different parameters per fold (more flexible)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={config.approach}
                onValueChange={(value: "grouped" | "individual") =>
                  onUpdate({ approach: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="grouped">
                    <div className="flex items-center gap-2">
                      <Target className="h-4 w-4" />
                      <span>Grouped (recommended)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="individual">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4" />
                      <span>Individual</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Evaluation mode */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Evaluation Mode</Label>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[220px]">
                    <p className="font-medium">Best Score</p>
                    <p className="text-xs">Use the best fold score to guide search</p>
                    <p className="font-medium mt-2">Mean Score</p>
                    <p className="text-xs">Use average across folds (more robust)</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <Select
                value={config.eval_mode}
                onValueChange={(value: "best" | "mean") =>
                  onUpdate({ eval_mode: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="best">Best Score</SelectItem>
                  <SelectItem value="mean">Mean Score (robust)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
        <Lightbulb className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p>
            Optuna uses Bayesian optimization to intelligently explore the parameter space.
            It will typically find good solutions in ~{config.n_trials} trials rather than
            exhaustively testing all combinations.
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// FinetuneParamEditor - Individual parameter search space configuration
// =============================================================================

interface FinetuneParamEditorProps {
  param: FinetuneParamConfig;
  onUpdate: (updates: Partial<FinetuneParamConfig>) => void;
  onRemove: () => void;
  existingParams: string[];
  modelName: string;
}

export function FinetuneParamEditor({
  param,
  onUpdate,
  onRemove,
  existingParams,
  modelName,
}: FinetuneParamEditorProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const TypeIcon = getParamTypeIcon(param.type);

  // Validation
  const validationError = useMemo(() => {
    if (param.type === "categorical") {
      if (!param.choices || param.choices.length < 2) {
        return "At least 2 choices required";
      }
    } else {
      if (param.low === undefined || param.high === undefined) {
        return "Low and high values required";
      }
      if (param.low >= param.high) {
        return "Low must be less than high";
      }
      if (param.type === "log_float" && param.low <= 0) {
        return "Log scale requires positive values";
      }
    }
    return null;
  }, [param]);

  // Format search space for display
  const searchSpaceDisplay = useMemo(() => {
    if (param.type === "categorical") {
      return param.choices?.join(", ") ?? "";
    }
    const stepStr = param.step ? `, step=${param.step}` : "";
    const scaleStr = param.type === "log_float" ? " (log)" : "";
    return `[${param.low}, ${param.high}${stepStr}]${scaleStr}`;
  }, [param]);

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        validationError
          ? "border-destructive/50 bg-destructive/5"
          : "border-purple-500/30 bg-purple-500/5"
      )}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <TypeIcon className="h-4 w-4 text-purple-500" />
          <span className="font-medium text-sm font-mono">{param.name}</span>
          <Badge
            variant="outline"
            className="text-[10px] border-purple-500/50 text-purple-500"
          >
            {formatParamType(param.type)}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {validationError && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </TooltipTrigger>
              <TooltipContent>{validationError}</TooltipContent>
            </Tooltip>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {searchSpaceDisplay}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* Configuration */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-1 border-t border-border/30 space-y-3">
          {/* Type selection */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["int", "float", "log_float", "categorical"] as FinetuneParamType[]).map(
                (type) => {
                  const Icon = getParamTypeIcon(type);
                  return (
                    <Button
                      key={type}
                      variant={param.type === type ? "default" : "outline"}
                      size="sm"
                      className={cn(
                        "h-8 text-xs",
                        param.type === type && "bg-purple-500 hover:bg-purple-600"
                      )}
                      onClick={() => {
                        // Reset values when type changes
                        if (type === "categorical") {
                          onUpdate({
                            type,
                            low: undefined,
                            high: undefined,
                            step: undefined,
                            choices: param.choices || [],
                          });
                        } else {
                          onUpdate({
                            type,
                            choices: undefined,
                            low: param.low ?? 1,
                            high: param.high ?? 10,
                            step: type === "int" ? 1 : undefined,
                          });
                        }
                      }}
                    >
                      <Icon className="h-3.5 w-3.5 mr-1" />
                      {formatParamType(type).split(" ")[0]}
                    </Button>
                  );
                }
              )}
            </div>
          </div>

          {/* Numeric configuration */}
          {param.type !== "categorical" && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Low</Label>
                <Input
                  type="number"
                  value={param.low ?? ""}
                  onChange={(e) =>
                    onUpdate({ low: parseFloat(e.target.value) || 0 })
                  }
                  className="h-8 text-xs font-mono"
                  step={param.type === "int" ? 1 : 0.001}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">High</Label>
                <Input
                  type="number"
                  value={param.high ?? ""}
                  onChange={(e) =>
                    onUpdate({ high: parseFloat(e.target.value) || 10 })
                  }
                  className="h-8 text-xs font-mono"
                  step={param.type === "int" ? 1 : 0.001}
                />
              </div>
              {param.type === "int" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Step{" "}
                    <span className="text-muted-foreground/50">(opt)</span>
                  </Label>
                  <Input
                    type="number"
                    value={param.step ?? ""}
                    onChange={(e) =>
                      onUpdate({
                        step: e.target.value
                          ? parseInt(e.target.value)
                          : undefined,
                      })
                    }
                    className="h-8 text-xs font-mono"
                    placeholder="1"
                    min={1}
                  />
                </div>
              )}
            </div>
          )}

          {/* Categorical configuration */}
          {param.type === "categorical" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Choices (comma-separated)
              </Label>
              <Input
                value={param.choices?.join(", ") ?? ""}
                onChange={(e) => {
                  const choices = e.target.value
                    .split(",")
                    .map((s) => {
                      const trimmed = s.trim();
                      const num = parseFloat(trimmed);
                      return !isNaN(num) ? num : trimmed;
                    })
                    .filter((v) => v !== "");
                  onUpdate({ choices });
                }}
                className="h-8 text-xs font-mono"
                placeholder="rbf, linear, poly"
              />
            </div>
          )}

          {/* Type-specific hints */}
          {param.type === "log_float" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Info className="h-3 w-3" />
              Values will be sampled on a logarithmic scale (10^x)
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FinetuneParamList - List of parameters to optimize with add functionality
// =============================================================================

interface FinetuneParamListProps {
  params: FinetuneParamConfig[];
  onUpdate: (params: FinetuneParamConfig[]) => void;
  modelName: string;
  availableParams: string[];
}

export function FinetuneParamList({
  params,
  onUpdate,
  modelName,
  availableParams,
}: FinetuneParamListProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Get presets for this model
  const presets = useMemo(() => getPresetsForModel(modelName), [modelName]);

  // Filter out already-added params
  const unusedParams = useMemo(
    () => availableParams.filter((p) => !params.find((ep) => ep.name === p)),
    [availableParams, params]
  );

  const unusedPresets = useMemo(
    () => presets.filter((p) => !params.find((ep) => ep.name === p.name)),
    [presets, params]
  );

  const handleAddParam = (name: string, preset?: ParamPreset) => {
    const newParam: FinetuneParamConfig = preset
      ? {
          name: preset.name,
          type: preset.type,
          low: preset.low,
          high: preset.high,
          step: preset.step,
          choices: preset.choices,
        }
      : {
          name,
          type: "int",
          low: 1,
          high: 10,
        };
    onUpdate([...params, newParam]);
    setShowAddPopover(false);
  };

  const handleUpdateParam = (index: number, updates: Partial<FinetuneParamConfig>) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], ...updates };
    onUpdate(newParams);
  };

  const handleRemoveParam = (index: number) => {
    onUpdate(params.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Parameters to Optimize</Label>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-purple-500/50 text-purple-500 hover:bg-purple-500/10"
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Parameter
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Add Tunable Parameter</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Select from presets or add custom
              </p>
            </div>

            <ScrollArea className="max-h-64">
              <div className="p-2">
                {/* Presets */}
                {unusedPresets.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                      Recommended for {modelName}
                    </p>
                    {unusedPresets.map((preset) => (
                      <Button
                        key={preset.name}
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start h-auto py-2 px-2"
                        onClick={() => handleAddParam(preset.name, preset)}
                      >
                        <div className="flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{preset.name}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {formatParamType(preset.type)}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {preset.description}
                          </p>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}

                {/* Other available params */}
                {unusedParams.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground px-2 py-1 font-medium">
                      Other Parameters
                    </p>
                    <div className="flex flex-wrap gap-1 px-2">
                      {unusedParams.map((param) => (
                        <Button
                          key={param}
                          variant="outline"
                          size="sm"
                          className="h-6 text-xs"
                          onClick={() => handleAddParam(param)}
                        >
                          {param}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {unusedParams.length === 0 && unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All available parameters have been added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {/* Parameter list */}
      {params.length === 0 ? (
        <div className="text-center py-6 bg-muted/30 rounded-lg border border-dashed">
          <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            No parameters configured
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add parameters to define the search space
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => (
            <FinetuneParamEditor
              key={param.name}
              param={param}
              onUpdate={(updates) => handleUpdateParam(index, updates)}
              onRemove={() => handleRemoveParam(index)}
              existingParams={params.map((p) => p.name)}
              modelName={modelName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// TrainParamsList - Training parameters for neural network models
// =============================================================================

// Common training parameters for neural networks
const TRAIN_PARAM_PRESETS: ParamPreset[] = [
  { name: "epochs", type: "int", low: 10, high: 500, step: 10, description: "Training epochs" },
  { name: "batch_size", type: "categorical", choices: [16, 32, 64, 128, 256], description: "Batch size" },
  { name: "learning_rate", type: "log_float", low: 0.0001, high: 0.1, description: "Learning rate" },
  { name: "patience", type: "int", low: 5, high: 50, step: 5, description: "Early stopping patience" },
  { name: "dropout", type: "float", low: 0.0, high: 0.5, step: 0.1, description: "Dropout rate" },
  { name: "weight_decay", type: "log_float", low: 0.00001, high: 0.01, description: "Weight decay" },
];

// Neural network model names that support train_params
const NEURAL_NETWORK_MODELS = [
  "Nicon", "MLPRegressor", "MLPClassifier", "DeepPLS",
  "TabPFN", "XGBoost", "LightGBM", "CatBoost"
];

interface TrainParamsListProps {
  params: FinetuneParamConfig[];
  onUpdate: (params: FinetuneParamConfig[]) => void;
  modelName: string;
}

function TrainParamsList({ params, onUpdate, modelName }: TrainParamsListProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for neural network models
  const isNeuralNetwork = useMemo(
    () => NEURAL_NETWORK_MODELS.some(m => modelName.toLowerCase().includes(m.toLowerCase())),
    [modelName]
  );

  // Filter out already-added params
  const unusedPresets = useMemo(
    () => TRAIN_PARAM_PRESETS.filter((p) => !params.find((ep) => ep.name === p.name)),
    [params]
  );

  const handleAddParam = (preset: ParamPreset) => {
    const newParam: FinetuneParamConfig = {
      name: preset.name,
      type: preset.type,
      low: preset.low,
      high: preset.high,
      step: preset.step,
      choices: preset.choices,
    };
    onUpdate([...params, newParam]);
    setShowAddPopover(false);
  };

  const handleUpdateParam = (index: number, updates: Partial<FinetuneParamConfig>) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], ...updates };
    onUpdate(newParams);
  };

  const handleRemoveParam = (index: number) => {
    onUpdate(params.filter((_, i) => i !== index));
  };

  // Don't render if not a neural network model
  if (!isNeuralNetwork) return null;

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Training Parameters
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tune training hyperparameters (epochs, batch_size, etc.)
          </p>
        </div>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
              disabled={unusedPresets.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Training Param
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Training Parameters</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Add training hyperparameters to tune
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-1">
                {unusedPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleAddParam(preset)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{preset.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {preset.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                  </button>
                ))}
                {unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All training parameters added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {params.length === 0 ? (
        <div className="text-center py-4 rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">No training parameters to tune</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add epochs, batch_size, learning_rate, etc.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => (
            <FinetuneParamEditor
              key={param.name}
              param={param}
              onUpdate={(updates) => handleUpdateParam(index, updates)}
              onRemove={() => handleRemoveParam(index)}
              existingParams={params.map((p) => p.name)}
              modelName={modelName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// BestModelTrainingConfig - Static training params for best model training
// =============================================================================

interface BestModelTrainingConfigProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  modelName: string;
}

// Static training parameter presets (fixed values, not ranges)
const STATIC_TRAIN_PARAM_PRESETS = [
  { name: "epochs", default: 100, type: "number" as const, description: "Training epochs" },
  { name: "batch_size", default: 32, type: "number" as const, description: "Batch size" },
  { name: "learning_rate", default: 0.001, type: "number" as const, description: "Learning rate" },
  { name: "patience", default: 20, type: "number" as const, description: "Early stopping patience" },
  { name: "verbose", default: 0, type: "number" as const, description: "Verbosity level (0-2)" },
];

function BestModelTrainingConfig({ step, onUpdate, modelName }: BestModelTrainingConfigProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for neural network models
  const isNeuralNetwork = useMemo(
    () => NEURAL_NETWORK_MODELS.some(m => modelName.toLowerCase().includes(m.toLowerCase())),
    [modelName]
  );

  // Get current training config
  const trainingConfig = step.trainingConfig ?? { epochs: 100, batch_size: 32 };

  // Get used parameter names
  const usedParams = useMemo(() => {
    const params = new Set<string>();
    if (trainingConfig.epochs !== undefined) params.add("epochs");
    if (trainingConfig.batch_size !== undefined) params.add("batch_size");
    if (trainingConfig.learning_rate !== undefined) params.add("learning_rate");
    if (trainingConfig.patience !== undefined) params.add("patience");
    if (trainingConfig.verbose !== undefined) params.add("verbose");
    return params;
  }, [trainingConfig]);

  const unusedPresets = useMemo(
    () => STATIC_TRAIN_PARAM_PRESETS.filter(p => !usedParams.has(p.name)),
    [usedParams]
  );

  const handleUpdateTrainingConfig = useCallback(
    (key: string, value: number | undefined) => {
      const newConfig = { ...trainingConfig, [key]: value };
      // Remove undefined values
      Object.keys(newConfig).forEach(k => {
        if (newConfig[k as keyof typeof newConfig] === undefined) {
          delete newConfig[k as keyof typeof newConfig];
        }
      });
      onUpdate({ trainingConfig: newConfig });
    },
    [trainingConfig, onUpdate]
  );

  const handleAddParam = (preset: typeof STATIC_TRAIN_PARAM_PRESETS[0]) => {
    handleUpdateTrainingConfig(preset.name, preset.default);
    setShowAddPopover(false);
  };

  const handleRemoveParam = (paramName: string) => {
    handleUpdateTrainingConfig(paramName, undefined);
  };

  // Don't render if not a neural network model
  if (!isNeuralNetwork) return null;

  // Check if there are any params set
  const hasParams = usedParams.size > 0;

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-500" />
            Best Model Training
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fixed training params for final model (after tuning)
          </p>
        </div>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
              disabled={unusedPresets.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Training Param
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Best Model Training</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Fixed params for final training
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-1">
                {unusedPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleAddParam(preset)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{preset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        default: {preset.default}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                  </button>
                ))}
                {unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All training parameters added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {!hasParams ? (
        <div className="text-center py-4 rounded-lg border border-dashed border-emerald-500/30">
          <p className="text-sm text-muted-foreground">No fixed training parameters</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add epochs, batch_size, etc. for final model training
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(usedParams).map((paramName) => {
            const preset = STATIC_TRAIN_PARAM_PRESETS.find(p => p.name === paramName);
            const value = trainingConfig[paramName as keyof typeof trainingConfig];
            return (
              <div
                key={paramName}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5"
              >
                <Hash className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Label className="text-sm font-medium">{paramName}</Label>
                  {preset && (
                    <p className="text-xs text-muted-foreground">{preset.description}</p>
                  )}
                </div>
                <Input
                  type="number"
                  value={value ?? ""}
                  onChange={(e) => handleUpdateTrainingConfig(paramName, parseFloat(e.target.value) || 0)}
                  className="w-24 h-8 text-xs font-mono"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveParam(paramName)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
        <Lightbulb className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p>
            These are <strong>fixed</strong> training parameters used when training the final best model
            after Optuna finds optimal hyperparameters. Use more epochs here than during tuning
            for better convergence.
          </p>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// FinetuneTab - Main tab content for model step finetuning
// =============================================================================

interface FinetuneTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

export function FinetuneTab({ step, onUpdate }: FinetuneTabProps) {
  // Initialize or get existing config
  const config = step.finetuneConfig ?? defaultFinetuneConfig;

  // Get available parameters from step params
  const availableParams = useMemo(
    () => Object.keys(step.params).filter((p) => typeof step.params[p] === "number"),
    [step.params]
  );

  // Update config
  const handleConfigUpdate = useCallback(
    (updates: Partial<FinetuneConfig>) => {
      onUpdate({
        finetuneConfig: { ...config, ...updates },
      });
    },
    [config, onUpdate]
  );

  // Toggle enabled
  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (enabled && (!config.model_params || config.model_params.length === 0)) {
        // Auto-add first numeric param when enabling
        const firstParam = availableParams[0];
        const presets = getPresetsForModel(step.name);
        const matchingPreset = presets.find((p) =>
          availableParams.includes(p.name)
        );

        onUpdate({
          finetuneConfig: {
            ...config,
            enabled: true,
            model_params: matchingPreset
              ? [
                  {
                    name: matchingPreset.name,
                    type: matchingPreset.type,
                    low: matchingPreset.low,
                    high: matchingPreset.high,
                    step: matchingPreset.step,
                    choices: matchingPreset.choices,
                  },
                ]
              : firstParam
              ? [{ name: firstParam, type: "int", low: 1, high: 10 }]
              : [],
          },
        });
      } else {
        handleConfigUpdate({ enabled });
      }
    },
    [config, onUpdate, handleConfigUpdate, availableParams, step.name]
  );

  // Update params
  const handleParamsUpdate = useCallback(
    (params: FinetuneParamConfig[]) => {
      handleConfigUpdate({ model_params: params });
    },
    [handleConfigUpdate]
  );

  return (
    <div className="space-y-6 p-4">
      {/* Enable toggle */}
      <FinetuneEnableToggle
        enabled={config.enabled}
        onToggle={handleToggle}
        paramCount={config.model_params?.length ?? 0}
      />

      {/* Configuration (only shown when enabled) */}
      {config.enabled && (
        <>
          <Separator />

          {/* Search configuration */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Search Configuration
            </Label>
            <FinetuneSearchConfig config={config} onUpdate={handleConfigUpdate} />
          </div>

          <Separator />

          {/* Parameters to optimize */}
          <FinetuneParamList
            params={config.model_params ?? []}
            onUpdate={handleParamsUpdate}
            modelName={step.name}
            availableParams={availableParams}
          />

          {/* Training Parameters (for neural network models) */}
          <TrainParamsList
            params={config.train_params ?? []}
            onUpdate={(params) => handleConfigUpdate({ train_params: params })}
            modelName={step.name}
          />

          {/* Best Model Training Parameters (static, for final training after tuning) */}
          <BestModelTrainingConfig
            step={step}
            onUpdate={onUpdate}
            modelName={step.name}
          />

          {/* Summary */}
          {((config.model_params && config.model_params.length > 0) || (config.train_params && config.train_params.length > 0)) && (
            <>
              <Separator />
              <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <Sparkles className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    Optuna will explore {config.n_trials} configurations
                  </p>
                  {config.model_params && config.model_params.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Model params ({config.model_params.length}):
                      {" "}
                      {config.model_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                  {config.train_params && config.train_params.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Training params ({config.train_params.length}):
                      {" "}
                      {config.train_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// =============================================================================
// FinetuningBadge - Visual indicator for finetuning status
// =============================================================================

interface FinetuningBadgeProps {
  config: FinetuneConfig | undefined;
  onClick?: () => void;
  className?: string;
}

export function FinetuningBadge({
  config,
  onClick,
  className,
}: FinetuningBadgeProps) {
  if (!config?.enabled) return null;

  return (
    <Badge
      variant="secondary"
      onClick={onClick}
      className={cn(
        "text-xs bg-purple-500/20 text-purple-600 cursor-pointer hover:bg-purple-500/30 transition-colors gap-1",
        className
      )}
    >
      <Sparkles className="h-3 w-3" />
      {config.n_trials} trials
    </Badge>
  );
}

// =============================================================================
// QuickFinetuneButton - Quick action to enable finetuning
// =============================================================================

interface QuickFinetuneButtonProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  onOpenTab?: () => void;
  className?: string;
}

export function QuickFinetuneButton({
  step,
  onUpdate,
  onOpenTab,
  className,
}: QuickFinetuneButtonProps) {
  const hasFinetuning = step.finetuneConfig?.enabled;

  // Get available parameters from step params
  const availableParams = Object.keys(step.params).filter(
    (p) => typeof step.params[p] === "number"
  );

  const handleQuickEnable = () => {
    if (hasFinetuning) {
      onOpenTab?.();
      return;
    }

    // Quick-enable with smart defaults
    const presets = getPresetsForModel(step.name);
    const matchingPresets = presets.filter((p) =>
      availableParams.includes(p.name)
    );

    onUpdate({
      finetuneConfig: {
        enabled: true,
        n_trials: 50,
        approach: "grouped",
        eval_mode: "best",
        model_params: matchingPresets.slice(0, 2).map((p) => ({
          name: p.name,
          type: p.type,
          low: p.low,
          high: p.high,
          step: p.step,
          choices: p.choices,
        })),
      },
    });

    onOpenTab?.();
  };

  if (availableParams.length === 0) {
    return null;
  }

  return (
    <Button
      variant={hasFinetuning ? "default" : "ghost"}
      size="sm"
      onClick={handleQuickEnable}
      className={cn(
        "h-7 px-2 text-xs gap-1.5 transition-all",
        hasFinetuning
          ? "bg-purple-500 hover:bg-purple-600 text-white"
          : "hover:bg-purple-500/10 hover:text-purple-500",
        className
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {hasFinetuning ? "Finetuning" : "Enable Finetuning"}
    </Button>
  );
}

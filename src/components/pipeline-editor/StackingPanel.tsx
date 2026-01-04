/**
 * MetaModel / Stacking Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides UI for configuring stacking ensembles (MetaModel) that use
 * out-of-fold predictions from base models as features.
 *
 * Key features:
 * - Visual stacking flow diagram
 * - Base model source selection
 * - Meta-model algorithm selection
 * - Coverage strategy configuration
 * - Integration with branch/merge workflow
 */

import { useState, useMemo } from "react";
import {
  Layers,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  GitBranch,
  GitMerge,
  ArrowDown,
  ArrowRight,
  Target,
  Settings,
  Sparkles,
  Check,
  AlertTriangle,
  Lightbulb,
  Network,
  Combine,
  Boxes,
  Puzzle,
  RotateCcw,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { stepOptions, stepColors, type PipelineStep } from "./types";

// MetaModel / Stacking configuration
export interface StackingConfig {
  enabled: boolean;
  metaModel: string;
  metaModelParams: Record<string, string | number | boolean>;
  sourceModels: string[]; // IDs of source model steps (empty = all)
  coverageStrategy: "drop" | "fill" | "model"; // How to handle missing OOF predictions
  fillValue?: number; // For 'fill' strategy
  useOriginalFeatures: boolean; // Include original X features alongside OOF predictions
  passthrough: boolean; // Pass original features to meta-model
}

// Default configuration
export function defaultStackingConfig(): StackingConfig {
  return {
    enabled: false,
    metaModel: "Ridge",
    metaModelParams: { alpha: 1.0 },
    sourceModels: [],
    coverageStrategy: "drop",
    useOriginalFeatures: false,
    passthrough: false,
  };
}

// Helper to safely get default params as Record<string, string | number | boolean>
function getMetaModelDefaultParams(option: typeof META_MODEL_OPTIONS[number] | undefined): Record<string, string | number | boolean> {
  if (!option) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(option.defaultParams)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// Available meta-model options
const META_MODEL_OPTIONS = [
  {
    name: "Ridge",
    description: "Ridge regression - simple and effective",
    category: "Linear",
    defaultParams: { alpha: 1.0 },
    icon: "📈",
  },
  {
    name: "Lasso",
    description: "Lasso - sparse feature selection",
    category: "Linear",
    defaultParams: { alpha: 1.0 },
    icon: "🎯",
  },
  {
    name: "ElasticNet",
    description: "Elastic Net - balanced regularization",
    category: "Linear",
    defaultParams: { alpha: 1.0, l1_ratio: 0.5 },
    icon: "⚖️",
  },
  {
    name: "PLSRegression",
    description: "PLS - latent variable projection",
    category: "PLS",
    defaultParams: { n_components: 3 },
    icon: "🔄",
  },
  {
    name: "RandomForestRegressor",
    description: "Random Forest - non-linear ensemble",
    category: "Ensemble",
    defaultParams: { n_estimators: 50, max_depth: 5 },
    icon: "🌲",
  },
  {
    name: "XGBoost",
    description: "XGBoost - gradient boosting",
    category: "Ensemble",
    defaultParams: { n_estimators: 50, learning_rate: 0.1, max_depth: 3 },
    icon: "🚀",
  },
  {
    name: "SVR",
    description: "Support Vector Regression",
    category: "SVM",
    defaultParams: { kernel: "rbf", C: 1.0 },
    icon: "📊",
  },
];

// Coverage strategy descriptions
const COVERAGE_STRATEGIES = {
  drop: {
    label: "Drop Samples",
    description: "Remove samples without complete OOF predictions",
    icon: EyeOff,
  },
  fill: {
    label: "Fill with Value",
    description: "Replace missing predictions with a constant value",
    icon: Puzzle,
  },
  model: {
    label: "Model Prediction",
    description: "Use fitted model to fill missing predictions",
    icon: Target,
  },
};

interface StackingPanelProps {
  config: StackingConfig;
  onChange: (config: StackingConfig) => void;
  availableModels?: { id: string; name: string; type: string }[];
  className?: string;
}

/**
 * StackingPanel - Main panel for configuring stacking ensembles
 */
export function StackingPanel({
  config,
  onChange,
  availableModels = [],
  className,
}: StackingPanelProps) {
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

  const selectedMetaModel = useMemo(
    () => META_MODEL_OPTIONS.find((m) => m.name === config.metaModel),
    [config.metaModel]
  );

  const handleToggle = (enabled: boolean) => {
    onChange({ ...config, enabled });
  };

  const handleMetaModelChange = (name: string) => {
    const model = META_MODEL_OPTIONS.find((m) => m.name === name);
    onChange({
      ...config,
      metaModel: name,
      metaModelParams: getMetaModelDefaultParams(model),
    });
  };

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onChange({
      ...config,
      metaModelParams: { ...config.metaModelParams, [key]: value },
    });
  };

  const handleSourceToggle = (id: string, checked: boolean) => {
    if (checked) {
      onChange({
        ...config,
        sourceModels: [...config.sourceModels, id],
      });
    } else {
      onChange({
        ...config,
        sourceModels: config.sourceModels.filter((s) => s !== id),
      });
    }
  };

  const handleUseAllSources = () => {
    onChange({ ...config, sourceModels: [] });
  };

  const isUsingAllSources = config.sourceModels.length === 0;
  const selectedSourceCount = isUsingAllSources
    ? availableModels.length
    : config.sourceModels.length;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg transition-colors",
              config.enabled
                ? "bg-pink-500/20 text-pink-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              Stacking Ensemble
              {config.enabled && (
                <Badge className="text-[10px] px-1.5 h-4 bg-pink-500">
                  MetaModel
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Combine models using out-of-fold predictions
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={handleToggle}
          className="data-[state=checked]:bg-pink-500"
        />
      </div>

      {/* Content - show when enabled */}
      {config.enabled && (
        <div className="space-y-4 pl-2 border-l-2 border-pink-500/30">
          {/* Visual Stacking Diagram */}
          <StackingDiagram
            sourceCount={selectedSourceCount}
            metaModel={config.metaModel}
            passthrough={config.passthrough}
          />

          <Separator />

          {/* Source Models Selection */}
          {availableModels.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Base Models</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleUseAllSources}
                  disabled={isUsingAllSources}
                >
                  Use All
                </Button>
              </div>

              <div className="space-y-2">
                {availableModels.map((model) => {
                  const isSelected =
                    isUsingAllSources || config.sourceModels.includes(model.id);
                  return (
                    <label
                      key={model.id}
                      className={cn(
                        "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all",
                        isSelected
                          ? "border-pink-500/50 bg-pink-500/5"
                          : "border-border hover:border-pink-500/30"
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          handleSourceToggle(model.id, checked as boolean)
                        }
                        disabled={isUsingAllSources}
                        className="data-[state=checked]:bg-pink-500 data-[state=checked]:border-pink-500"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Target className="h-3.5 w-3.5 text-emerald-500" />
                          <span className="text-sm font-medium truncate">
                            {model.name}
                          </span>
                          <Badge variant="secondary" className="text-[10px] px-1 h-4">
                            {model.type}
                          </Badge>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>

              {availableModels.length === 0 && (
                <div className="text-center py-4 border border-dashed rounded-lg">
                  <Network className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No base models available
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Add model steps in parallel branches first
                  </p>
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* Meta-Model Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Meta-Model</Label>
            <Select value={config.metaModel} onValueChange={handleMetaModelChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-[300px]">
                {["Linear", "PLS", "Ensemble", "SVM"].map((category) => (
                  <SelectGroup key={category}>
                    <SelectLabel>{category}</SelectLabel>
                    {META_MODEL_OPTIONS.filter((m) => m.category === category).map(
                      (model) => (
                        <SelectItem key={model.name} value={model.name}>
                          <div className="flex items-center gap-2">
                            <span>{model.icon}</span>
                            <div className="flex flex-col">
                              <span className="font-medium">{model.name}</span>
                              <span className="text-xs text-muted-foreground">
                                {model.description}
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      )
                    )}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            {selectedMetaModel && (
              <p className="text-xs text-muted-foreground">
                {selectedMetaModel.description}
              </p>
            )}
          </div>

          {/* Meta-Model Parameters */}
          {selectedMetaModel && Object.keys(getMetaModelDefaultParams(selectedMetaModel)).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Parameters</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() =>
                    onChange({
                      ...config,
                      metaModelParams: getMetaModelDefaultParams(selectedMetaModel),
                    })
                  }
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              {Object.entries(getMetaModelDefaultParams(selectedMetaModel)).map(([key, defaultValue]) => (
                <div key={key} className="flex items-center gap-3">
                  <Label className="text-xs w-24 capitalize text-muted-foreground">
                    {key.replace(/_/g, " ")}
                  </Label>
                  {key === "kernel" ? (
                    <Select
                      value={String(config.metaModelParams[key] ?? defaultValue)}
                      onValueChange={(v: string) => handleParamChange(key, v)}
                    >
                      <SelectTrigger className="h-8 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-popover">
                        <SelectItem value="rbf">RBF</SelectItem>
                        <SelectItem value="linear">Linear</SelectItem>
                        <SelectItem value="poly">Polynomial</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      type={typeof defaultValue === "number" ? "number" : "text"}
                      value={typeof config.metaModelParams[key] === "boolean"
                        ? String(config.metaModelParams[key])
                        : (config.metaModelParams[key] ?? defaultValue)}
                      onChange={(e) => {
                        const val =
                          typeof defaultValue === "number"
                            ? parseFloat(e.target.value) || 0
                            : e.target.value;
                        handleParamChange(key, val);
                      }}
                      step={typeof defaultValue === "number" && defaultValue < 1 ? 0.1 : 1}
                      className="h-8 font-mono text-sm flex-1"
                    />
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Advanced Options */}
          <Collapsible open={isAdvancedOpen} onOpenChange={setIsAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" className="w-full justify-between h-8 px-2">
                <span className="text-xs text-muted-foreground">Advanced Options</span>
                {isAdvancedOpen ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-2">
              {/* Coverage Strategy */}
              <div className="space-y-2">
                <Label className="text-xs font-medium text-muted-foreground">
                  Coverage Strategy
                </Label>
                <RadioGroup
                  value={config.coverageStrategy}
                  onValueChange={(v) =>
                    onChange({
                      ...config,
                      coverageStrategy: v as StackingConfig["coverageStrategy"],
                    })
                  }
                  className="space-y-1"
                >
                  {(Object.entries(COVERAGE_STRATEGIES) as [
                    StackingConfig["coverageStrategy"],
                    typeof COVERAGE_STRATEGIES.drop
                  ][]).map(([strategy, desc]) => {
                    const Icon = desc.icon;
                    return (
                      <label
                        key={strategy}
                        className="flex items-center gap-2 p-2 rounded border border-border hover:border-pink-500/30 cursor-pointer"
                      >
                        <RadioGroupItem
                          value={strategy}
                          className="data-[state=checked]:border-pink-500 data-[state=checked]:text-pink-500"
                        />
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        <div className="flex-1">
                          <div className="text-xs font-medium">{desc.label}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {desc.description}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </RadioGroup>

                {config.coverageStrategy === "fill" && (
                  <div className="flex items-center gap-2 pl-6">
                    <Label className="text-xs">Fill Value:</Label>
                    <Input
                      type="number"
                      value={config.fillValue ?? 0}
                      onChange={(e) =>
                        onChange({
                          ...config,
                          fillValue: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="h-7 w-24 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Feature Passthrough */}
              <div className="flex items-center justify-between p-2 rounded border border-border">
                <div className="flex items-center gap-2">
                  <Combine className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label className="text-xs font-medium">Feature Passthrough</Label>
                    <p className="text-[10px] text-muted-foreground">
                      Include original X features with OOF predictions
                    </p>
                  </div>
                </div>
                <Switch
                  checked={config.passthrough}
                  onCheckedChange={(checked) =>
                    onChange({ ...config, passthrough: checked })
                  }
                  className="scale-90"
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Info note */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-pink-500/5 border border-pink-500/20">
            <Lightbulb className="h-4 w-4 text-pink-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p className="font-medium text-foreground mb-1">How Stacking Works:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Base models generate out-of-fold (OOF) predictions</li>
                <li>OOF predictions become features for the meta-model</li>
                <li>Meta-model learns to combine base predictions</li>
              </ol>
            </div>
          </div>
        </div>
      )}

      {/* Disabled state info */}
      {!config.enabled && (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-xs">
            Enable to configure a stacking ensemble
          </p>
          <p className="text-[10px] mt-1 text-muted-foreground/70">
            Requires multiple base models in parallel branches
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Visual diagram showing the stacking flow
 */
interface StackingDiagramProps {
  sourceCount: number;
  metaModel: string;
  passthrough: boolean;
}

function StackingDiagram({
  sourceCount,
  metaModel,
  passthrough,
}: StackingDiagramProps) {
  const baseModels = Math.min(sourceCount, 4); // Show max 4 for visual

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border">
      <div className="flex flex-col items-center gap-2">
        {/* Base Models Row */}
        <div className="flex items-center gap-2">
          {Array.from({ length: baseModels }).map((_, i) => (
            <div
              key={i}
              className="flex flex-col items-center gap-1"
            >
              <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
              <span className="text-[10px] text-muted-foreground">
                Model {i + 1}
              </span>
            </div>
          ))}
          {sourceCount > 4 && (
            <div className="flex flex-col items-center gap-1">
              <div className="p-2 rounded-lg bg-muted border border-border">
                <span className="text-xs text-muted-foreground">
                  +{sourceCount - 4}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Arrows */}
        <div className="flex items-center gap-2">
          {Array.from({ length: Math.min(sourceCount, 4) }).map((_, i) => (
            <ArrowDown key={i} className="h-4 w-4 text-muted-foreground" />
          ))}
        </div>

        {/* OOF Predictions */}
        <div className="flex items-center gap-2 py-1 px-3 rounded-full bg-muted border border-border">
          <Combine className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs">OOF Predictions</span>
          {passthrough && (
            <>
              <span className="text-muted-foreground">+</span>
              <span className="text-xs">X</span>
            </>
          )}
        </div>

        {/* Arrow */}
        <ArrowDown className="h-4 w-4 text-muted-foreground" />

        {/* Meta Model */}
        <div className="flex flex-col items-center gap-1">
          <div className="p-2 rounded-lg bg-pink-500/20 border border-pink-500/30">
            <Boxes className="h-4 w-4 text-pink-500" />
          </div>
          <span className="text-xs font-medium text-pink-500">{metaModel}</span>
          <Badge variant="secondary" className="text-[10px] px-1 h-4">
            Meta-Model
          </Badge>
        </div>
      </div>
    </div>
  );
}

/**
 * Stacking Badge for pipeline tree
 */
interface StackingBadgeProps {
  config: StackingConfig;
  onClick?: () => void;
  className?: string;
}

export function StackingBadge({
  config,
  onClick,
  className,
}: StackingBadgeProps) {
  if (!config.enabled) return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-pink-500 hover:bg-pink-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <Boxes className="h-3 w-3" />
          {config.metaModel}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Stacking Ensemble</div>
          <p className="text-muted-foreground">
            Meta-model: {config.metaModel}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Compact stacking setup for merge step configuration
 */
interface MergeStackingSetupProps {
  config: StackingConfig;
  onChange: (config: StackingConfig) => void;
  availableModels?: { id: string; name: string; type: string }[];
}

export function MergeStackingSetup({
  config,
  onChange,
  availableModels = [],
}: MergeStackingSetupProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-pink-500 hover:bg-pink-600"
          )}
        >
          <Boxes className="h-3.5 w-3.5" />
          <span>Configure Stacking</span>
          {config.enabled && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {config.metaModel}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <StackingPanel
          config={config}
          onChange={onChange}
          availableModels={availableModels}
        />
      </PopoverContent>
    </Popover>
  );
}

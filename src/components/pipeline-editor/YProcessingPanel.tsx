/**
 * Y-Processing Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides a dedicated UI for configuring target variable (Y) processing,
 * including scaling, transformation, and discretization options.
 *
 * Key features:
 * - Enable/disable toggle with visual feedback
 * - Scaler/transformer selection with descriptions
 * - Parameter configuration per scaler type
 * - Contextual help and recommendations
 * - Integration with pipeline tree visualization
 */

import { useState, useMemo } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  Check,
  AlertTriangle,
  Lightbulb,
  Settings2,
  RotateCcw,
  X,
  ArrowRightLeft,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Y-Processing configuration interface
export interface YProcessingConfig {
  enabled: boolean;
  scaler: string;
  params: Record<string, string | number | boolean>;
}

// Available scalers for y_processing
export const Y_PROCESSING_OPTIONS = [
  {
    name: "MinMaxScaler",
    description: "Scale target to [0,1] range",
    category: "Scaling",
    defaultParams: { feature_range_min: 0, feature_range_max: 1 },
    paramDescriptions: {
      feature_range_min: "Minimum value after scaling",
      feature_range_max: "Maximum value after scaling",
    },
    recommendations: ["Neural networks", "When Y varies significantly"],
    icon: "📊",
  },
  {
    name: "StandardScaler",
    description: "Standardize to zero mean, unit variance",
    category: "Scaling",
    defaultParams: {},
    paramDescriptions: {},
    recommendations: ["Most regression models", "Default choice"],
    icon: "📈",
  },
  {
    name: "RobustScaler",
    description: "Robust scaling using median and IQR",
    category: "Scaling",
    defaultParams: {},
    paramDescriptions: {},
    recommendations: ["Data with outliers", "Robust preprocessing chains"],
    icon: "🛡️",
  },
  {
    name: "PowerTransformer",
    description: "Apply power transformation (Yeo-Johnson)",
    category: "Transform",
    defaultParams: { method: "yeo-johnson" },
    paramDescriptions: {
      method: "Transformation method (yeo-johnson works with negative values)",
    },
    recommendations: ["Skewed distributions", "Making data more Gaussian"],
    icon: "⚡",
  },
  {
    name: "QuantileTransformer",
    description: "Transform to uniform or normal distribution",
    category: "Transform",
    defaultParams: { output_distribution: "uniform", n_quantiles: 1000 },
    paramDescriptions: {
      output_distribution: "Target distribution (uniform or normal)",
      n_quantiles: "Number of quantiles to compute",
    },
    recommendations: ["Non-linear relationships", "Complex distributions"],
    icon: "🔔",
  },
  {
    name: "IntegerKBinsDiscretizer",
    description: "Discretize continuous Y into bins",
    category: "Discretization",
    defaultParams: { n_bins: 5, strategy: "quantile" },
    paramDescriptions: {
      n_bins: "Number of bins to create",
      strategy: "Binning strategy (uniform, quantile, kmeans)",
    },
    recommendations: ["Converting regression to classification", "Ordinal targets"],
    icon: "📦",
  },
  {
    name: "RangeDiscretizer",
    description: "Custom range-based discretization",
    category: "Discretization",
    defaultParams: { ranges: "0,10,20,30" },
    paramDescriptions: {
      ranges: "Comma-separated range boundaries",
    },
    recommendations: ["Domain-specific thresholds", "Custom class definitions"],
    icon: "🎯",
  },
];

// Default configuration
export function defaultYProcessingConfig(): YProcessingConfig {
  return {
    enabled: false,
    scaler: "MinMaxScaler",
    params: { feature_range_min: 0, feature_range_max: 1 },
  };
}

// Helper to safely get default params as Record<string, string | number | boolean>
function getDefaultParams(option: typeof Y_PROCESSING_OPTIONS[number] | undefined): Record<string, string | number | boolean> {
  if (!option) return {};
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(option.defaultParams)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

// Helper to safely get param description
function getParamDescription(option: typeof Y_PROCESSING_OPTIONS[number] | undefined, key: string): string | undefined {
  if (!option) return undefined;
  return (option.paramDescriptions as Record<string, string>)[key];
}

interface YProcessingPanelProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  className?: string;
  compact?: boolean;
}

/**
 * YProcessingPanel - Main panel for configuring target variable processing
 */
export function YProcessingPanel({
  config,
  onChange,
  className,
  compact = false,
}: YProcessingPanelProps) {
  const [isExpanded, setIsExpanded] = useState(!compact);

  const selectedOption = useMemo(
    () => Y_PROCESSING_OPTIONS.find((opt) => opt.name === config.scaler),
    [config.scaler]
  );

  const handleToggle = (enabled: boolean) => {
    onChange({ ...config, enabled });
  };

  const handleScalerChange = (scaler: string) => {
    const option = Y_PROCESSING_OPTIONS.find((opt) => opt.name === scaler);
    onChange({
      ...config,
      scaler,
      params: getDefaultParams(option),
    });
  };

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onChange({
      ...config,
      params: { ...config.params, [key]: value },
    });
  };

  const handleReset = () => {
    if (selectedOption) {
      onChange({
        ...config,
        params: getDefaultParams(selectedOption),
      });
    }
  };

  if (compact) {
    return (
      <YProcessingCompact
        config={config}
        onChange={onChange}
        className={className}
      />
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "p-2 rounded-lg transition-colors",
              config.enabled
                ? "bg-amber-500/20 text-amber-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            <BarChart3 className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              Target Processing
              {config.enabled && (
                <Badge className="text-[10px] px-1.5 h-4 bg-amber-500">
                  Active
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Scale or transform your target variable
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={handleToggle}
          className="data-[state=checked]:bg-amber-500"
        />
      </div>

      {/* Content - show when enabled */}
      {config.enabled && (
        <div className="space-y-4 pl-2 border-l-2 border-amber-500/30">
          {/* Scaler Selection */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Scaler / Transformer</Label>
            <Select value={config.scaler} onValueChange={handleScalerChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-[300px]">
                {/* Group by category */}
                {["Scaling", "Transform", "Discretization"].map((category) => (
                  <div key={category}>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                      {category}
                    </div>
                    {Y_PROCESSING_OPTIONS.filter(
                      (opt) => opt.category === category
                    ).map((opt) => (
                      <SelectItem key={opt.name} value={opt.name}>
                        <div className="flex items-center gap-2">
                          <span>{opt.icon}</span>
                          <div className="flex flex-col">
                            <span className="font-medium">{opt.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {opt.description}
                            </span>
                          </div>
                        </div>
                      </SelectItem>
                    ))}
                  </div>
                ))}
              </SelectContent>
            </Select>
            {selectedOption && (
              <p className="text-xs text-muted-foreground">
                {selectedOption.description}
              </p>
            )}
          </div>

          {/* Parameters */}
          {selectedOption && Object.keys(getDefaultParams(selectedOption)).length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Parameters</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={handleReset}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              {Object.entries(getDefaultParams(selectedOption)).map(([key, defaultValue]) => (
                <YProcessingParamInput
                  key={key}
                  paramKey={key}
                  value={config.params[key] ?? defaultValue}
                  defaultValue={defaultValue}
                  description={getParamDescription(selectedOption, key)}
                  onChange={(value) => handleParamChange(key, value)}
                />
              ))}
            </div>
          )}

          {/* Recommendations */}
          {selectedOption && selectedOption.recommendations.length > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
              <Lightbulb className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs font-medium text-foreground mb-1">
                  Recommended for:
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {selectedOption.recommendations.map((rec, idx) => (
                    <li key={idx} className="flex items-center gap-1">
                      <Check className="h-3 w-3 text-amber-500" />
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Info note */}
          <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
            <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Target values will be scaled before training. Predictions are
              automatically inverse-transformed to the original scale.
            </p>
          </div>
        </div>
      )}

      {/* Disabled state info */}
      {!config.enabled && (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-xs">
            Enable to configure target variable scaling or transformation
          </p>
          <p className="text-[10px] mt-1 text-muted-foreground/70">
            Recommended for neural networks or when Y has extreme values
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Compact version of YProcessingPanel for inline use
 */
interface YProcessingCompactProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  className?: string;
}

export function YProcessingCompact({
  config,
  onChange,
  className,
}: YProcessingCompactProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-amber-500 hover:bg-amber-600",
            className
          )}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          <span>y_processing</span>
          {config.enabled && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {config.scaler}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <YProcessingPanel config={config} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Parameter input component for y_processing params
 */
interface YProcessingParamInputProps {
  paramKey: string;
  value: string | number | boolean;
  defaultValue: string | number | boolean;
  description?: string;
  onChange: (value: string | number | boolean) => void;
}

function YProcessingParamInput({
  paramKey,
  value,
  defaultValue,
  description,
  onChange,
}: YProcessingParamInputProps) {
  // Render appropriate input based on param type and known patterns
  if (paramKey === "method") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs capitalize">{paramKey.replace(/_/g, " ")}</Label>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[200px]">
                <p>{description}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="yeo-johnson">Yeo-Johnson</SelectItem>
            <SelectItem value="box-cox">Box-Cox (positive only)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (paramKey === "output_distribution") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs capitalize">{paramKey.replace(/_/g, " ")}</Label>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[200px]">
                <p>{description}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="uniform">Uniform [0, 1]</SelectItem>
            <SelectItem value="normal">Normal (Gaussian)</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (paramKey === "strategy") {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <Label className="text-xs capitalize">{paramKey.replace(/_/g, " ")}</Label>
          {description && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3 w-3 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[200px]">
                <p>{description}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        <Select value={String(value)} onValueChange={onChange}>
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="quantile">Quantile (equal frequencies)</SelectItem>
            <SelectItem value="uniform">Uniform (equal width)</SelectItem>
            <SelectItem value="kmeans">K-Means clustering</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  }

  // Default: number or text input
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-xs capitalize">{paramKey.replace(/_/g, " ")}</Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3 w-3 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[200px]">
              <p>{description}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <Input
        type={typeof defaultValue === "number" ? "number" : "text"}
        value={typeof value === "boolean" ? String(value) : value}
        onChange={(e) => {
          const newValue =
            typeof defaultValue === "number"
              ? parseFloat(e.target.value) || 0
              : e.target.value;
          onChange(newValue);
        }}
        step={typeof defaultValue === "number" && defaultValue < 1 ? 0.01 : 1}
        className="h-8 font-mono text-sm"
      />
    </div>
  );
}

/**
 * Y-Processing Step Badge for display in pipeline tree
 */
interface YProcessingBadgeProps {
  config: YProcessingConfig;
  onClick?: () => void;
  className?: string;
}

export function YProcessingBadge({
  config,
  onClick,
  className,
}: YProcessingBadgeProps) {
  if (!config.enabled) return null;

  const option = Y_PROCESSING_OPTIONS.find((opt) => opt.name === config.scaler);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-amber-500 hover:bg-amber-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <BarChart3 className="h-3 w-3" />
          {config.scaler}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Target Processing</div>
          <p className="text-muted-foreground">
            {option?.description || config.scaler}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Y-Processing Quick Setup Button
 */
interface YProcessingQuickSetupProps {
  config: YProcessingConfig;
  onChange: (config: YProcessingConfig) => void;
  modelType?: string;
}

export function YProcessingQuickSetup({
  config,
  onChange,
  modelType,
}: YProcessingQuickSetupProps) {
  const getRecommendedScaler = () => {
    if (!modelType) return "MinMaxScaler";

    const dlModels = ["nicon", "CNN1D", "MLP", "LSTM", "Transformer"];
    if (dlModels.includes(modelType)) return "MinMaxScaler";

    return "StandardScaler";
  };

  const handleQuickSetup = () => {
    const scaler = getRecommendedScaler();
    const option = Y_PROCESSING_OPTIONS.find((opt) => opt.name === scaler);
    onChange({
      enabled: true,
      scaler,
      params: getDefaultParams(option),
    });
  };

  if (config.enabled) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 text-xs border-amber-500/50 text-amber-600 hover:bg-amber-500/10"
      onClick={handleQuickSetup}
    >
      <BarChart3 className="h-3 w-3 mr-1.5" />
      Enable y_processing
    </Button>
  );
}

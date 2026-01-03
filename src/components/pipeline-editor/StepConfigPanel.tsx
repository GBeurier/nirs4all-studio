import { useState } from "react";
import {
  Waves,
  Shuffle,
  Target,
  GitBranch,
  GitMerge,
  Trash2,
  Copy,
  Info,
  RotateCcw,
  Repeat,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  stepOptions,
  stepColors,
  type PipelineStep,
  type StepType,
  type ParameterSweep,
  type SweepType,
  calculateSweepVariants,
  calculateStepVariants,
} from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
};

// Parameter info/tooltips for common parameters
const parameterInfo: Record<string, string> = {
  n_components: "Number of components/latent variables to use",
  n_estimators: "Number of trees in the ensemble",
  max_depth: "Maximum depth of trees",
  learning_rate: "Step size for gradient descent optimization",
  test_size: "Proportion of data to use for testing (0.0-1.0)",
  n_splits: "Number of folds for cross-validation",
  window: "Size of the moving window (must be odd)",
  polyorder: "Polynomial order for fitting",
  deriv: "Derivative order (0=smoothing, 1=first, 2=second)",
  sigma: "Standard deviation for Gaussian kernel",
  C: "Regularization parameter (higher = less regularization)",
  epsilon: "Epsilon in epsilon-SVR model",
  kernel: "Kernel type for SVM (rbf, linear, poly)",
  alpha: "Regularization strength",
  l1_ratio: "L1 ratio for Elastic Net (0=L2, 1=L1)",
  shuffle: "Whether to shuffle data before splitting",
  random_state: "Random seed for reproducibility",
  order: "Polynomial order for detrending",
  norm: "Normalization type (l1, l2, max)",
  reference: "Reference spectrum for MSC (mean, first, median)",
  layers: "Number of hidden layers",
  filters: "Number of convolutional filters",
  kernel_size: "Size of convolution kernel",
  dropout: "Dropout rate for regularization",
  hidden_layers: "Comma-separated list of hidden layer sizes",
  activation: "Activation function (relu, tanh, sigmoid)",
  units: "Number of LSTM units",
  n_repeats: "Number of times to repeat cross-validation",
  normalization: "Normalization method (range, std, mean)",
};

// Sweep type labels
const sweepTypeLabels: Record<SweepType, string> = {
  range: "Range",
  log_range: "Log Range",
  or: "Choices",
  grid: "Grid",
};

// Component for sweep configuration
interface SweepConfigProps {
  paramKey: string;
  currentValue: string | number | boolean;
  sweep: ParameterSweep | undefined;
  onSweepChange: (sweep: ParameterSweep | undefined) => void;
}

function SweepConfig({ paramKey, currentValue, sweep, onSweepChange }: SweepConfigProps) {
  const [isOpen, setIsOpen] = useState(!!sweep);
  const isNumeric = typeof currentValue === "number";

  const handleEnableSweep = () => {
    if (!sweep) {
      // Create default sweep based on value type
      if (isNumeric) {
        const val = currentValue as number;
        onSweepChange({
          type: "range",
          from: Math.max(1, Math.floor(val * 0.5)),
          to: Math.ceil(val * 1.5),
          step: val >= 10 ? Math.ceil(val * 0.1) : 1,
        });
      } else {
        onSweepChange({
          type: "or",
          choices: [currentValue],
        });
      }
      setIsOpen(true);
    } else {
      onSweepChange(undefined);
      setIsOpen(false);
    }
  };

  const handleTypeChange = (type: SweepType) => {
    if (type === "range") {
      const val = typeof currentValue === "number" ? currentValue : 10;
      onSweepChange({
        type: "range",
        from: Math.max(1, Math.floor(val * 0.5)),
        to: Math.ceil(val * 1.5),
        step: 1,
      });
    } else if (type === "log_range") {
      const val = typeof currentValue === "number" ? currentValue : 1;
      onSweepChange({
        type: "log_range",
        from: Math.max(0.001, val * 0.1),
        to: val * 10,
        count: 5,
      });
    } else if (type === "or") {
      onSweepChange({
        type: "or",
        choices: [currentValue],
      });
    }
  };

  const variantCount = sweep ? calculateSweepVariants(sweep) : 0;

  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        <Button
          variant={sweep ? "default" : "ghost"}
          size="sm"
          className={`h-6 px-2 text-xs gap-1 ${sweep ? "bg-orange-500 hover:bg-orange-600 text-white" : ""}`}
          onClick={handleEnableSweep}
        >
          <Repeat className="h-3 w-3" />
          {sweep ? `Sweep (${variantCount})` : "Sweep"}
        </Button>
        {sweep && (
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        )}
      </div>

      {sweep && isOpen && (
        <div className="mt-2 p-3 rounded-lg border border-orange-500/30 bg-orange-500/5 space-y-3">
          <div className="flex items-center justify-between">
            <Select value={sweep.type} onValueChange={(v) => handleTypeChange(v as SweepType)}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {isNumeric && <SelectItem value="range">Range</SelectItem>}
                {isNumeric && <SelectItem value="log_range">Log Range</SelectItem>}
                <SelectItem value="or">Choices</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="text-xs bg-orange-500/20 text-orange-600">
              {variantCount} variant{variantCount !== 1 ? "s" : ""}
            </Badge>
          </div>

          {(sweep.type === "range" || sweep.type === "log_range") && (
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input
                  type="number"
                  value={sweep.from ?? 0}
                  onChange={(e) => onSweepChange({ ...sweep, from: parseFloat(e.target.value) || 0 })}
                  className="h-7 text-xs font-mono"
                  step={sweep.type === "log_range" ? 0.001 : 1}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input
                  type="number"
                  value={sweep.to ?? 10}
                  onChange={(e) => onSweepChange({ ...sweep, to: parseFloat(e.target.value) || 10 })}
                  className="h-7 text-xs font-mono"
                  step={sweep.type === "log_range" ? 0.001 : 1}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  {sweep.type === "log_range" ? "Count" : "Step"}
                </Label>
                <Input
                  type="number"
                  value={sweep.type === "log_range" ? (sweep.count ?? 5) : (sweep.step ?? 1)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 1;
                    if (sweep.type === "log_range") {
                      onSweepChange({ ...sweep, count: val });
                    } else {
                      onSweepChange({ ...sweep, step: val });
                    }
                  }}
                  className="h-7 text-xs font-mono"
                  min={1}
                />
              </div>
            </div>
          )}

          {sweep.type === "or" && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Choices (comma-separated)</Label>
              <Input
                value={sweep.choices?.join(", ") ?? ""}
                onChange={(e) => {
                  const choices = e.target.value.split(",").map(s => {
                    const trimmed = s.trim();
                    const num = parseFloat(trimmed);
                    if (!isNaN(num) && isNumeric) return num;
                    if (trimmed === "true") return true;
                    if (trimmed === "false") return false;
                    return trimmed;
                  }).filter(v => v !== "");
                  onSweepChange({ ...sweep, choices });
                }}
                className="h-7 text-xs font-mono"
                placeholder="value1, value2, value3"
              />
            </div>
          )}

          {/* Preview values */}
          <div className="text-xs text-muted-foreground">
            {sweep.type === "range" && sweep.from !== undefined && sweep.to !== undefined && (
              <span>
                Values: {Array.from(
                  { length: Math.min(5, variantCount) },
                  (_, i) => sweep.from! + i * (sweep.step ?? 1)
                ).join(", ")}{variantCount > 5 ? `, ... (${variantCount} total)` : ""}
              </span>
            )}
            {sweep.type === "log_range" && (
              <span>Logarithmically spaced from {sweep.from} to {sweep.to}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface StepConfigPanelProps {
  step: PipelineStep | null;
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function StepConfigPanel({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: StepConfigPanelProps) {
  if (!step) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6 text-center bg-card">
        <div className="p-4 rounded-full bg-muted/50 mb-4">
          <GitBranch className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">No Step Selected</h3>
        <p className="text-sm text-muted-foreground max-w-[200px]">
          Select a step from the canvas or drag one from the palette to
          configure it
        </p>
      </div>
    );
  }

  const Icon = stepIcons[step.type];
  const colors = stepColors[step.type];
  const currentOption = stepOptions[step.type].find((o) => o.name === step.name);

  const handleNameChange = (name: string) => {
    const option = stepOptions[step.type].find((o) => o.name === name);
    if (option) {
      onUpdate(step.id, {
        name,
        params: { ...option.defaultParams },
      });
    }
  };

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onUpdate(step.id, {
      params: { ...step.params, [key]: value },
    });
  };

  const handleResetParams = () => {
    if (currentOption) {
      onUpdate(step.id, {
        params: { ...currentOption.defaultParams },
        paramSweeps: undefined, // Clear sweeps on reset
      });
    }
  };

  const handleSweepChange = (key: string, sweep: ParameterSweep | undefined) => {
    const newSweeps = { ...(step.paramSweeps || {}) };
    if (sweep) {
      newSweeps[key] = sweep;
    } else {
      delete newSweeps[key];
    }
    onUpdate(step.id, {
      paramSweeps: Object.keys(newSweeps).length > 0 ? newSweeps : undefined,
    });
  };

  // Calculate total variants for this step
  const totalVariants = calculateStepVariants(step);
  const hasSweeps = step.paramSweeps && Object.keys(step.paramSweeps).length > 0;

  const renderParamInput = (key: string, value: string | number | boolean) => {
    const info = parameterInfo[key];
    const sweep = step.paramSweeps?.[key];
    const hasSweepActive = !!sweep;

    // Boolean parameters
    if (typeof value === "boolean") {
      return (
        <div key={key} className="space-y-1">
          <div className="flex items-center justify-between py-2">
            <div className="flex items-center gap-2">
              <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
                {key.replace(/_/g, " ")}
              </Label>
              {info && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-[200px]">
                    <p>{info}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              {hasSweepActive && (
                <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
                  sweep
                </Badge>
              )}
            </div>
            <Switch
              checked={value}
              onCheckedChange={(checked) => handleParamChange(key, checked)}
              disabled={hasSweepActive}
            />
          </div>
          <SweepConfig
            paramKey={key}
            currentValue={value}
            sweep={sweep}
            onSweepChange={(s) => handleSweepChange(key, s)}
          />
        </div>
      );
    }

    // Select parameters for known options
    if (key === "kernel") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
              {key.replace(/_/g, " ")}
            </Label>
            {info && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>{info}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {hasSweepActive && (
              <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
                sweep
              </Badge>
            )}
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
            disabled={hasSweepActive}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="rbf">RBF (Radial Basis Function)</SelectItem>
              <SelectItem value="linear">Linear</SelectItem>
              <SelectItem value="poly">Polynomial</SelectItem>
              <SelectItem value="sigmoid">Sigmoid</SelectItem>
            </SelectContent>
          </Select>
          <SweepConfig
            paramKey={key}
            currentValue={value}
            sweep={sweep}
            onSweepChange={(s) => handleSweepChange(key, s)}
          />
        </div>
      );
    }

    if (key === "norm") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
              {key.replace(/_/g, " ")}
            </Label>
            {info && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>{info}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {hasSweepActive && (
              <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
                sweep
              </Badge>
            )}
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
            disabled={hasSweepActive}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="l1">L1 (Manhattan)</SelectItem>
              <SelectItem value="l2">L2 (Euclidean)</SelectItem>
              <SelectItem value="max">Max</SelectItem>
            </SelectContent>
          </Select>
          <SweepConfig
            paramKey={key}
            currentValue={value}
            sweep={sweep}
            onSweepChange={(s) => handleSweepChange(key, s)}
          />
        </div>
      );
    }

    if (key === "activation") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
              {key.replace(/_/g, " ")}
            </Label>
            {info && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>{info}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {hasSweepActive && (
              <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
                sweep
              </Badge>
            )}
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
            disabled={hasSweepActive}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="relu">ReLU</SelectItem>
              <SelectItem value="tanh">Tanh</SelectItem>
              <SelectItem value="sigmoid">Sigmoid</SelectItem>
              <SelectItem value="leaky_relu">Leaky ReLU</SelectItem>
            </SelectContent>
          </Select>
          <SweepConfig
            paramKey={key}
            currentValue={value}
            sweep={sweep}
            onSweepChange={(s) => handleSweepChange(key, s)}
          />
        </div>
      );
    }

    if (key === "reference") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
              {key.replace(/_/g, " ")}
            </Label>
            {info && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>{info}</p>
                </TooltipContent>
              </Tooltip>
            )}
            {hasSweepActive && (
              <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
                sweep
              </Badge>
            )}
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
            disabled={hasSweepActive}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="mean">Mean Spectrum</SelectItem>
              <SelectItem value="first">First Spectrum</SelectItem>
              <SelectItem value="median">Median Spectrum</SelectItem>
            </SelectContent>
          </Select>
          <SweepConfig
            paramKey={key}
            currentValue={value}
            sweep={sweep}
            onSweepChange={(s) => handleSweepChange(key, s)}
          />
        </div>
      );
    }

    // Number or string parameters
    return (
      <div key={key} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className={`text-sm capitalize ${hasSweepActive ? "text-orange-500" : ""}`}>
            {key.replace(/_/g, " ")}
          </Label>
          {info && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[200px]">
                <p>{info}</p>
              </TooltipContent>
            </Tooltip>
          )}
          {hasSweepActive && (
            <Badge variant="outline" className="text-[10px] px-1 h-4 border-orange-500/50 text-orange-500">
              sweep
            </Badge>
          )}
        </div>
        <Input
          type={typeof value === "number" ? "number" : "text"}
          value={value}
          onChange={(e) => {
            const newValue =
              typeof value === "number"
                ? parseFloat(e.target.value) || 0
                : e.target.value;
            handleParamChange(key, newValue);
          }}
          step={
            typeof value === "number"
              ? value < 1 && value > 0
                ? 0.01
                : 1
              : undefined
          }
          className="font-mono text-sm"
          disabled={hasSweepActive}
        />
        <SweepConfig
          paramKey={key}
          currentValue={value}
          sweep={sweep}
          onSweepChange={(s) => handleSweepChange(key, s)}
        />
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${colors.bg} ${colors.text}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-foreground truncate">
              {step.name}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge variant="secondary" className="text-xs capitalize">
                {step.type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {Object.keys(step.params).length} params
              </span>
              {hasSweeps && (
                <Badge className="text-xs bg-orange-500 hover:bg-orange-600">
                  <Repeat className="h-3 w-3 mr-1" />
                  {totalVariants} variants
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Step Algorithm Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Algorithm</Label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-[200px]">
                  <p>Select the algorithm for this {step.type} step</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <Select value={step.name} onValueChange={handleNameChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover max-h-[300px]">
                {stepOptions[step.type].map((opt) => (
                  <SelectItem key={opt.name} value={opt.name}>
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {opt.description}
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {currentOption && (
              <p className="text-xs text-muted-foreground">
                {currentOption.description}
              </p>
            )}
          </div>

          <Separator />

          {/* Parameters */}
          {Object.keys(step.params).length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Parameters</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={handleResetParams}
                >
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Reset
                </Button>
              </div>
              {Object.entries(step.params).map(([key, value]) =>
                renderParamInput(key, value)
              )}
            </div>
          ) : (
            <div className="text-center py-6">
              <div className="p-3 rounded-full bg-muted/50 w-fit mx-auto mb-3">
                <Info className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                No configurable parameters
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This step uses default settings
              </p>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Actions */}
      <div className="p-4 border-t border-border space-y-2">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() => onDuplicate(step.id)}
        >
          <Copy className="h-4 w-4 mr-2" />
          Duplicate Step
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={() => onRemove(step.id)}
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Remove Step
        </Button>
      </div>
    </div>
  );
}

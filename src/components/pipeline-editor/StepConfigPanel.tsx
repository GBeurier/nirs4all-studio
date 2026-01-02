import {
  Waves,
  Shuffle,
  Target,
  BarChart3,
  GitBranch,
  GitMerge,
  Trash2,
  Copy,
  Info,
  RotateCcw,
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
  stepOptions,
  stepColors,
  type PipelineStep,
  type StepType,
} from "./types";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  splitting: Shuffle,
  model: Target,
  metrics: BarChart3,
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
      });
    }
  };

  const renderParamInput = (key: string, value: string | number | boolean) => {
    const info = parameterInfo[key];

    // Boolean parameters
    if (typeof value === "boolean") {
      return (
        <div key={key} className="flex items-center justify-between py-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm capitalize">
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
          </div>
          <Switch
            checked={value}
            onCheckedChange={(checked) => handleParamChange(key, checked)}
          />
        </div>
      );
    }

    // Select parameters for known options
    if (key === "kernel") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm capitalize">
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
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
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
        </div>
      );
    }

    if (key === "norm") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm capitalize">
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
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
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
        </div>
      );
    }

    if (key === "activation") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm capitalize">
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
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
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
        </div>
      );
    }

    if (key === "reference") {
      return (
        <div key={key} className="space-y-2">
          <div className="flex items-center gap-2">
            <Label className="text-sm capitalize">
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
          </div>
          <Select
            value={String(value)}
            onValueChange={(v) => handleParamChange(key, v)}
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
        </div>
      );
    }

    // Number or string parameters
    return (
      <div key={key} className="space-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-sm capitalize">{key.replace(/_/g, " ")}</Label>
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
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="text-xs capitalize">
                {step.type}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {Object.keys(step.params).length} params
              </span>
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

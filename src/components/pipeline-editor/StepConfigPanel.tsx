import { useState, useMemo, useCallback } from "react";
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
  Filter,
  Zap,
  BarChart3,
  Settings2,
  Sliders,
  Cpu,
  AlertTriangle,
  GraduationCap,
  Layers,
  Boxes,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  stepOptions,
  stepColors,
  type PipelineStep,
  type StepType,
  type ParameterSweep,
  type SweepType,
  calculateSweepVariants,
  calculateStepVariants,
  formatSweepDisplay,
} from "./types";
import { SweepConfigPopover } from "./SweepConfigPopover";
import { FinetuneTab, FinetuningBadge, QuickFinetuneButton } from "./FinetuneConfig";
import { YProcessingPanel, defaultYProcessingConfig, YProcessingBadge } from "./YProcessingPanel";
import { FeatureAugmentationPanel, defaultFeatureAugmentationConfig, FeatureAugmentationBadge } from "./FeatureAugmentationPanel";
import { StackingPanel, defaultStackingConfig, StackingBadge } from "./StackingPanel";

const stepIcons: Record<StepType, typeof Waves> = {
  preprocessing: Waves,
  y_processing: BarChart3,
  splitting: Shuffle,
  model: Target,
  generator: Sparkles,
  branch: GitBranch,
  merge: GitMerge,
  filter: Filter,
  augmentation: Zap,
};

// Parameter info/tooltips for common parameters
const parameterInfo: Record<string, string> = {
  // General
  n_components: "Number of components/latent variables to use",
  n_estimators: "Number of trees in the ensemble",
  max_depth: "Maximum depth of trees",
  learning_rate: "Step size for gradient descent optimization",
  test_size: "Proportion of data to use for testing (0.0-1.0)",
  n_splits: "Number of folds for cross-validation",
  random_state: "Random seed for reproducibility",

  // Savitzky-Golay / Smoothing
  window_length: "Size of the moving window (must be odd)",
  window: "Size of the moving window (must be odd)",
  window_size: "Size of the moving window",
  polyorder: "Polynomial order for fitting",
  deriv: "Derivative order (0=smoothing, 1=first, 2=second)",
  sigma: "Standard deviation for Gaussian kernel",

  // Baseline correction
  order: "Polynomial order for baseline/detrending",
  lam: "Smoothing parameter (lambda) - higher = smoother baseline",
  p: "Asymmetry parameter (0 to 1) - lower emphasizes troughs",
  max_half_window: "Maximum half window size for SNIP algorithm",
  half_window: "Half window size for rolling ball",
  poly_order: "Polynomial order for baseline fitting",

  // Wavelets
  wavelet: "Wavelet type (db4, sym4, haar, etc.)",
  level: "Decomposition level",

  // SVM/SVR
  C: "Regularization parameter (higher = less regularization)",
  epsilon: "Epsilon in epsilon-SVR model",
  kernel: "Kernel type for SVM (rbf, linear, poly)",
  gamma: "Kernel coefficient for rbf/poly/sigmoid",

  // Regularization
  alpha: "Regularization strength",
  l1_ratio: "L1 ratio for Elastic Net (0=L2, 1=L1)",

  // Cross-validation
  shuffle: "Whether to shuffle data before splitting",
  n_repeats: "Number of times to repeat cross-validation",

  // Normalization
  norm: "Normalization type (l1, l2, max)",
  reference: "Reference spectrum for MSC (mean, first, median)",

  // Feature range
  feature_range_min: "Minimum value after scaling",
  feature_range_max: "Maximum value after scaling",
  start: "Start index for cropping",
  end: "End index for cropping (-1 = end)",
  n_points: "Number of points after resampling",

  // Deep learning
  layers: "Number of hidden layers",
  filters: "Number of convolutional filters",
  kernel_size: "Size of convolution kernel",
  dropout: "Dropout rate for regularization",
  hidden_layers: "Comma-separated list of hidden layer sizes",
  activation: "Activation function (relu, tanh, sigmoid)",
  units: "Number of LSTM units",
  n_heads: "Number of attention heads",
  n_layers: "Number of transformer layers",
  d_model: "Model dimension",

  // Feature selection
  n_pls_components: "Number of PLS components for CARS/MCUVE",
  n_sampling_runs: "Number of sampling runs for CARS",
  n_iterations: "Number of Monte Carlo iterations",
  threshold: "Selection threshold",
  n_intervals: "Number of spectral intervals for IntervalPLS",
  n_neighbors: "Number of neighbors for locally weighted methods",

  // NIRS-specific splitters
  metric: "Distance metric for Kennard-Stone (euclidean, mahalanobis)",
  n_clusters: "Number of clusters for K-means splitter",
  n_bins: "Number of bins for stratification",

  // Augmentation
  std: "Standard deviation for noise",
  probability: "Probability of applying augmentation",
  magnitude: "Magnitude of the effect",
  max_slope: "Maximum slope for linear drift",
  max_shift: "Maximum wavelength shift",
  max_factor: "Maximum stretch/compression factor",
  n_bands: "Number of bands to mask",
  max_width: "Maximum width of masked bands",
  dropout_rate: "Probability of dropping each channel",

  // Filter
  condition: "Filter condition expression",
  method: "Method for outlier detection (iqr, zscore, mad)",

  // Transform
  output_distribution: "Target distribution (uniform, normal)",
  n_quantiles: "Number of quantiles for transformation",
  strategy: "Binning strategy (uniform, quantile, kmeans)",
  ranges: "Comma-separated range boundaries",
  voting: "Voting method (soft, hard)",
  axis: "Axis for concatenation (0=samples, 1=features)",
  base_estimator: "Base estimator for meta-model",
};

// Note: SweepConfigPopover is now used instead of the inline SweepConfig component
// It provides a cleaner UX with presets, better preview, and popover-based editing

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
          <SweepConfigPopover
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
          <SweepConfigPopover
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
          <SweepConfigPopover
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
          <SweepConfigPopover
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
          <SweepConfigPopover
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
        <SweepConfigPopover
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
              <FinetuningBadge config={step.finetuneConfig} />
            </div>
          </div>
        </div>
      </div>

      {/* Content - Use tabs for model steps, specialized panels for y_processing and merge */}
      {step.type === "model" ? (
        <ModelStepContent
          step={step}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
          renderParamInput={renderParamInput}
          handleNameChange={handleNameChange}
          handleResetParams={handleResetParams}
          currentOption={currentOption}
        />
      ) : step.type === "y_processing" ? (
        <YProcessingStepContent
          step={step}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
        />
      ) : step.type === "merge" ? (
        <MergeStepContent
          step={step}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onDuplicate={onDuplicate}
          renderParamInput={renderParamInput}
          handleNameChange={handleNameChange}
          handleResetParams={handleResetParams}
          currentOption={currentOption}
        />
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}

// Extracted component for model step content with tabs
interface ModelStepContentProps {
  step: PipelineStep;
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  renderParamInput: (key: string, value: string | number | boolean) => React.ReactNode;
  handleNameChange: (name: string) => void;
  handleResetParams: () => void;
  currentOption: { name: string; description: string; defaultParams: Record<string, string | number | boolean> } | undefined;
}

function ModelStepContent({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: ModelStepContentProps) {
  const [activeTab, setActiveTab] = useState("parameters");

  const hasFinetuning = step.finetuneConfig?.enabled;

  // Handler for FinetuneTab updates
  const handleFinetuneUpdate = useCallback((updates: Partial<PipelineStep>) => {
    onUpdate(step.id, updates);
  }, [onUpdate, step.id]);

  // Check if this is a deep learning model (for potential Training tab)
  const currentStepOption = stepOptions.model.find((o) => o.name === step.name);
  const isDeepLearning = currentStepOption?.isDeepLearning ?? false;

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-2">
          <TabsList className="h-10 w-full justify-start bg-transparent gap-1">
            <TabsTrigger
              value="parameters"
              className="text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <Sliders className="h-3.5 w-3.5 mr-1.5" />
              Parameters
            </TabsTrigger>
            <TabsTrigger
              value="finetuning"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasFinetuning ? "text-purple-500 data-[state=active]:text-purple-600" : ""
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Finetuning
              {hasFinetuning && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-purple-500">
                  {step.finetuneConfig?.n_trials}
                </Badge>
              )}
            </TabsTrigger>
            {isDeepLearning && (
              <TabsTrigger
                value="training"
                className="text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
              >
                <GraduationCap className="h-3.5 w-3.5 mr-1.5" />
                Training
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* Parameters Tab */}
        <TabsContent value="parameters" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-6">
              {/* Step Algorithm Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Model</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[200px]">
                      <p>Select the model algorithm</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={step.name} onValueChange={handleNameChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover max-h-[300px]">
                    {stepOptions.model.map((opt) => (
                      <SelectItem key={opt.name} value={opt.name}>
                        <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{opt.name}</span>
                            {opt.isDeepLearning && (
                              <Badge variant="outline" className="text-[10px] py-0 h-4">
                                DL
                              </Badge>
                            )}
                          </div>
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

              {/* Quick Finetuning CTA */}
              {!hasFinetuning && Object.keys(step.params).some(k => typeof step.params[k] === "number") && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/5 border border-purple-500/20">
                  <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      Optimize parameters automatically?
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Let Optuna find the best values intelligently.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-purple-500/50 text-purple-500 hover:bg-purple-500/10"
                    onClick={() => setActiveTab("finetuning")}
                  >
                    Configure
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Finetuning Tab */}
        <TabsContent value="finetuning" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <FinetuneTab step={step} onUpdate={handleFinetuneUpdate} />
          </ScrollArea>
        </TabsContent>

        {/* Training Tab (for deep learning models) */}
        {isDeepLearning && (
          <TabsContent value="training" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <TrainingTab step={step} onUpdate={handleFinetuneUpdate} />
            </ScrollArea>
          </TabsContent>
        )}
      </Tabs>

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
    </>
  );
}

// Training configuration tab for deep learning models
interface TrainingTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

function TrainingTab({ step, onUpdate }: TrainingTabProps) {
  const config = step.trainingConfig ?? {
    epochs: 100,
    batch_size: 32,
    learning_rate: 0.001,
    patience: 20,
    optimizer: "adam" as const,
  };

  const handleUpdate = (updates: Partial<typeof config>) => {
    onUpdate({
      trainingConfig: { ...config, ...updates },
    });
  };

  return (
    <div className="p-4 space-y-6">
      {/* Training Configuration */}
      <div className="space-y-4">
        <Label className="text-sm font-medium flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          Training Configuration
        </Label>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Epochs</Label>
            <Input
              type="number"
              value={config.epochs}
              onChange={(e) => handleUpdate({ epochs: parseInt(e.target.value) || 100 })}
              min={1}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Batch Size</Label>
            <Input
              type="number"
              value={config.batch_size}
              onChange={(e) => handleUpdate({ batch_size: parseInt(e.target.value) || 32 })}
              min={1}
              className="font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Learning Rate</Label>
            <Input
              type="number"
              value={config.learning_rate}
              onChange={(e) => handleUpdate({ learning_rate: parseFloat(e.target.value) || 0.001 })}
              step={0.0001}
              min={0.00001}
              className="font-mono"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Patience (early stopping)</Label>
            <Input
              type="number"
              value={config.patience ?? 20}
              onChange={(e) => handleUpdate({ patience: parseInt(e.target.value) || 20 })}
              min={1}
              className="font-mono"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Optimizer</Label>
          <Select
            value={config.optimizer}
            onValueChange={(value: "adam" | "sgd" | "rmsprop" | "adamw") =>
              handleUpdate({ optimizer: value })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="adam">Adam</SelectItem>
              <SelectItem value="adamw">AdamW</SelectItem>
              <SelectItem value="sgd">SGD</SelectItem>
              <SelectItem value="rmsprop">RMSprop</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* Quick Presets */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Quick Presets</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Quick Train", epochs: 20, batch: 64, lr: 0.01, patience: 5 },
            { label: "Standard", epochs: 100, batch: 32, lr: 0.001, patience: 20 },
            { label: "Long Train", epochs: 500, batch: 16, lr: 0.0001, patience: 50 },
            { label: "Fine-tune", epochs: 50, batch: 32, lr: 0.00001, patience: 10 },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="sm"
              className="h-auto py-2 justify-start"
              onClick={() =>
                handleUpdate({
                  epochs: preset.epochs,
                  batch_size: preset.batch,
                  learning_rate: preset.lr,
                  patience: preset.patience,
                })
              }
            >
              <div className="text-left">
                <div className="font-medium text-xs">{preset.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {preset.epochs} epochs, lr={preset.lr}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// Y-Processing Step Content - specialized panel for target variable scaling
interface YProcessingStepContentProps {
  step: PipelineStep;
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}

function YProcessingStepContent({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
}: YProcessingStepContentProps) {
  // Initialize config if not present
  const config = step.yProcessingConfig ?? defaultYProcessingConfig();

  const handleConfigChange = useCallback((newConfig: typeof config) => {
    onUpdate(step.id, {
      yProcessingConfig: newConfig,
    });
  }, [onUpdate, step.id]);

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4">
          <YProcessingPanel
            config={config}
            onChange={handleConfigChange}
          />
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
    </>
  );
}

// Merge Step Content - specialized panel with stacking configuration
interface MergeStepContentProps {
  step: PipelineStep;
  onUpdate: (id: string, updates: Partial<PipelineStep>) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  renderParamInput: (key: string, value: string | number | boolean) => React.ReactNode;
  handleNameChange: (name: string) => void;
  handleResetParams: () => void;
  currentOption: { name: string; description: string; defaultParams: Record<string, string | number | boolean> } | undefined;
}

function MergeStepContent({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: MergeStepContentProps) {
  const [activeTab, setActiveTab] = useState("merge");

  // Initialize stacking config if not present
  const stackingConfig = step.stackingConfig ?? defaultStackingConfig();

  const handleStackingChange = useCallback((newConfig: typeof stackingConfig) => {
    onUpdate(step.id, {
      stackingConfig: newConfig,
    });
  }, [onUpdate, step.id]);

  const hasStackingEnabled = stackingConfig?.enabled ?? false;

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b border-border px-2">
          <TabsList className="h-10 w-full justify-start bg-transparent gap-1">
            <TabsTrigger
              value="merge"
              className="text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <GitMerge className="h-3.5 w-3.5 mr-1.5" />
              Merge
            </TabsTrigger>
            <TabsTrigger
              value="stacking"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasStackingEnabled ? "text-pink-500 data-[state=active]:text-pink-600" : ""
              }`}
            >
              <Layers className="h-3.5 w-3.5 mr-1.5" />
              Stacking
              {hasStackingEnabled && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-pink-500">
                  ON
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Merge Configuration Tab */}
        <TabsContent value="merge" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4 space-y-6">
              {/* Merge Strategy Selection */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Merge Strategy</Label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[200px]">
                      <p>How to combine outputs from multiple branches</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <Select value={step.name} onValueChange={handleNameChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover max-h-[300px]">
                    {stepOptions.merge.map((opt) => (
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
                    This merge strategy uses default settings
                  </p>
                </div>
              )}

              {/* Stacking CTA */}
              {!hasStackingEnabled && (
                <div className="flex items-start gap-3 p-3 rounded-lg bg-pink-500/5 border border-pink-500/20">
                  <Layers className="h-4 w-4 text-pink-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm text-foreground">
                      Want to use stacking ensemble?
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Combine branch predictions with a meta-model for better results.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs border-pink-500/50 text-pink-500 hover:bg-pink-500/10"
                    onClick={() => setActiveTab("stacking")}
                  >
                    Configure
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Stacking Tab */}
        <TabsContent value="stacking" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <StackingPanel
                config={stackingConfig}
                onChange={handleStackingChange}
              />
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>

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
    </>
  );
}

/**
 * ModelRenderer - Model step configuration renderer
 *
 * Specialized renderer for model steps that includes:
 * - Parameters tab with algorithm selection
 * - Finetuning tab for Optuna hyperparameter optimization
 * - Training tab for deep learning models (epochs, batch size, etc.)
 *
 * Features:
 * - Lazy loading of FinetuneTab with preload on hover
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useState, useCallback, lazy, Suspense } from "react";
import {
  Info,
  RotateCcw,
  Sliders,
  Sparkles,
  GraduationCap,
  Loader2,
  RefreshCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { stepOptions, type PipelineStep, type RefitConfig } from "../../types";
import { StepActions } from "./StepActions";
import type { ParameterRendererProps } from "./types";
import { useSelectWheel } from "../../shared/useSelectWheel";

// Lazy load FinetuneTab with preload support
// We store the import promise so we can trigger preloading on hover
let finetuneTabPromise: Promise<typeof import("../../finetuning/FinetuneTab")> | null = null;

function loadFinetuneTab() {
  if (!finetuneTabPromise) {
    finetuneTabPromise = import("../../finetuning/FinetuneTab");
  }
  return finetuneTabPromise;
}

// Preload function - can be called on hover before user clicks
export function preloadFinetuneTab() {
  loadFinetuneTab();
}

const FinetuneTab = lazy(() =>
  loadFinetuneTab().then((m) => ({ default: m.FinetuneTab }))
);

// Loading skeleton for FinetuneTab
function FinetuneTabSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-purple-500" />
        <span className="ml-2 text-sm text-muted-foreground">Loading finetuning options...</span>
      </div>
    </div>
  );
}

/**
 * ModelRenderer - Tabbed configuration for model steps
 *
 * Four tabs:
 * 1. Parameters - Model selection and hyperparameters
 * 2. Finetuning - Optuna hyperparameter optimization
 * 3. Refit - Refit configuration (retrain on full data after CV)
 * 4. Training - Deep learning training config (only for DL models)
 */
export function ModelRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: ParameterRendererProps) {
  const [activeTab, setActiveTab] = useState("parameters");

  const hasFinetuning = step.finetuneConfig?.enabled;
  const hasRefit = step.refitConfig?.enabled ?? true; // refit is on by default

  // Handler for FinetuneTab updates
  const handleFinetuneUpdate = useCallback(
    (updates: Partial<PipelineStep>) => {
      onUpdate(step.id, updates);
    },
    [onUpdate, step.id]
  );

  // Check if this is a deep learning model (for Training tab)
  const currentStepOption = stepOptions.model.find((o) => o.name === step.name);
  const isDeepLearning = currentStepOption?.isDeepLearning ?? false;

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col overflow-hidden"
      >
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
                hasFinetuning
                  ? "text-purple-500 data-[state=active]:text-purple-600"
                  : ""
              }`}
              onMouseEnter={preloadFinetuneTab}
              onFocus={preloadFinetuneTab}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1.5" />
              Finetuning
              {hasFinetuning && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-purple-500">
                  {step.finetuneConfig?.n_trials}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="refit"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasRefit
                  ? "text-emerald-500 data-[state=active]:text-emerald-600"
                  : ""
              }`}
            >
              <RefreshCcw className="h-3.5 w-3.5 mr-1.5" />
              Refit
              {hasRefit && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-emerald-500">
                  On
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
              {!hasFinetuning &&
                Object.keys(step.params).some(
                  (k) => typeof step.params[k] === "number"
                ) && (
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
                      onMouseEnter={preloadFinetuneTab}
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
            <Suspense fallback={<FinetuneTabSkeleton />}>
              <FinetuneTab step={step} onUpdate={handleFinetuneUpdate} />
            </Suspense>
          </ScrollArea>
        </TabsContent>

        {/* Refit Tab */}
        <TabsContent value="refit" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <RefitTab step={step} onUpdate={handleFinetuneUpdate} />
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

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}

// ============================================================================
// TrainingTab - Training configuration for deep learning models
// ============================================================================

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

  const optimizerOptions = [
    { value: "adam" }, { value: "sgd" }, { value: "rmsprop" }, { value: "adamw" }
  ];

  const handleOptimizerWheel = useSelectWheel(
    config.optimizer ?? "adam",
    (v) => handleUpdate({ optimizer: v as any }),
    optimizerOptions as any,
    true
  );

  return (
    <div className="p-4 space-y-4">
      {/* Training Configuration */}
      <div className="space-y-4">
        <Label className="text-sm font-medium flex items-center gap-2">
          <GraduationCap className="h-4 w-4" />
          Training Configuration
        </Label>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Epochs</Label>
              <Input
                type="number"
                value={config.epochs}
                onChange={(e) =>
                  handleUpdate({ epochs: parseInt(e.target.value) || 100 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Batch Size</Label>
              <Input
                type="number"
                value={config.batch_size}
                onChange={(e) =>
                  handleUpdate({ batch_size: parseInt(e.target.value) || 32 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Learning Rate
              </Label>
              <Input
                type="number"
                value={config.learning_rate}
                onChange={(e) =>
                  handleUpdate({
                    learning_rate: parseFloat(e.target.value) || 0.001,
                  })
                }
                step={0.0001}
                min={0.00001}
                className="font-mono h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Patience
              </Label>
              <Input
                type="number"
                value={config.patience ?? 20}
                onChange={(e) =>
                  handleUpdate({ patience: parseInt(e.target.value) || 20 })
                }
                min={1}
                className="font-mono h-8"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Optimizer</Label>
            <div onWheel={handleOptimizerWheel}>
              <Select
                value={config.optimizer}
                onValueChange={(value: "adam" | "sgd" | "rmsprop" | "adamw") =>
                  handleUpdate({ optimizer: value })
                }
              >
                <SelectTrigger className="h-8">
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
        </div>
      </div>

      <Separator />

      {/* Quick Presets */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Quick Presets</Label>
        <div className="grid grid-cols-2 gap-2">
          {[
            {
              label: "Quick",
              epochs: 20,
              batch: 64,
              lr: 0.01,
              patience: 5,
            },
            {
              label: "Standard",
              epochs: 100,
              batch: 32,
              lr: 0.001,
              patience: 20,
            },
            {
              label: "Long",
              epochs: 500,
              batch: 16,
              lr: 0.0001,
              patience: 50,
            },
            {
              label: "Fine-tune",
              epochs: 50,
              batch: 32,
              lr: 0.00001,
              patience: 10,
            },
          ].map((preset) => (
            <Button
              key={preset.label}
              variant="outline"
              size="sm"
              className="h-auto py-1.5 justify-start text-left"
              onClick={() =>
                handleUpdate({
                  epochs: preset.epochs,
                  batch_size: preset.batch,
                  learning_rate: preset.lr,
                  patience: preset.patience,
                })
              }
            >
              <div>
                <div className="font-medium text-xs">{preset.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {preset.epochs}ep, lr={preset.lr}
                </div>
              </div>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RefitTab - Refit configuration for model steps
// ============================================================================

interface RefitTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

function RefitTab({ step, onUpdate }: RefitTabProps) {
  const config: RefitConfig = step.refitConfig ?? {
    enabled: true,
  };

  const handleToggle = (enabled: boolean) => {
    onUpdate({
      refitConfig: { ...config, enabled },
    });
  };

  const handleParamChange = (key: string, value: string) => {
    const parsed = parseFloat(value);
    const newParams = { ...(config.refit_params || {}) };
    if (value === "" || isNaN(parsed)) {
      delete newParams[key];
    } else {
      newParams[key] = parsed;
    }
    onUpdate({
      refitConfig: {
        ...config,
        refit_params: Object.keys(newParams).length > 0 ? newParams : undefined,
      },
    });
  };

  const handleRemoveParam = (key: string) => {
    const newParams = { ...(config.refit_params || {}) };
    delete newParams[key];
    onUpdate({
      refitConfig: {
        ...config,
        refit_params: Object.keys(newParams).length > 0 ? newParams : undefined,
      },
    });
  };

  const handleAddParam = () => {
    const newParams = { ...(config.refit_params || {}), "": 0 };
    onUpdate({
      refitConfig: { ...config, refit_params: newParams },
    });
  };

  return (
    <div className="p-4 space-y-4">
      {/* Refit Toggle */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Refit Configuration
          </Label>
          <Switch
            checked={config.enabled}
            onCheckedChange={handleToggle}
          />
        </div>

        <div className="p-3 rounded-lg bg-muted/30">
          <p className="text-xs text-muted-foreground">
            When enabled, the best model from cross-validation is retrained on the
            full training set to produce a deployment-ready "final model". The
            exported .n4a bundle will contain this refit model.
          </p>
        </div>
      </div>

      {config.enabled && (
        <>
          <Separator />

          {/* Refit Parameter Overrides */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Parameter Overrides</Label>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleAddParam}
              >
                Add Override
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              Override specific model parameters for the refit phase. For example,
              you can use more epochs or a lower learning rate when retraining on
              all data.
            </p>

            {config.refit_params && Object.keys(config.refit_params).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(config.refit_params).map(([key, value], index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Parameter name"
                      value={key}
                      onChange={(e) => {
                        const newParams = { ...(config.refit_params || {}) };
                        const oldValue = newParams[key];
                        delete newParams[key];
                        newParams[e.target.value] = oldValue;
                        onUpdate({
                          refitConfig: { ...config, refit_params: newParams },
                        });
                      }}
                      className="h-8 font-mono text-xs flex-1"
                    />
                    <Input
                      type="number"
                      placeholder="Value"
                      value={String(value ?? "")}
                      onChange={(e) => handleParamChange(key || `param_${index}`, e.target.value)}
                      className="h-8 font-mono text-xs w-24"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemoveParam(key)}
                    >
                      <RotateCcw className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground border border-dashed rounded-lg">
                <p className="text-xs">
                  No overrides configured. The refit model will use the same
                  parameters as the best CV model.
                </p>
              </div>
            )}
          </div>

          <Separator />

          {/* Common Override Presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Common Overrides</Label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "More Epochs", params: { epochs: 200 } },
                { label: "Lower LR", params: { learning_rate: 0.0001 } },
                { label: "No Early Stop", params: { patience: 999 } },
                { label: "Larger Batch", params: { batch_size: 64 } },
              ].map((preset) => (
                <Button
                  key={preset.label}
                  variant="outline"
                  size="sm"
                  className="h-auto py-1.5 justify-start text-left text-xs"
                  onClick={() => {
                    const newParams = {
                      ...(config.refit_params || {}),
                      ...preset.params,
                    };
                    onUpdate({
                      refitConfig: { ...config, refit_params: newParams },
                    });
                  }}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

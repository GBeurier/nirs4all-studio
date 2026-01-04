/**
 * MergeRenderer - Merge step configuration renderer
 *
 * Specialized renderer for merge steps that includes:
 * - Merge tab with strategy selection and parameters
 * - Sources tab for advanced branch merge configuration
 * - Stacking tab for ensemble/meta-model configuration
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useState, useCallback, lazy, Suspense } from "react";
import { Info, RotateCcw, GitMerge, GitBranch, Layers, X, Loader2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  stepOptions,
  type MergeConfig,
  type MergePredictionSource,
} from "../../types";
import { defaultStackingConfig } from "../../StackingPanel";
import { StepActions } from "./StepActions";
import type { ParameterRendererProps } from "./types";

// Lazy load heavy StackingPanel component
const StackingPanel = lazy(() =>
  import("../../StackingPanel").then((m) => ({ default: m.StackingPanel }))
);

/**
 * Loading skeleton for StackingPanel
 */
function StackingPanelSkeleton() {
  return (
    <div className="p-4 space-y-4 animate-pulse">
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  );
}

/**
 * MergeRenderer - Tabbed configuration for merge steps
 *
 * Three tabs:
 * 1. Merge - Strategy selection and basic parameters
 * 2. Sources - Advanced branch merge configuration
 * 3. Stacking - Ensemble/meta-model setup
 */
export function MergeRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleNameChange,
  handleResetParams,
  currentOption,
}: ParameterRendererProps) {
  const [activeTab, setActiveTab] = useState("merge");

  // Initialize stacking config if not present
  const stackingConfig = step.stackingConfig ?? defaultStackingConfig();

  // Initialize mergeConfig if not present
  const mergeConfig = step.mergeConfig ?? { mode: "predictions" };

  const handleStackingChange = useCallback(
    (newConfig: typeof stackingConfig) => {
      onUpdate(step.id, {
        stackingConfig: newConfig,
      });
    },
    [onUpdate, step.id]
  );

  const handleMergeConfigChange = useCallback(
    (newConfig: MergeConfig) => {
      onUpdate(step.id, {
        mergeConfig: newConfig,
      });
    },
    [onUpdate, step.id]
  );

  const hasStackingEnabled = stackingConfig?.enabled ?? false;
  const hasAdvancedConfig =
    (mergeConfig.predictions && mergeConfig.predictions.length > 0) ||
    (mergeConfig.features && mergeConfig.features.length > 0);

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
              value="merge"
              className="text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none"
            >
              <GitMerge className="h-3.5 w-3.5 mr-1.5" />
              Merge
            </TabsTrigger>
            <TabsTrigger
              value="sources"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasAdvancedConfig
                  ? "text-blue-500 data-[state=active]:text-blue-600"
                  : ""
              }`}
            >
              <GitBranch className="h-3.5 w-3.5 mr-1.5" />
              Sources
              {hasAdvancedConfig && (
                <Badge className="ml-1.5 h-4 px-1 text-[10px] bg-blue-500">
                  {(mergeConfig.predictions?.length ?? 0) +
                    (mergeConfig.features?.length ?? 0)}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="stacking"
              className={`text-xs data-[state=active]:bg-muted data-[state=active]:shadow-none ${
                hasStackingEnabled
                  ? "text-pink-500 data-[state=active]:text-pink-600"
                  : ""
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
                      Combine branch predictions with a meta-model for better
                      results.
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

        {/* Sources Tab - Advanced branch merge configuration */}
        <TabsContent value="sources" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <SourcesTab
              mergeConfig={mergeConfig}
              onConfigChange={handleMergeConfigChange}
            />
          </ScrollArea>
        </TabsContent>

        {/* Stacking Tab */}
        <TabsContent value="stacking" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="p-4">
              <Suspense fallback={<StackingPanelSkeleton />}>
                <StackingPanel
                  config={stackingConfig}
                  onChange={handleStackingChange}
                />
              </Suspense>
            </div>
          </ScrollArea>
        </TabsContent>
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
// SourcesTab - Advanced branch merge configuration
// ============================================================================

interface SourcesTabProps {
  mergeConfig: MergeConfig;
  onConfigChange: (config: MergeConfig) => void;
}

function SourcesTab({ mergeConfig, onConfigChange }: SourcesTabProps) {
  return (
    <div className="p-4 space-y-6">
      {/* Mode Selection */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">Source Mode</Label>
        <Select
          value={mergeConfig.mode ?? "predictions"}
          onValueChange={(value) =>
            onConfigChange({ ...mergeConfig, mode: value })
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="predictions">
              <div className="flex flex-col">
                <span className="font-medium">Predictions</span>
                <span className="text-xs text-muted-foreground">
                  Merge model predictions
                </span>
              </div>
            </SelectItem>
            <SelectItem value="features">
              <div className="flex flex-col">
                <span className="font-medium">Features</span>
                <span className="text-xs text-muted-foreground">
                  Merge transformed features
                </span>
              </div>
            </SelectItem>
            <SelectItem value="concatenate">
              <div className="flex flex-col">
                <span className="font-medium">Concatenate</span>
                <span className="text-xs text-muted-foreground">
                  Concatenate all outputs
                </span>
              </div>
            </SelectItem>
            <SelectItem value="custom">
              <div className="flex flex-col">
                <span className="font-medium">Custom</span>
                <span className="text-xs text-muted-foreground">
                  Configure specific branches
                </span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Predictions Configuration (when mode is custom or predictions) */}
      {(mergeConfig.mode === "custom" ||
        mergeConfig.mode === "predictions") && (
        <PredictionSourcesSection
          predictions={mergeConfig.predictions ?? []}
          onChange={(predictions) =>
            onConfigChange({ ...mergeConfig, predictions })
          }
        />
      )}

      {/* Features Configuration (when mode is custom or features) */}
      {(mergeConfig.mode === "custom" || mergeConfig.mode === "features") && (
        <FeatureSourcesSection
          features={mergeConfig.features ?? []}
          onChange={(features) => onConfigChange({ ...mergeConfig, features })}
        />
      )}

      <Separator />

      {/* Output Configuration */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Output Options</Label>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Output As</Label>
          <Select
            value={mergeConfig.output_as ?? "predictions"}
            onValueChange={(value) =>
              onConfigChange({
                ...mergeConfig,
                output_as: value as "features" | "predictions",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="predictions">Predictions</SelectItem>
              <SelectItem value="features">Features</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">On Missing</Label>
          <Select
            value={mergeConfig.on_missing ?? "warn"}
            onValueChange={(value) =>
              onConfigChange({
                ...mergeConfig,
                on_missing: value as "warn" | "error" | "drop",
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="drop">Drop</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            How to handle missing predictions from branches
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PredictionSourcesSection - Configure prediction sources from branches
// ============================================================================

interface PredictionSourcesSectionProps {
  predictions: MergePredictionSource[];
  onChange: (predictions: MergePredictionSource[]) => void;
}

function PredictionSourcesSection({
  predictions,
  onChange,
}: PredictionSourcesSectionProps) {
  const addSource = () => {
    const newSource: MergePredictionSource = { branch: 0, select: "best" };
    onChange([...predictions, newSource]);
  };

  const removeSource = (idx: number) => {
    onChange(predictions.filter((_, i) => i !== idx));
  };

  const updateSource = (idx: number, updates: Partial<MergePredictionSource>) => {
    const newPredictions = [...predictions];
    newPredictions[idx] = { ...newPredictions[idx], ...updates };
    onChange(newPredictions);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Prediction Sources</Label>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addSource}
        >
          + Add Source
        </Button>
      </div>

      {predictions.map((source, idx) => (
        <div key={idx} className="p-3 rounded-lg bg-muted/50 border space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Source {idx + 1}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => removeSource(idx)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Branch Index
              </Label>
              <Input
                type="number"
                min={0}
                value={source.branch}
                onChange={(e) =>
                  updateSource(idx, { branch: parseInt(e.target.value, 10) })
                }
                className="h-8"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Selection</Label>
              <Select
                value={
                  typeof source.select === "object" ? "top_k" : source.select
                }
                onValueChange={(value) => {
                  updateSource(idx, {
                    select:
                      value === "top_k"
                        ? { top_k: 3 }
                        : (value as "best" | "all"),
                  });
                }}
              >
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="best">Best</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="top_k">Top K</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {typeof source.select === "object" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Top K</Label>
                <Input
                  type="number"
                  min={1}
                  value={source.select.top_k}
                  onChange={(e) =>
                    updateSource(idx, {
                      select: { top_k: parseInt(e.target.value, 10) },
                    })
                  }
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Metric</Label>
                <Select
                  value={source.metric ?? "rmse"}
                  onValueChange={(value) =>
                    updateSource(idx, {
                      metric: value as "rmse" | "r2" | "mae",
                    })
                  }
                >
                  <SelectTrigger className="h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-popover">
                    <SelectItem value="rmse">RMSE</SelectItem>
                    <SelectItem value="r2">R²</SelectItem>
                    <SelectItem value="mae">MAE</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      ))}

      {predictions.length === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          No prediction sources configured. Click "Add Source" to add one.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FeatureSourcesSection - Configure feature sources from branches
// ============================================================================

interface FeatureSourcesSectionProps {
  features: number[];
  onChange: (features: number[]) => void;
}

function FeatureSourcesSection({
  features,
  onChange,
}: FeatureSourcesSectionProps) {
  const addBranch = () => {
    const nextIdx = features.length > 0 ? Math.max(...features) + 1 : 0;
    onChange([...features, nextIdx]);
  };

  const removeBranch = (idx: number) => {
    onChange(features.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          Feature Sources (Branch Indices)
        </Label>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={addBranch}
        >
          + Add Branch
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {features.map((branchIdx, idx) => (
          <div
            key={idx}
            className="flex items-center gap-1 px-2 py-1 rounded bg-muted border"
          >
            <span className="text-sm">Branch {branchIdx}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => removeBranch(idx)}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>

      {features.length === 0 && (
        <div className="text-center py-4 text-sm text-muted-foreground">
          No feature sources configured. All branches will be used.
        </div>
      )}
    </div>
  );
}

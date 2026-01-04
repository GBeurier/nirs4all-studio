/**
 * Container Step Renderers
 *
 * Renderers for container steps that contain child steps:
 * - SampleAugmentationRenderer
 * - FeatureAugmentationRenderer
 * - SampleFilterRenderer
 * - ConcatTransformRenderer
 *
 * These share a common pattern of displaying configuration options
 * and a list of child steps/transforms.
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { Zap, Layers, Filter, Combine, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StepActions } from "./StepActions";
import type { StepRendererProps } from "./types";
import type { PipelineStep } from "../../types";

// ============================================================================
// Shared ChildrenList Component
// ============================================================================

interface ChildrenListProps {
  children: PipelineStep[];
  label: string;
  addLabel: string;
  emptyLabel: string;
  emptySubLabel: string;
  icon: React.ElementType;
  onSelectStep?: (id: string | null) => void;
  onAddChild?: (stepId: string) => void;
  onRemoveChild?: (stepId: string, childId: string) => void;
  stepId: string;
}

function ChildrenList({
  children,
  label,
  addLabel,
  emptyLabel,
  emptySubLabel,
  icon: Icon,
  onSelectStep,
  onAddChild,
  onRemoveChild,
  stepId,
}: ChildrenListProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">
          {label} ({children.length})
        </Label>
        {onAddChild && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onAddChild(stepId)}
          >
            <Icon className="h-3 w-3 mr-1" />
            {addLabel}
          </Button>
        )}
      </div>
      {children.length > 0 ? (
        <div className="space-y-2">
          {children.map((child, i) => (
            <div
              key={child.id}
              className="flex items-center gap-2 p-2 rounded-lg bg-muted/50 border hover:bg-muted/70 cursor-pointer group"
              onClick={() => onSelectStep?.(child.id)}
            >
              <Badge variant="secondary" className="text-xs">
                {i + 1}
              </Badge>
              <span className="text-sm font-medium flex-1">{child.name}</span>
              <span className="text-xs text-muted-foreground font-mono">
                {Object.keys(child.params || {}).length > 0 &&
                  `(${Object.entries(child.params)
                    .slice(0, 2)
                    .map(([k, v]) => `${k}=${v}`)
                    .join(", ")})`}
              </span>
              {onRemoveChild && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveChild(stepId, child.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div
          className="text-center py-4 border border-dashed rounded-lg hover:border-primary/50 hover:bg-primary/5 cursor-pointer transition-colors"
          onClick={() => onAddChild?.(stepId)}
        >
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            {emptySubLabel}
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SampleAugmentationRenderer
// ============================================================================

export function SampleAugmentationRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepRendererProps) {
  const config = step.sampleAugmentationConfig;
  const children = step.children ?? [];

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onUpdate(step.id, {
      params: { ...step.params, [key]: value },
    });
    // Also update the structured config
    if (config) {
      const newConfig = { ...config };
      if (key === "count") newConfig.count = value as number;
      if (key === "selection")
        newConfig.selection = value as "random" | "all" | "sequential";
      if (key === "random_state") newConfig.random_state = value as number;
      onUpdate(step.id, { sampleAugmentationConfig: newConfig });
    }
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30">
            <Zap className="h-5 w-5 text-violet-500" />
            <div>
              <h4 className="font-medium text-sm">Sample Augmentation</h4>
              <p className="text-xs text-muted-foreground">
                Augment training samples with multiple transformers
              </p>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Augmentation Count</Label>
              <Input
                type="number"
                value={Number(step.params.count) || config?.count || 1}
                onChange={(e) =>
                  handleParamChange("count", parseInt(e.target.value) || 1)
                }
                min={1}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                Number of augmented samples per original
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Selection Strategy</Label>
              <Select
                value={String(
                  step.params.selection || config?.selection || "random"
                )}
                onValueChange={(v) => handleParamChange("selection", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="random">Random</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="sequential">Sequential</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">Random State</Label>
              <Input
                type="number"
                value={
                  Number(step.params.random_state) || config?.random_state || 42
                }
                onChange={(e) =>
                  handleParamChange("random_state", parseInt(e.target.value))
                }
                className="h-9"
              />
            </div>
          </div>

          <Separator />

          <ChildrenList
            children={children}
            label="Transformers"
            addLabel="Add Transformer"
            emptyLabel="No transformers configured"
            emptySubLabel="Click to add a transformer"
            icon={Zap}
            onSelectStep={onSelectStep}
            onAddChild={onAddChild}
            onRemoveChild={onRemoveChild}
            stepId={step.id}
          />
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

// ============================================================================
// FeatureAugmentationRenderer
// ============================================================================

export function FeatureAugmentationRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepRendererProps) {
  const config = step.featureAugmentationConfig;
  const children = step.children ?? [];

  const handleActionChange = (action: string) => {
    onUpdate(step.id, {
      params: { ...step.params, action },
      featureAugmentationConfig: config
        ? { ...config, action: action as "extend" | "add" | "replace" }
        : undefined,
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30">
            <Layers className="h-5 w-5 text-fuchsia-500" />
            <div>
              <h4 className="font-medium text-sm">Feature Augmentation</h4>
              <p className="text-xs text-muted-foreground">
                Generate multiple preprocessing channels
              </p>
            </div>
          </div>

          {/* Action Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Action Mode</Label>
            <Select
              value={String(step.params.action || config?.action || "extend")}
              onValueChange={handleActionChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="extend">
                  Extend - Add each as independent channel
                </SelectItem>
                <SelectItem value="add">Add - Chain, keep originals</SelectItem>
                <SelectItem value="replace">
                  Replace - Chain, discard originals
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Generator Options */}
          {config?.orOptions && config.orOptions.length > 0 && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">Generator Options</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Pick</Label>
                    <Input
                      type="text"
                      value={
                        config.pick !== undefined
                          ? Array.isArray(config.pick)
                            ? JSON.stringify(config.pick)
                            : config.pick
                          : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const parsed = v.startsWith("[")
                          ? JSON.parse(v)
                          : parseInt(v) || undefined;
                        onUpdate(step.id, {
                          featureAugmentationConfig: { ...config, pick: parsed },
                        });
                      }}
                      className="h-8"
                      placeholder="e.g., 2 or [1,3]"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      Count
                    </Label>
                    <Input
                      type="number"
                      value={config.count || ""}
                      onChange={(e) => {
                        onUpdate(step.id, {
                          featureAugmentationConfig: {
                            ...config,
                            count: parseInt(e.target.value) || undefined,
                          },
                        });
                      }}
                      className="h-8"
                      placeholder="Limit variants"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          <ChildrenList
            children={children}
            label="Transforms"
            addLabel="Add Transform"
            emptyLabel="No transforms configured"
            emptySubLabel="Click to add a transform"
            icon={Layers}
            onSelectStep={onSelectStep}
            onAddChild={onAddChild}
            onRemoveChild={onRemoveChild}
            stepId={step.id}
          />
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

// ============================================================================
// SampleFilterRenderer
// ============================================================================

export function SampleFilterRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepRendererProps) {
  const config = step.sampleFilterConfig;
  const children = step.children ?? [];

  const handleModeChange = (mode: string) => {
    onUpdate(step.id, {
      params: { ...step.params, mode },
      sampleFilterConfig: config
        ? { ...config, mode: mode as "any" | "all" | "vote" }
        : undefined,
    });
  };

  const handleReportChange = (report: boolean) => {
    onUpdate(step.id, {
      params: { ...step.params, report },
      sampleFilterConfig: config ? { ...config, report } : undefined,
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <Filter className="h-5 w-5 text-red-500" />
            <div>
              <h4 className="font-medium text-sm">Sample Filter</h4>
              <p className="text-xs text-muted-foreground">
                Filter samples with multiple criteria
              </p>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Filter Mode</Label>
              <Select
                value={String(step.params.mode || config?.mode || "any")}
                onValueChange={handleModeChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="any">
                    Any - Remove if any filter triggers
                  </SelectItem>
                  <SelectItem value="all">
                    All - Remove only if all filters trigger
                  </SelectItem>
                  <SelectItem value="vote">
                    Vote - Majority vote decision
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Generate Report</Label>
              </div>
              <Switch
                checked={Boolean(step.params.report ?? config?.report ?? true)}
                onCheckedChange={handleReportChange}
              />
            </div>
          </div>

          <Separator />

          <ChildrenList
            children={children}
            label="Filters"
            addLabel="Add Filter"
            emptyLabel="No filters configured"
            emptySubLabel="Click to add a filter"
            icon={Filter}
            onSelectStep={onSelectStep}
            onAddChild={onAddChild}
            onRemoveChild={onRemoveChild}
            stepId={step.id}
          />
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

// ============================================================================
// ConcatTransformRenderer
// ============================================================================

export function ConcatTransformRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  onSelectStep,
  onAddChild,
  onRemoveChild,
}: StepRendererProps) {
  const children = step.children ?? [];

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-teal-500/10 border border-teal-500/30">
            <Combine className="h-5 w-5 text-teal-500" />
            <div>
              <h4 className="font-medium text-sm">Concat Transform</h4>
              <p className="text-xs text-muted-foreground">
                Concatenate features from multiple transformation branches
              </p>
            </div>
          </div>

          <Separator />

          <ChildrenList
            children={children}
            label="Transforms"
            addLabel="Add Transform"
            emptyLabel="No transforms configured"
            emptySubLabel="Click to add a transform"
            icon={Combine}
            onSelectStep={onSelectStep}
            onAddChild={onAddChild}
            onRemoveChild={onRemoveChild}
            stepId={step.id}
          />
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

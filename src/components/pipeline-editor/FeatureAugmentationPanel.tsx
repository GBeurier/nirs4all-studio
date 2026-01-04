/**
 * Feature Augmentation Panel Component
 *
 * Phase 4: Advanced Pipeline Features
 *
 * Provides UI for configuring feature augmentation - creating multiple
 * preprocessing channels that feed into the model.
 *
 * Key features:
 * - Action mode selection (extend, add, replace)
 * - Transform list management with drag-drop
 * - Visual output shape preview
 * - Integration with step palette for adding transforms
 */

import { useState, useMemo, useCallback } from "react";
import {
  Layers,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Info,
  GripVertical,
  ArrowRight,
  ArrowDown,
  Package,
  Zap,
  Trash2,
  Copy,
  Settings,
  Sparkles,
  Check,
  AlertTriangle,
  Lightbulb,
  RotateCcw,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { stepOptions, stepColors, type PipelineStep, generateStepId, createStepFromOption } from "./types";

// Action modes for feature augmentation
export type FeatureAugmentationAction = "extend" | "add" | "replace";

// Feature augmentation configuration
export interface FeatureAugmentationConfig {
  enabled: boolean;
  action: FeatureAugmentationAction;
  transforms: FeatureAugmentationTransform[];
}

// A single transform in the augmentation list
export interface FeatureAugmentationTransform {
  id: string;
  name: string;
  params: Record<string, string | number | boolean>;
  enabled: boolean;
}

// Default configuration
export function defaultFeatureAugmentationConfig(): FeatureAugmentationConfig {
  return {
    enabled: false,
    action: "extend",
    transforms: [],
  };
}

// Action mode descriptions
const ACTION_DESCRIPTIONS = {
  extend: {
    label: "Extend",
    description: "Add each transform as an independent channel",
    icon: Layers,
    detail: "Each transform creates a new feature set. Original data + N transforms = N+1 channels.",
    example: "Input → [Original, SNV, FirstDeriv] → Model",
  },
  add: {
    label: "Add",
    description: "Chain transforms, keep originals",
    icon: Plus,
    detail: "Apply transforms sequentially on top of existing processing, keeping original features.",
    example: "Input → [Original, Original+SNV, Original+SNV+Deriv] → Model",
  },
  replace: {
    label: "Replace",
    description: "Chain transforms, discard originals",
    icon: ArrowRight,
    detail: "Apply transforms sequentially, only keeping the final processed version.",
    example: "Input → [SNV+Deriv only] → Model",
  },
};

// Common augmentation presets
const AUGMENTATION_PRESETS = [
  {
    name: "NIRS Standard",
    description: "SNV + First Derivative + Second Derivative",
    transforms: [
      { name: "SNV", params: {} },
      { name: "FirstDerivative", params: {} },
      { name: "SecondDerivative", params: {} },
    ],
  },
  {
    name: "Scatter Variants",
    description: "Compare scatter correction methods",
    transforms: [
      { name: "SNV", params: {} },
      { name: "MSC", params: { reference: "mean" } },
      { name: "RobustSNV", params: {} },
    ],
  },
  {
    name: "Derivative Comparison",
    description: "Different derivative approaches",
    transforms: [
      { name: "FirstDerivative", params: {} },
      { name: "SavitzkyGolay", params: { window_length: 11, polyorder: 2, deriv: 1 } },
      { name: "SavitzkyGolay", params: { window_length: 21, polyorder: 3, deriv: 1 } },
    ],
  },
  {
    name: "Smoothing Levels",
    description: "Compare different smoothing intensities",
    transforms: [
      { name: "SavitzkyGolay", params: { window_length: 7, polyorder: 2, deriv: 0 } },
      { name: "SavitzkyGolay", params: { window_length: 15, polyorder: 2, deriv: 0 } },
      { name: "Gaussian", params: { sigma: 2 } },
    ],
  },
];

interface FeatureAugmentationPanelProps {
  config: FeatureAugmentationConfig;
  onChange: (config: FeatureAugmentationConfig) => void;
  className?: string;
  compact?: boolean;
}

/**
 * FeatureAugmentationPanel - Main panel for configuring feature augmentation
 */
export function FeatureAugmentationPanel({
  config,
  onChange,
  className,
  compact = false,
}: FeatureAugmentationPanelProps) {
  const [showAddDialog, setShowAddDialog] = useState(false);

  const handleToggle = (enabled: boolean) => {
    onChange({ ...config, enabled });
  };

  const handleActionChange = (action: FeatureAugmentationAction) => {
    onChange({ ...config, action });
  };

  const handleAddTransform = (name: string, params: Record<string, string | number | boolean>) => {
    const newTransform: FeatureAugmentationTransform = {
      id: generateStepId(),
      name,
      params,
      enabled: true,
    };
    onChange({
      ...config,
      transforms: [...config.transforms, newTransform],
    });
  };

  const handleRemoveTransform = (id: string) => {
    onChange({
      ...config,
      transforms: config.transforms.filter((t) => t.id !== id),
    });
  };

  const handleToggleTransform = (id: string, enabled: boolean) => {
    onChange({
      ...config,
      transforms: config.transforms.map((t) =>
        t.id === id ? { ...t, enabled } : t
      ),
    });
  };

  const handleUpdateTransformParams = (
    id: string,
    params: Record<string, string | number | boolean>
  ) => {
    onChange({
      ...config,
      transforms: config.transforms.map((t) =>
        t.id === id ? { ...t, params } : t
      ),
    });
  };

  const handleApplyPreset = (preset: typeof AUGMENTATION_PRESETS[0]) => {
    const newTransforms: FeatureAugmentationTransform[] = preset.transforms.map((t) => {
      const cleanParams: Record<string, string | number | boolean> = {};
      for (const [key, value] of Object.entries(t.params)) {
        if (value !== undefined) {
          cleanParams[key] = value;
        }
      }
      return {
        id: generateStepId(),
        name: t.name,
        params: cleanParams,
        enabled: true,
      };
    });
    onChange({
      ...config,
      enabled: true,
      transforms: newTransforms,
    });
  };

  const handleClearAll = () => {
    onChange({ ...config, transforms: [] });
  };

  const activeTransforms = config.transforms.filter((t) => t.enabled);
  const outputChannels = config.action === "replace" ? 1 : activeTransforms.length + 1;

  if (compact) {
    return (
      <FeatureAugmentationCompact
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
                ? "bg-indigo-500/20 text-indigo-500"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              Feature Augmentation
              {config.enabled && activeTransforms.length > 0 && (
                <Badge className="text-[10px] px-1.5 h-4 bg-indigo-500">
                  {activeTransforms.length} transforms
                </Badge>
              )}
            </h3>
            <p className="text-xs text-muted-foreground">
              Generate multiple preprocessing variants
            </p>
          </div>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={handleToggle}
          className="data-[state=checked]:bg-indigo-500"
        />
      </div>

      {/* Content - show when enabled */}
      {config.enabled && (
        <div className="space-y-4 pl-2 border-l-2 border-indigo-500/30">
          {/* Action Mode Selection */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Action Mode</Label>
            <RadioGroup
              value={config.action}
              onValueChange={(v: string) => handleActionChange(v as FeatureAugmentationAction)}
              className="grid grid-cols-3 gap-2"
            >
              {(Object.entries(ACTION_DESCRIPTIONS) as [FeatureAugmentationAction, typeof ACTION_DESCRIPTIONS.extend][]).map(
                ([action, desc]) => {
                  const Icon = desc.icon;
                  const isSelected = config.action === action;
                  return (
                    <label
                      key={action}
                      className={cn(
                        "flex flex-col items-center gap-1.5 p-2 rounded-lg border cursor-pointer transition-all",
                        isSelected
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-border hover:border-indigo-500/50 hover:bg-muted/50"
                      )}
                    >
                      <RadioGroupItem value={action} className="sr-only" />
                      <Icon
                        className={cn(
                          "h-4 w-4",
                          isSelected ? "text-indigo-500" : "text-muted-foreground"
                        )}
                      />
                      <span
                        className={cn(
                          "text-xs font-medium",
                          isSelected ? "text-indigo-500" : "text-foreground"
                        )}
                      >
                        {desc.label}
                      </span>
                    </label>
                  );
                }
              )}
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              {ACTION_DESCRIPTIONS[config.action].description}
            </p>
          </div>

          <Separator />

          {/* Transforms List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Transforms</Label>
              <div className="flex items-center gap-1">
                {config.transforms.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={handleClearAll}
                  >
                    Clear all
                  </Button>
                )}
                <AddTransformDialog
                  onAdd={handleAddTransform}
                  trigger={
                    <Button variant="outline" size="sm" className="h-6 px-2 text-xs gap-1">
                      <Plus className="h-3 w-3" />
                      Add
                    </Button>
                  }
                />
              </div>
            </div>

            {config.transforms.length === 0 ? (
              <div className="text-center py-6 border border-dashed rounded-lg">
                <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground mb-2">
                  No transforms added yet
                </p>
                <AddTransformDialog
                  onAdd={handleAddTransform}
                  trigger={
                    <Button variant="outline" size="sm" className="gap-1">
                      <Plus className="h-3.5 w-3.5" />
                      Add Transform
                    </Button>
                  }
                />
              </div>
            ) : (
              <div className="space-y-2">
                {config.transforms.map((transform, index) => (
                  <TransformItem
                    key={transform.id}
                    transform={transform}
                    index={index}
                    onToggle={(enabled) => handleToggleTransform(transform.id, enabled)}
                    onRemove={() => handleRemoveTransform(transform.id)}
                    onUpdateParams={(params) =>
                      handleUpdateTransformParams(transform.id, params)
                    }
                  />
                ))}
              </div>
            )}
          </div>

          {/* Quick Presets */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Presets</Label>
            <div className="grid grid-cols-2 gap-2">
              {AUGMENTATION_PRESETS.map((preset) => (
                <Button
                  key={preset.name}
                  variant="outline"
                  size="sm"
                  className="h-auto py-2 justify-start text-left"
                  onClick={() => handleApplyPreset(preset)}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-medium">{preset.name}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {preset.description}
                    </span>
                  </div>
                </Button>
              ))}
            </div>
          </div>

          <Separator />

          {/* Output Preview */}
          <FeatureAugmentationPreview
            transforms={activeTransforms}
            action={config.action}
          />
        </div>
      )}

      {/* Disabled state info */}
      {!config.enabled && (
        <div className="text-center py-4 text-muted-foreground">
          <p className="text-xs">
            Enable to generate multiple preprocessing channels
          </p>
          <p className="text-[10px] mt-1 text-muted-foreground/70">
            Useful for ensemble methods or comparing preprocessing approaches
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Single transform item in the list
 */
interface TransformItemProps {
  transform: FeatureAugmentationTransform;
  index: number;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onUpdateParams: (params: Record<string, string | number | boolean>) => void;
}

function TransformItem({
  transform,
  index,
  onToggle,
  onRemove,
  onUpdateParams,
}: TransformItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayParams = Object.entries(transform.params)
    .slice(0, 2)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        transform.enabled
          ? "border-indigo-500/30 bg-indigo-500/5"
          : "border-muted bg-muted/20 opacity-60"
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <div className="p-1 cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] px-1 h-4 tabular-nums">
              {index + 1}
            </Badge>
            <span className="font-medium text-sm truncate">{transform.name}</span>
          </div>
          {displayParams && (
            <p className="text-[10px] text-muted-foreground font-mono truncate mt-0.5">
              {displayParams}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1">
          {Object.keys(transform.params).length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </Button>
          )}
          <Switch
            checked={transform.enabled}
            onCheckedChange={onToggle}
            className="scale-75 data-[state=checked]:bg-indigo-500"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Expanded params */}
      {isExpanded && Object.keys(transform.params).length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
          {Object.entries(transform.params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs w-24 capitalize text-muted-foreground">
                {key.replace(/_/g, " ")}
              </Label>
              <Input
                type={typeof value === "number" ? "number" : "text"}
                value={typeof value === "boolean" ? String(value) : value}
                onChange={(e) => {
                  const newValue =
                    typeof value === "number"
                      ? parseFloat(e.target.value) || 0
                      : e.target.value;
                  onUpdateParams({ ...transform.params, [key]: newValue });
                }}
                className="h-7 text-xs font-mono flex-1"
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Dialog for adding a new transform
 */
interface AddTransformDialogProps {
  onAdd: (name: string, params: Record<string, string | number | boolean>) => void;
  trigger: React.ReactNode;
}

function AddTransformDialog({ onAdd, trigger }: AddTransformDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedTransform, setSelectedTransform] = useState<string>("");

  const preprocessingOptions = stepOptions.preprocessing;

  const handleAdd = () => {
    if (!selectedTransform) return;
    const option = preprocessingOptions.find((o) => o.name === selectedTransform);
    if (option) {
      onAdd(option.name, { ...option.defaultParams });
      setSelectedTransform("");
      setOpen(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Add Transform</DialogTitle>
          <DialogDescription>
            Select a preprocessing transform to add to the augmentation chain.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={selectedTransform} onValueChange={setSelectedTransform}>
            <SelectTrigger>
              <SelectValue placeholder="Select a transform..." />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {/* Group by category */}
              {Array.from(
                new Set(preprocessingOptions.map((o) => o.category || "Other"))
              ).map((category) => (
                <SelectGroup key={category}>
                  <SelectLabel>{category}</SelectLabel>
                  {preprocessingOptions
                    .filter((o) => (o.category || "Other") === category)
                    .map((opt) => (
                      <SelectItem key={opt.name} value={opt.name}>
                        <div className="flex flex-col">
                          <span className="font-medium">{opt.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {opt.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!selectedTransform}
            className="bg-indigo-500 hover:bg-indigo-600"
          >
            Add Transform
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Visual preview of feature augmentation output
 */
interface FeatureAugmentationPreviewProps {
  transforms: FeatureAugmentationTransform[];
  action: FeatureAugmentationAction;
}

function FeatureAugmentationPreview({
  transforms,
  action,
}: FeatureAugmentationPreviewProps) {
  const getOutputDescription = () => {
    const n = transforms.length;
    if (n === 0) return { channels: 1, description: "No transforms - original only" };

    switch (action) {
      case "extend":
        return {
          channels: n + 1,
          description: `Original + ${n} transform${n !== 1 ? "s" : ""} = ${n + 1} channels`,
        };
      case "add":
        return {
          channels: n + 1,
          description: `Cumulative: Original, +T1, +T1+T2, ... = ${n + 1} channels`,
        };
      case "replace":
        return {
          channels: 1,
          description: `Sequential processing: T1 → T2 → ... → T${n}`,
        };
    }
  };

  const output = getOutputDescription();

  return (
    <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/20 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <span className="text-sm font-medium">Output Preview</span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          Input: (n, D)
        </Badge>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <Badge className="font-mono bg-indigo-500">
          Output: (n, {output.channels}, D)
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{output.description}</p>

      {transforms.length > 0 && action !== "replace" && (
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge variant="secondary" className="text-[10px]">
            Original
          </Badge>
          {transforms.map((t, i) => (
            <Badge
              key={t.id}
              variant="outline"
              className="text-[10px] border-indigo-500/50"
            >
              {action === "add" && i > 0 ? "+" : ""}
              {t.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Compact version for inline use
 */
interface FeatureAugmentationCompactProps {
  config: FeatureAugmentationConfig;
  onChange: (config: FeatureAugmentationConfig) => void;
  className?: string;
}

export function FeatureAugmentationCompact({
  config,
  onChange,
  className,
}: FeatureAugmentationCompactProps) {
  const activeCount = config.transforms.filter((t) => t.enabled).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={config.enabled ? "default" : "outline"}
          size="sm"
          className={cn(
            "h-8 gap-2",
            config.enabled && "bg-indigo-500 hover:bg-indigo-600",
            className
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>feature_augmentation</span>
          {config.enabled && activeCount > 0 && (
            <Badge variant="secondary" className="ml-1 text-[10px] px-1 h-4">
              {activeCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96" align="start">
        <FeatureAugmentationPanel config={config} onChange={onChange} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Feature Augmentation Badge for pipeline tree
 */
interface FeatureAugmentationBadgeProps {
  config: FeatureAugmentationConfig;
  onClick?: () => void;
  className?: string;
}

export function FeatureAugmentationBadge({
  config,
  onClick,
  className,
}: FeatureAugmentationBadgeProps) {
  if (!config.enabled) return null;

  const activeCount = config.transforms.filter((t) => t.enabled).length;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          className={cn(
            "text-[10px] px-1.5 py-0 h-5 bg-indigo-500 hover:bg-indigo-600 cursor-pointer gap-1",
            className
          )}
          onClick={onClick}
        >
          <Layers className="h-3 w-3" />
          {activeCount} aug
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs">
          <div className="font-semibold">Feature Augmentation</div>
          <p className="text-muted-foreground">
            {activeCount} transforms ({ACTION_DESCRIPTIONS[config.action].label} mode)
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

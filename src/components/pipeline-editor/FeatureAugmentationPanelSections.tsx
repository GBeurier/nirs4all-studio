import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Layers,
  Package,
  Plus,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  FeatureAugmentationAction,
  FeatureAugmentationTransform,
} from "./featureAugmentationConfig";
import {
  AUGMENTATION_PRESETS,
  FEATURE_AUGMENTATION_ACTION_DETAILS,
  coerceFeatureAugmentationParamValue,
  formatFeatureAugmentationParamsPreview,
  getFeatureAugmentationOutputPreview,
  groupStepOptionsByCategory,
  type FeatureAugmentationPreset,
} from "./featureAugmentationPanelData";
import { stepOptions } from "./stepOptions";

const ACTION_ICONS: Record<FeatureAugmentationAction, LucideIcon> = {
  extend: Layers,
  add: Plus,
  replace: ArrowRight,
};

type FeatureAugmentationActionEntry = [
  FeatureAugmentationAction,
  typeof FEATURE_AUGMENTATION_ACTION_DETAILS.extend,
];

const ACTION_ENTRIES = Object.entries(
  FEATURE_AUGMENTATION_ACTION_DETAILS,
) as FeatureAugmentationActionEntry[];

interface FeatureAugmentationHeaderProps {
  enabled: boolean;
  activeCount: number;
  onToggle: (enabled: boolean) => void;
}

export function FeatureAugmentationHeader({
  enabled,
  activeCount,
  onToggle,
}: FeatureAugmentationHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg transition-colors",
            enabled
              ? "bg-indigo-500/20 text-indigo-500"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            Feature Augmentation
            {enabled && activeCount > 0 && (
              <Badge className="text-[10px] px-1.5 h-4 bg-indigo-500">
                {activeCount} transforms
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            Generate multiple preprocessing variants
          </p>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-indigo-500"
      />
    </div>
  );
}

interface FeatureAugmentationActionModeSectionProps {
  action: FeatureAugmentationAction;
  onActionChange: (action: FeatureAugmentationAction) => void;
}

export function FeatureAugmentationActionModeSection({
  action,
  onActionChange,
}: FeatureAugmentationActionModeSectionProps) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Action Mode</Label>
      <RadioGroup
        value={action}
        onValueChange={(value: string) =>
          onActionChange(value as FeatureAugmentationAction)
        }
        className="grid grid-cols-3 gap-2"
      >
        {ACTION_ENTRIES.map(([actionValue, desc]) => {
          const Icon = ACTION_ICONS[actionValue];
          const isSelected = action === actionValue;
          return (
            <label
              key={actionValue}
              className={cn(
                "flex flex-col items-center gap-1.5 p-2 rounded-lg border cursor-pointer transition-all",
                isSelected
                  ? "border-indigo-500 bg-indigo-500/10"
                  : "border-border hover:border-indigo-500/50 hover:bg-muted/50",
              )}
            >
              <RadioGroupItem value={actionValue} className="sr-only" />
              <Icon
                className={cn(
                  "h-4 w-4",
                  isSelected ? "text-indigo-500" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isSelected ? "text-indigo-500" : "text-foreground",
                )}
              >
                {desc.label}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {FEATURE_AUGMENTATION_ACTION_DETAILS[action].description}
      </p>
    </div>
  );
}

interface FeatureAugmentationTransformsSectionProps {
  transforms: FeatureAugmentationTransform[];
  onAddTransform: (name: string, params: Record<string, unknown>) => void;
  onClearAll: () => void;
  onRemoveTransform: (id: string) => void;
  onToggleTransform: (id: string, enabled: boolean) => void;
  onUpdateTransformParams: (
    id: string,
    params: Record<string, unknown>,
  ) => void;
}

export function FeatureAugmentationTransformsSection({
  transforms,
  onAddTransform,
  onClearAll,
  onRemoveTransform,
  onToggleTransform,
  onUpdateTransformParams,
}: FeatureAugmentationTransformsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Transforms</Label>
        <div className="flex items-center gap-1">
          {transforms.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onClearAll}
            >
              Clear all
            </Button>
          )}
          <AddTransformDialog
            onAdd={onAddTransform}
            trigger={
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs gap-1"
              >
                <Plus className="h-3 w-3" />
                Add
              </Button>
            }
          />
        </div>
      </div>

      {transforms.length === 0 ? (
        <div className="text-center py-6 border border-dashed rounded-lg">
          <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-2">
            No transforms added yet
          </p>
          <AddTransformDialog
            onAdd={onAddTransform}
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
          {transforms.map((transform, index) => (
            <TransformItem
              key={transform.id}
              transform={transform}
              index={index}
              onToggle={(enabled) =>
                onToggleTransform(transform.id, enabled)
              }
              onRemove={() => onRemoveTransform(transform.id)}
              onUpdateParams={(params) =>
                onUpdateTransformParams(transform.id, params)
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FeatureAugmentationQuickPresetsProps {
  onApplyPreset: (preset: FeatureAugmentationPreset) => void;
}

export function FeatureAugmentationQuickPresets({
  onApplyPreset,
}: FeatureAugmentationQuickPresetsProps) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">Quick Presets</Label>
      <div className="grid grid-cols-2 gap-2">
        {AUGMENTATION_PRESETS.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            className="h-auto py-2 justify-start text-left"
            onClick={() => onApplyPreset(preset)}
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
  );
}

export function FeatureAugmentationDisabledState() {
  return (
    <div className="text-center py-4 text-muted-foreground">
      <p className="text-xs">
        Enable to generate multiple preprocessing channels
      </p>
      <p className="text-[10px] mt-1 text-muted-foreground/70">
        Useful for ensemble methods or comparing preprocessing approaches
      </p>
    </div>
  );
}

interface TransformItemProps {
  transform: FeatureAugmentationTransform;
  index: number;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onUpdateParams: (params: Record<string, unknown>) => void;
}

function TransformItem({
  transform,
  index,
  onToggle,
  onRemove,
  onUpdateParams,
}: TransformItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const displayParams = formatFeatureAugmentationParamsPreview(
    transform.params,
  );

  return (
    <div
      className={cn(
        "rounded-lg border transition-all",
        transform.enabled
          ? "border-indigo-500/30 bg-indigo-500/5"
          : "border-muted bg-muted/20 opacity-60",
      )}
    >
      <div className="flex items-center gap-2 p-2">
        <div className="p-1 cursor-grab text-muted-foreground hover:text-foreground">
          <GripVertical className="h-3.5 w-3.5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Badge
              variant="secondary"
              className="text-[10px] px-1 h-4 tabular-nums"
            >
              {index + 1}
            </Badge>
            <span className="font-medium text-sm truncate">
              {transform.name}
            </span>
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

      {isExpanded && Object.keys(transform.params).length > 0 && (
        <div className="px-3 pb-3 pt-1 border-t border-border/50 space-y-2">
          {Object.entries(transform.params).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <Label className="text-xs w-24 capitalize text-muted-foreground">
                {key.replace(/_/g, " ")}
              </Label>
              <Input
                type={typeof value === "number" ? "number" : "text"}
                value={
                  typeof value === "boolean"
                    ? String(value)
                    : String(value ?? "")
                }
                onChange={(event) => {
                  const newValue = coerceFeatureAugmentationParamValue(
                    value,
                    event.target.value,
                  );
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

interface AddTransformDialogProps {
  onAdd: (name: string, params: Record<string, unknown>) => void;
  trigger: ReactNode;
}

function AddTransformDialog({ onAdd, trigger }: AddTransformDialogProps) {
  const [open, setOpen] = useState(false);
  const [selectedTransform, setSelectedTransform] = useState<string>("");

  const preprocessingOptions = stepOptions.preprocessing;
  const optionsByCategory = groupStepOptionsByCategory(preprocessingOptions);

  const handleAdd = () => {
    if (!selectedTransform) return;
    const option = preprocessingOptions.find(
      (preprocessingOption) => preprocessingOption.name === selectedTransform,
    );
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
              {optionsByCategory.map(({ category, options }) => (
                <SelectGroup key={category}>
                  <SelectLabel>{category}</SelectLabel>
                  {options.map((option) => (
                    <SelectItem key={option.name} value={option.name}>
                      <div className="flex flex-col">
                        <span className="font-medium">{option.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
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

interface FeatureAugmentationPreviewProps {
  transforms: FeatureAugmentationTransform[];
  action: FeatureAugmentationAction;
}

export function FeatureAugmentationPreview({
  transforms,
  action,
}: FeatureAugmentationPreviewProps) {
  const output = getFeatureAugmentationOutputPreview(action, transforms);

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
          {transforms.map((transform, index) => (
            <Badge
              key={transform.id}
              variant="outline"
              className="text-[10px] border-indigo-500/50"
            >
              {action === "add" && index > 0 ? "+" : ""}
              {transform.name}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
            {t("pipelineEditor.augmentation.title")}
            {enabled && activeCount > 0 && (
              <Badge className="text-[10px] px-1.5 h-4 bg-indigo-500">
                {t("pipelineEditor.augmentation.transformsCount", { count: activeCount })}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("pipelineEditor.augmentation.subtitle")}
          </p>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        aria-label={t("pipelineEditor.augmentation.toggle")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">{t("pipelineEditor.augmentation.actionMode")}</Label>
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
                {t(desc.labelKey)}
              </span>
            </label>
          );
        })}
      </RadioGroup>
      <p className="text-xs text-muted-foreground">
        {t(FEATURE_AUGMENTATION_ACTION_DETAILS[action].descriptionKey)}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("pipelineEditor.augmentation.transforms")}</Label>
        <div className="flex items-center gap-1">
          {transforms.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={onClearAll}
            >
              {t("pipelineEditor.augmentation.clearAll")}
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
                {t("common.add")}
              </Button>
            }
          />
        </div>
      </div>

      {transforms.length === 0 ? (
        <div className="text-center py-6 border border-dashed rounded-lg">
          <Package className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground mb-2">
            {t("pipelineEditor.augmentation.noTransforms")}
          </p>
          <AddTransformDialog
            onAdd={onAddTransform}
            trigger={
              <Button variant="outline" size="sm" className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                {t("pipelineEditor.augmentation.addTransform")}
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
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground">{t("pipelineEditor.augmentation.quickPresets")}</Label>
      <div className="grid grid-cols-2 gap-2">
        {AUGMENTATION_PRESETS.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            className="h-auto py-2 justify-start text-left"
            onClick={() => onApplyPreset(preset)}
          >
            <div className="flex flex-col">
              <span className="text-xs font-medium">{t(`pipelineEditor.augmentation.presets.${preset.id}.name`)}</span>
              <span className="text-[10px] text-muted-foreground">
                {t(`pipelineEditor.augmentation.presets.${preset.id}.description`)}
              </span>
            </div>
          </Button>
        ))}
      </div>
    </div>
  );
}

export function FeatureAugmentationDisabledState() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-4 text-muted-foreground">
      <p className="text-xs">{t("pipelineEditor.augmentation.disabled.title")}</p>
      <p className="text-[10px] mt-1 text-muted-foreground/70">
        {t("pipelineEditor.augmentation.disabled.hint")}
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
  const { t } = useTranslation();
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
        <div
          className="p-1 cursor-grab text-muted-foreground hover:text-foreground"
          title={t("pipelineEditor.augmentation.dragToReorder")}
        >
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
              aria-label={isExpanded ? t("pipelineEditor.augmentation.hideParameters") : t("pipelineEditor.augmentation.showParameters")}
              aria-expanded={isExpanded}
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
            aria-label={t("pipelineEditor.augmentation.toggleTransform", { name: transform.name })}
            className="scale-75 data-[state=checked]:bg-indigo-500"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            aria-label={t("pipelineEditor.augmentation.removeTransform", { name: transform.name })}
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
  const { t } = useTranslation();
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
          <DialogTitle>{t("pipelineEditor.augmentation.addTransform")}</DialogTitle>
          <DialogDescription>
            {t("pipelineEditor.augmentation.addDialogDescription")}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <Select value={selectedTransform} onValueChange={setSelectedTransform}>
            <SelectTrigger>
              <SelectValue placeholder={t("pipelineEditor.augmentation.selectTransform")} />
            </SelectTrigger>
            <SelectContent className="max-h-[300px]">
              {optionsByCategory.map(({ category, options }) => (
                <SelectGroup key={category}>
                  <SelectLabel>{category === "Other" ? t("pipelineEditor.augmentation.otherCategory") : category}</SelectLabel>
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
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleAdd}
            disabled={!selectedTransform}
            className="bg-indigo-500 hover:bg-indigo-600"
          >
            {t("pipelineEditor.augmentation.addTransform")}
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
  const { t } = useTranslation();
  const output = getFeatureAugmentationOutputPreview(action, transforms);

  return (
    <div className="p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/20 space-y-2">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-indigo-500" />
        <span className="text-sm font-medium">{t("pipelineEditor.augmentation.outputPreview")}</span>
      </div>

      <div className="flex items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {t("pipelineEditor.augmentation.inputShape")}
        </Badge>
        <ArrowRight className="h-3 w-3 text-muted-foreground" />
        <Badge className="font-mono bg-indigo-500">
          {t("pipelineEditor.augmentation.outputShape", { channels: output.channels })}
        </Badge>
      </div>

      <p className="text-xs text-muted-foreground">{output.description}</p>

      {transforms.length > 0 && action !== "replace" && (
        <div className="flex flex-wrap gap-1 mt-2">
          <Badge variant="secondary" className="text-[10px]">
            {t("pipelineEditor.augmentation.original")}
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

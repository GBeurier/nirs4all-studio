import { useTranslation } from "react-i18next";
import {
  ArrowDown,
  Boxes,
  ChevronDown,
  ChevronUp,
  Combine,
  EyeOff,
  Lightbulb,
  Puzzle,
  RotateCcw,
  Target,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { StackingConfig } from "./stackingConfig";
import {
  coerceStackingNumberInput,
  coerceStackingParamValue,
  getStackingParamInputStep,
  getStackingParamInputValue,
  getVisibleStackingBaseModelCount,
  isStackingSourceSelected,
  META_MODEL_CATEGORIES,
  META_MODEL_CATEGORY_LABEL_KEYS,
  META_MODEL_OPTIONS,
  type AvailableStackingModel,
  type MetaModelOption,
} from "./StackingPanelData";

const COVERAGE_STRATEGIES = {
  drop: {
    labelKey: "pipelineEditor.stacking.coverage.drop.label",
    descriptionKey: "pipelineEditor.stacking.coverage.drop.description",
    icon: EyeOff,
  },
  fill: {
    labelKey: "pipelineEditor.stacking.coverage.fill.label",
    descriptionKey: "pipelineEditor.stacking.coverage.fill.description",
    icon: Puzzle,
  },
  model: {
    labelKey: "pipelineEditor.stacking.coverage.model.label",
    descriptionKey: "pipelineEditor.stacking.coverage.model.description",
    icon: Target,
  },
} satisfies Record<
  StackingConfig["coverageStrategy"],
  { labelKey: string; descriptionKey: string; icon: LucideIcon }
>;

interface StackingPanelHeaderProps {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}

export function StackingPanelHeader({
  enabled,
  onToggle,
}: StackingPanelHeaderProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg transition-colors",
            enabled
              ? "bg-pink-500/20 text-pink-500"
              : "bg-muted text-muted-foreground",
          )}
        >
          <Boxes className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            {t("pipelineEditor.stacking.title")}
            {enabled && (
              <Badge className="text-[10px] px-1.5 h-4 bg-pink-500">
                {t("pipelineEditor.stacking.metaModelBadge")}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("pipelineEditor.stacking.subtitle")}
          </p>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        aria-label={t("pipelineEditor.stacking.toggle")}
        className="data-[state=checked]:bg-pink-500"
      />
    </div>
  );
}

interface StackingDiagramProps {
  sourceCount: number;
  metaModel: string;
  passthrough: boolean;
}

export function StackingDiagram({
  sourceCount,
  metaModel,
  passthrough,
}: StackingDiagramProps) {
  const { t } = useTranslation();
  const baseModels = getVisibleStackingBaseModelCount(sourceCount);

  return (
    <div className="p-3 rounded-lg bg-muted/30 border border-border">
      <div className="flex flex-col items-center gap-2">
        <div className="flex items-center gap-2">
          {Array.from({ length: baseModels }).map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-1">
              <div className="p-2 rounded-lg bg-emerald-500/20 border border-emerald-500/30">
                <Target className="h-4 w-4 text-emerald-500" />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {t("pipelineEditor.stacking.diagram.model", { n: index + 1 })}
              </span>
            </div>
          ))}
          {sourceCount > 4 && (
            <div className="flex flex-col items-center gap-1">
              <div className="p-2 rounded-lg bg-muted border border-border">
                <span className="text-xs text-muted-foreground">
                  +{sourceCount - 4}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {Array.from({ length: baseModels }).map((_, index) => (
            <ArrowDown key={index} className="h-4 w-4 text-muted-foreground" />
          ))}
        </div>

        <div className="flex items-center gap-2 py-1 px-3 rounded-full bg-muted border border-border">
          <Combine className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs">{t("pipelineEditor.stacking.diagram.oofPredictions")}</span>
          {passthrough && (
            <>
              <span className="text-muted-foreground">+</span>
              <span className="text-xs">X</span>
            </>
          )}
        </div>

        <ArrowDown className="h-4 w-4 text-muted-foreground" />

        <div className="flex flex-col items-center gap-1">
          <div className="p-2 rounded-lg bg-pink-500/20 border border-pink-500/30">
            <Boxes className="h-4 w-4 text-pink-500" />
          </div>
          <span className="text-xs font-medium text-pink-500">{metaModel}</span>
          <Badge variant="secondary" className="text-[10px] px-1 h-4">
            {t("pipelineEditor.stacking.metaModel")}
          </Badge>
        </div>
      </div>
    </div>
  );
}

interface SourceModelsSelectionProps {
  availableModels: readonly AvailableStackingModel[];
  isUsingAllSources: boolean;
  sourceModels: readonly string[];
  onUseAllSources: () => void;
  onSourceToggle: (id: string, checked: boolean) => void;
}

export function SourceModelsSelection({
  availableModels,
  isUsingAllSources,
  sourceModels,
  onUseAllSources,
  onSourceToggle,
}: SourceModelsSelectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("pipelineEditor.stacking.baseModels")}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onUseAllSources}
          disabled={isUsingAllSources}
        >
          {t("pipelineEditor.stacking.useAll")}
        </Button>
      </div>

      <div className="space-y-2">
        {availableModels.map((model) => {
          const isSelected = isStackingSourceSelected(sourceModels, model.id);
          return (
            <label
              key={model.id}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg border cursor-pointer transition-all",
                isSelected
                  ? "border-pink-500/50 bg-pink-500/5"
                  : "border-border hover:border-pink-500/30",
              )}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked) =>
                  onSourceToggle(model.id, checked as boolean)
                }
                disabled={isUsingAllSources}
                className="data-[state=checked]:bg-pink-500 data-[state=checked]:border-pink-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Target className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-sm font-medium truncate">
                    {model.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] px-1 h-4">
                    {model.type}
                  </Badge>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

interface MetaModelSelectionProps {
  value: string;
  selectedMetaModel: MetaModelOption | undefined;
  onMetaModelChange: (name: string) => void;
}

export function MetaModelSelection({
  value,
  selectedMetaModel,
  onMetaModelChange,
}: MetaModelSelectionProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">{t("pipelineEditor.stacking.metaModel")}</Label>
      <Select value={value} onValueChange={onMetaModelChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover max-h-[300px]">
          {META_MODEL_CATEGORIES.map((category) => (
            <SelectGroup key={category}>
              <SelectLabel>{t(META_MODEL_CATEGORY_LABEL_KEYS[category])}</SelectLabel>
              {META_MODEL_OPTIONS.filter((model) => model.category === category).map(
                (model) => (
                  <SelectItem key={model.name} value={model.name}>
                    <div className="flex items-center gap-2">
                      <span>{model.icon}</span>
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {t(model.descriptionKey)}
                        </span>
                      </div>
                    </div>
                  </SelectItem>
                ),
              )}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
      {selectedMetaModel && (
        <p className="text-xs text-muted-foreground">
          {t(selectedMetaModel.descriptionKey)}
        </p>
      )}
    </div>
  );
}

interface MetaModelParametersProps {
  defaultParams: Record<string, unknown>;
  params: Record<string, unknown>;
  onReset: () => void;
  onParamChange: (key: string, value: unknown) => void;
}

export function MetaModelParameters({
  defaultParams,
  params,
  onReset,
  onParamChange,
}: MetaModelParametersProps) {
  const { t } = useTranslation();
  const paramEntries = Object.entries(defaultParams);
  if (paramEntries.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("pipelineEditor.stacking.parameters")}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onReset}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {t("common.reset")}
        </Button>
      </div>
      {paramEntries.map(([key, defaultValue]) => (
        <div key={key} className="flex items-center gap-3">
          <Label className="text-xs w-24 capitalize text-muted-foreground">
            {key.replace(/_/g, " ")}
          </Label>
          {key === "kernel" ? (
            <Select
              value={getStackingParamInputValue(params, key, defaultValue)}
              onValueChange={(value: string) => onParamChange(key, value)}
            >
              <SelectTrigger className="h-8 flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="rbf">RBF</SelectItem>
                <SelectItem value="linear">{t("pipelineEditor.stacking.kernels.linear")}</SelectItem>
                <SelectItem value="poly">{t("pipelineEditor.stacking.kernels.poly")}</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={typeof defaultValue === "number" ? "number" : "text"}
              value={getStackingParamInputValue(params, key, defaultValue)}
              onChange={(event) =>
                onParamChange(
                  key,
                  coerceStackingParamValue(defaultValue, event.target.value),
                )
              }
              step={getStackingParamInputStep(defaultValue)}
              className="h-8 font-mono text-sm flex-1"
            />
          )}
        </div>
      ))}
    </div>
  );
}

interface AdvancedStackingOptionsProps {
  config: StackingConfig;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCoverageStrategyChange: (
    coverageStrategy: StackingConfig["coverageStrategy"],
  ) => void;
  onFillValueChange: (fillValue: number) => void;
  onPassthroughChange: (passthrough: boolean) => void;
}

export function AdvancedStackingOptions({
  config,
  isOpen,
  onOpenChange,
  onCoverageStrategyChange,
  onFillValueChange,
  onPassthroughChange,
}: AdvancedStackingOptionsProps) {
  const { t } = useTranslation();
  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="w-full justify-between h-8 px-2">
          <span className="text-xs text-muted-foreground">
            {t("pipelineEditor.stacking.advancedOptions")}
          </span>
          {isOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground">
            {t("pipelineEditor.stacking.coverageStrategy")}
          </Label>
          <RadioGroup
            value={config.coverageStrategy}
            onValueChange={(value) =>
              onCoverageStrategyChange(
                value as StackingConfig["coverageStrategy"],
              )
            }
            className="space-y-1"
          >
            {Object.entries(COVERAGE_STRATEGIES).map(([strategy, desc]) => {
              const Icon = desc.icon;
              return (
                <label
                  key={strategy}
                  className="flex items-center gap-2 p-2 rounded border border-border hover:border-pink-500/30 cursor-pointer"
                >
                  <RadioGroupItem
                    value={strategy}
                    className="data-[state=checked]:border-pink-500 data-[state=checked]:text-pink-500"
                  />
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{t(desc.labelKey)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t(desc.descriptionKey)}
                    </div>
                  </div>
                </label>
              );
            })}
          </RadioGroup>

          {config.coverageStrategy === "fill" && (
            <div className="flex items-center gap-2 pl-6">
              <Label className="text-xs">{t("pipelineEditor.stacking.fillValue")}</Label>
              <Input
                type="number"
                value={config.fillValue ?? 0}
                onChange={(event) =>
                  onFillValueChange(
                    coerceStackingNumberInput(event.target.value),
                  )
                }
                className="h-7 w-24 font-mono text-xs"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-2 rounded border border-border">
          <div className="flex items-center gap-2">
            <Combine className="h-4 w-4 text-muted-foreground" />
            <div>
              <Label className="text-xs font-medium">
                {t("pipelineEditor.stacking.featurePassthrough")}
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {t("pipelineEditor.stacking.featurePassthroughHint")}
              </p>
            </div>
          </div>
          <Switch
            checked={config.passthrough}
            onCheckedChange={onPassthroughChange}
            aria-label={t("pipelineEditor.stacking.featurePassthrough")}
            className="scale-90"
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StackingInfoNote() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-pink-500/5 border border-pink-500/20">
      <Lightbulb className="h-4 w-4 text-pink-500 flex-shrink-0 mt-0.5" />
      <div className="text-xs text-muted-foreground">
        <p className="font-medium text-foreground mb-1">{t("pipelineEditor.stacking.howItWorks.title")}</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>{t("pipelineEditor.stacking.howItWorks.step1")}</li>
          <li>{t("pipelineEditor.stacking.howItWorks.step2")}</li>
          <li>{t("pipelineEditor.stacking.howItWorks.step3")}</li>
        </ol>
      </div>
    </div>
  );
}

export function StackingDisabledState() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-4 text-muted-foreground">
      <p className="text-xs">{t("pipelineEditor.stacking.disabled.title")}</p>
      <p className="text-[10px] mt-1 text-muted-foreground/70">
        {t("pipelineEditor.stacking.disabled.hint")}
      </p>
    </div>
  );
}

/**
 * Y-Processing Panel Sections
 *
 * Presentational sub-components for the Y-processing panel. These render the
 * config and emit value changes through callbacks; they hold no domain logic
 * (that lives in `YProcessingPanelData.ts`) and own no orchestration state
 * (that lives in `YProcessingPanel.tsx`).
 */

import { useTranslation } from "react-i18next";
import {
  BarChart3,
  Info,
  Check,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { cn } from "@/lib/utils";
import { useSelectWheel } from "./shared/useSelectWheel";
import { type YProcessingConfig } from "./yProcessingConfig";
import {
  coerceYProcessingParamValue,
  getYProcessingDefaultParams,
  getYProcessingParamDescription,
  getYProcessingParamInputStep,
  getYProcessingParamSelect,
  groupYProcessingOptionsByCategory,
  type YProcessingOption,
} from "./YProcessingPanelData";

/** Header row: status icon, title + active badge, and the enable switch. */
export function YProcessingHeader({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "p-2 rounded-lg transition-colors",
            enabled
              ? "bg-amber-500/20 text-amber-500"
              : "bg-muted text-muted-foreground"
          )}
        >
          <BarChart3 className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            {t("pipelineEditor.yProcessing.title")}
            {enabled && (
              <Badge className="text-[10px] px-1.5 h-4 bg-amber-500">
                {t("pipelineEditor.yProcessing.active")}
              </Badge>
            )}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("pipelineEditor.yProcessing.subtitle")}
          </p>
        </div>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={onToggle}
        aria-label={t("pipelineEditor.yProcessing.toggleAria")}
        className="data-[state=checked]:bg-amber-500"
      />
    </div>
  );
}

/** Scaler/transformer selector, grouped by category, with a description line. */
export function YProcessingScalerSelect({
  value,
  selectedOption,
  onChange,
}: {
  value: string;
  selectedOption: YProcessingOption | undefined;
  onChange: (scaler: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{t("pipelineEditor.yProcessing.scalerLabel")}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover max-h-[300px]">
          {groupYProcessingOptionsByCategory().map(({ category, options }) => (
            <div key={category}>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-muted/50">
                {t(`pipelineEditor.yProcessing.category.${category}`)}
              </div>
              {options.map((opt) => (
                <SelectItem key={opt.name} value={opt.name}>
                  <div className="flex items-center gap-2">
                    <span>{opt.icon}</span>
                    <div className="flex flex-col">
                      <span className="font-medium">{opt.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {t(opt.descriptionKey)}
                      </span>
                    </div>
                  </div>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
      {selectedOption && (
        <p className="text-xs text-muted-foreground">
          {t(selectedOption.descriptionKey)}
        </p>
      )}
    </div>
  );
}

/** Parameters block: header + reset action + one input per default param. */
export function YProcessingParamsSection({
  option,
  params,
  onParamChange,
  onReset,
}: {
  option: YProcessingOption;
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const defaults = getYProcessingDefaultParams(option);
  if (Object.keys(defaults).length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">{t("pipelineEditor.yProcessing.parameters")}</Label>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={onReset}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          {t("pipelineEditor.yProcessing.reset")}
        </Button>
      </div>
      {Object.entries(defaults).map(([key, defaultValue]) => (
        <YProcessingParamInput
          key={key}
          paramKey={key}
          value={params[key] ?? defaultValue}
          defaultValue={defaultValue}
          description={getYProcessingParamDescription(option, key)}
          onChange={(value) => onParamChange(key, value)}
        />
      ))}
    </div>
  );
}

/** Optional label + help tooltip shown above each param control. */
function YProcessingParamLabel({
  paramKey,
  description,
}: {
  paramKey: string;
  description?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label className="text-xs capitalize">{paramKey.replace(/_/g, " ")}</Label>
      {description && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Info className="h-3 w-3 text-muted-foreground cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-[200px]">
            <p>{description}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

/** A single param control: a fixed-choice select where defined, else a typed input. */
export function YProcessingParamInput({
  paramKey,
  value,
  defaultValue,
  description,
  onChange,
}: {
  paramKey: string;
  value: unknown;
  defaultValue: unknown;
  description?: string;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation();
  const choices = getYProcessingParamSelect(paramKey);
  const handleWheel = useSelectWheel(String(value), (v) => onChange(v), choices ?? [], true);

  if (choices) {
    return (
      <div className="space-y-1.5">
        <YProcessingParamLabel paramKey={paramKey} description={description} />
        <div onWheel={handleWheel}>
          <Select value={String(value ?? "")} onValueChange={onChange}>
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {t(choice.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <YProcessingParamLabel paramKey={paramKey} description={description} />
      <Input
        type={typeof defaultValue === "number" ? "number" : "text"}
        value={typeof value === "boolean" ? String(value) : String(value ?? "")}
        onChange={(e) => onChange(coerceYProcessingParamValue(defaultValue, e.target.value))}
        step={getYProcessingParamInputStep(defaultValue)}
        className="h-8 font-mono text-sm"
      />
    </div>
  );
}

/** "Recommended for" callout listing the selected option's recommendations. */
export function YProcessingRecommendations({ option }: { option: YProcessingOption }) {
  const { t } = useTranslation();
  if (option.recommendationKeys.length === 0) return null;

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <Lightbulb className="h-4 w-4 text-amber-500 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <p className="text-xs font-medium text-foreground mb-1">{t("pipelineEditor.yProcessing.recommendedFor")}</p>
        <ul className="text-xs text-muted-foreground space-y-0.5">
          {option.recommendationKeys.map((recKey) => (
            <li key={recKey} className="flex items-center gap-1">
              <Check className="h-3 w-3 text-amber-500" />
              {t(recKey)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Static note explaining inverse-transform behavior. */
export function YProcessingInfoNote() {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-muted/50">
      <Info className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <p className="text-xs text-muted-foreground">
        {t("pipelineEditor.yProcessing.infoNote")}
      </p>
    </div>
  );
}

/** Placeholder shown when target processing is disabled. */
export function YProcessingDisabledState() {
  const { t } = useTranslation();
  return (
    <div className="text-center py-4 text-muted-foreground">
      <p className="text-xs">
        {t("pipelineEditor.yProcessing.disabledHint")}
      </p>
      <p className="text-[10px] mt-1 text-muted-foreground/70">
        {t("pipelineEditor.yProcessing.disabledRecommendation")}
      </p>
    </div>
  );
}

/** The enabled-content block (everything below the header). */
export function YProcessingBody({
  config,
  selectedOption,
  onScalerChange,
  onParamChange,
  onReset,
}: {
  config: YProcessingConfig;
  selectedOption: YProcessingOption | undefined;
  onScalerChange: (scaler: string) => void;
  onParamChange: (key: string, value: unknown) => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4 pl-2 border-l-2 border-amber-500/30">
      <YProcessingScalerSelect
        value={config.scaler}
        selectedOption={selectedOption}
        onChange={onScalerChange}
      />
      {selectedOption && (
        <YProcessingParamsSection
          option={selectedOption}
          params={config.params}
          onParamChange={onParamChange}
          onReset={onReset}
        />
      )}
      {selectedOption && <YProcessingRecommendations option={selectedOption} />}
      <YProcessingInfoNote />
    </div>
  );
}

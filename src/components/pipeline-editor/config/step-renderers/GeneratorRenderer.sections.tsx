import { useCallback } from "react";
import {
  ArrowRight,
  Info,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ScalarGeneratorEntry } from "../../types";
import type { GeneratorKindMeta } from "./GeneratorRenderer.meta";
import {
  PRIMARY_MODE_OPTIONS,
  SECONDARY_MODE_OPTIONS,
} from "./GeneratorRenderer.meta";
import type {
  PrimarySelectionMode,
  SecondarySelectionMode,
  SelectionConfig,
  SelectionValue,
} from "./GeneratorRenderer.helpers";
import {
  formatSelectionValue,
  getPrimarySelectionDescription,
  getPrimarySelectionSummary,
  getSecondarySelectionSummary,
  isRange,
  stringifyJsonDraft,
} from "./GeneratorRenderer.helpers";

interface RangeValueInputProps {
  value: SelectionValue | undefined;
  onChange: (value: SelectionValue) => void;
  maxValue: number;
  label: string;
  rangeLabel?: string;
}

function RangeValueInput({ value, onChange, maxValue, label, rangeLabel }: RangeValueInputProps) {
  const isRangeMode = isRange(value);
  const singleValue = isRangeMode ? undefined : (value ?? 1);
  const rangeFrom = isRangeMode ? value[0] : 1;
  const rangeTo = isRangeMode ? value[1] : maxValue;

  const handleToggleRange = useCallback(() => {
    if (isRangeMode) {
      onChange(value[1] ?? 2);
    } else {
      onChange([1, singleValue ?? Math.min(2, maxValue)]);
    }
  }, [isRangeMode, maxValue, onChange, singleValue, value]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Range</Label>
          <Switch
            checked={isRangeMode}
            onCheckedChange={handleToggleRange}
            className="scale-75"
          />
        </div>
      </div>

      {isRangeMode ? (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={rangeTo}
            value={rangeFrom}
            onChange={(event) => {
              const newFrom = Math.max(1, Math.min(rangeTo, parseInt(event.target.value) || 1));
              onChange([newFrom, rangeTo]);
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-sm text-muted-foreground">to</span>
          <Input
            type="number"
            min={rangeFrom}
            max={maxValue}
            value={rangeTo}
            onChange={(event) => {
              const newTo = Math.max(rangeFrom, Math.min(maxValue, parseInt(event.target.value) || rangeFrom));
              onChange([rangeFrom, newTo]);
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-xs text-muted-foreground">
            {rangeLabel || `(all from ${rangeFrom} to ${rangeTo})`}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={1}
            max={maxValue}
            value={singleValue}
            onChange={(event) => {
              onChange(Math.max(1, Math.min(maxValue, parseInt(event.target.value) || 1)));
            }}
            className="w-16 h-8 text-center"
          />
          <span className="text-sm text-muted-foreground">of {maxValue}</span>
        </div>
      )}
    </div>
  );
}

interface GeneratorHeaderProps {
  meta: GeneratorKindMeta;
  optionCount: number;
  variantCount: number;
}

export function GeneratorHeader({ meta, optionCount, variantCount }: GeneratorHeaderProps) {
  const Icon = meta.icon;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30">
      <Icon className="h-5 w-5 text-orange-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm">{meta.label}</span>
          <Badge variant="outline" className="text-xs font-mono border-orange-500/50 text-orange-600">
            {meta.keyword}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {meta.description}
        </p>
        {optionCount > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {optionCount} {meta.branchLabel}{optionCount !== 1 ? "s" : ""} {" \u2192 "} {variantCount} {meta.variantLabel}{variantCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

interface ScalarParametersSectionProps {
  generatorKind: string;
  scalarEntries: ScalarGeneratorEntry[];
  entryDrafts: Record<string, string>;
  onAddEntry: () => void;
  onRemoveEntry: (entryId: string) => void;
  onRenameEntry: (entryId: string, key: string) => void;
  onDraftChange: (entryId: string, draft: string) => void;
  onValuesBlur: (entry: ScalarGeneratorEntry) => void;
}

export function ScalarParametersSection({
  generatorKind,
  scalarEntries,
  entryDrafts,
  onAddEntry,
  onRemoveEntry,
  onRenameEntry,
  onDraftChange,
  onValuesBlur,
}: ScalarParametersSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Scalar Parameters</Label>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={onAddEntry}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add Param
        </Button>
      </div>

      {scalarEntries.length > 0 ? (
        scalarEntries.map((entry, index) => (
          <div key={entry.id} className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs text-muted-foreground">
                Param {index + 1}
              </Label>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                onClick={() => onRemoveEntry(entry.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              value={entry.key}
              onChange={(event) => onRenameEntry(entry.id, event.target.value)}
              placeholder="Parameter name"
            />
            <Textarea
              value={entryDrafts[entry.id] ?? stringifyJsonDraft(entry.values)}
              onChange={(event) => onDraftChange(entry.id, event.target.value)}
              onBlur={() => onValuesBlur(entry)}
              rows={4}
              className="font-mono text-xs"
              placeholder="[0.1, 1.0, 10.0]"
            />
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          Add parameter arrays to configure the {generatorKind} generator.
        </p>
      )}
    </div>
  );
}

interface SamplingConfigurationSectionProps {
  sampleConfig: Record<string, unknown>;
  sampleChoicesDraft: string;
  onSampleConfigChange: (updates: Record<string, unknown>) => void;
  onSampleChoicesDraftChange: (draft: string) => void;
  onSampleChoicesBlur: () => void;
}

export function SamplingConfigurationSection({
  sampleConfig,
  sampleChoicesDraft,
  onSampleConfigChange,
  onSampleChoicesDraftChange,
  onSampleChoicesBlur,
}: SamplingConfigurationSectionProps) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Sampling Configuration</Label>
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Distribution</Label>
        <Select
          value={String(sampleConfig.distribution || "uniform")}
          onValueChange={(value) => onSampleConfigChange({ distribution: value })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-popover">
            <SelectItem value="uniform">uniform</SelectItem>
            <SelectItem value="log_uniform">log_uniform</SelectItem>
            <SelectItem value="normal">normal</SelectItem>
            <SelectItem value="choice">choice</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Samples</Label>
          <Input
            type="number"
            min={1}
            value={Number(sampleConfig.num) || 1}
            onChange={(event) =>
              onSampleConfigChange({ num: Math.max(1, parseInt(event.target.value, 10) || 1) })
            }
          />
        </div>
        {(sampleConfig.distribution === "uniform" ||
          sampleConfig.distribution === "log_uniform") && (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">From</Label>
              <Input
                type="number"
                value={Number(sampleConfig.from) || 0}
                onChange={(event) => onSampleConfigChange({ from: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">To</Label>
              <Input
                type="number"
                value={Number(sampleConfig.to) || 1}
                onChange={(event) => onSampleConfigChange({ to: Number(event.target.value) })}
              />
            </div>
          </>
        )}
        {sampleConfig.distribution === "normal" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Mean</Label>
              <Input
                type="number"
                value={Number(sampleConfig.mean) || 0}
                onChange={(event) => onSampleConfigChange({ mean: Number(event.target.value) })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Std</Label>
              <Input
                type="number"
                value={Number(sampleConfig.std) || 1}
                onChange={(event) => onSampleConfigChange({ std: Number(event.target.value) })}
              />
            </div>
          </>
        )}
      </div>

      {sampleConfig.distribution === "choice" && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Choices (JSON array)</Label>
          <Textarea
            value={sampleChoicesDraft}
            onChange={(event) => onSampleChoicesDraftChange(event.target.value)}
            onBlur={onSampleChoicesBlur}
            rows={4}
            className="font-mono text-xs"
            placeholder='["snv", "msc"]'
          />
        </div>
      )}
    </div>
  );
}

interface SelectionModeSectionProps {
  config: SelectionConfig;
  selectionBaseCount: number;
  onPrimaryModeChange: (mode: PrimarySelectionMode) => void;
  onConfigChange: (updates: Partial<SelectionConfig>) => void;
}

export function SelectionModeSection({
  config,
  selectionBaseCount,
  onPrimaryModeChange,
  onConfigChange,
}: SelectionModeSectionProps) {
  const hasPrimarySelection = config.primaryMode !== "none";

  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Selection Mode</Label>
      <Select
        value={config.primaryMode}
        onValueChange={(value) => onPrimaryModeChange(value as PrimarySelectionMode)}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="bg-popover">
          {PRIMARY_MODE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {" \u2013 "}{option.description}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {hasPrimarySelection && (
        <div className="p-3 rounded-lg bg-muted/50 space-y-2">
          <RangeValueInput
            value={config.primaryValue}
            onChange={(value) => onConfigChange({ primaryValue: value })}
            maxValue={Math.max(1, selectionBaseCount)}
            label={config.primaryMode === "pick" ? "Pick" : "Arrange"}
          />
          <div className="text-xs text-muted-foreground">
            {getPrimarySelectionDescription(config, selectionBaseCount)}
          </div>
        </div>
      )}
    </div>
  );
}

interface SecondOrderSelectionSectionProps {
  config: SelectionConfig;
  primarySelectionCount: number;
  onSecondaryModeChange: (mode: SecondarySelectionMode) => void;
  onConfigChange: (updates: Partial<SelectionConfig>) => void;
}

export function SecondOrderSelectionSection({
  config,
  primarySelectionCount,
  onSecondaryModeChange,
  onConfigChange,
}: SecondOrderSelectionSectionProps) {
  const hasSecondarySelection = config.secondaryMode !== "none";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Second-Order</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-48">
              Apply a second selection (then_pick / then_arrange) on the primary results.
            </TooltipContent>
          </Tooltip>
        </div>
        <Switch
          checked={hasSecondarySelection}
          onCheckedChange={(checked) =>
            onSecondaryModeChange(checked ? "then_pick" : "none")
          }
        />
      </div>

      {hasSecondarySelection && (
        <div className="p-3 rounded-lg border border-dashed border-orange-500/30 bg-orange-500/5 space-y-3">
          <Select
            value={config.secondaryMode}
            onValueChange={(value) => onSecondaryModeChange(value as SecondarySelectionMode)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              {SECONDARY_MODE_OPTIONS.filter((option) => option.value !== "none").map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span className="font-medium">{option.label}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    {" \u2013 "}{option.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-orange-500 flex-shrink-0" />
          </div>
          <RangeValueInput
            value={config.secondaryValue}
            onChange={(value) => onConfigChange({ secondaryValue: value })}
            maxValue={Math.max(1, primarySelectionCount)}
            label={config.secondaryMode === "then_pick" ? "Then Pick" : "Then Arrange"}
          />
        </div>
      )}
    </div>
  );
}

interface LimitVariantsSectionProps {
  config: SelectionConfig;
  unboundedVariantCount: number;
  onConfigChange: (updates: Partial<SelectionConfig>) => void;
}

export function LimitVariantsSection({
  config,
  unboundedVariantCount,
  onConfigChange,
}: LimitVariantsSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Limit Variants</Label>
        <Switch
          checked={!!config.count && config.count > 0}
          onCheckedChange={(checked) =>
            onConfigChange({ count: checked ? Math.min(10, unboundedVariantCount) : undefined })
          }
        />
      </div>

      {config.count !== undefined && config.count > 0 && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
          <Label className="text-sm text-muted-foreground">Max</Label>
          <Input
            type="number"
            min={1}
            value={config.count}
            onChange={(event) =>
              onConfigChange({
                count: Math.max(1, parseInt(event.target.value) || 1),
              })
            }
            className="w-20 h-8"
          />
          <span className="text-sm text-muted-foreground">
            of {unboundedVariantCount}
          </span>
        </div>
      )}
    </div>
  );
}

interface SeedSectionProps {
  config: SelectionConfig;
  onConfigChange: (updates: Partial<SelectionConfig>) => void;
}

export function SeedSection({ config, onConfigChange }: SeedSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Label className="text-sm font-medium">Seed</Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-48">
              Set a seed for deterministic, reproducible generation.
            </TooltipContent>
          </Tooltip>
        </div>
        <Switch
          checked={config.seed !== undefined}
          onCheckedChange={(checked) =>
            onConfigChange({ seed: checked ? 42 : undefined })
          }
        />
      </div>

      {config.seed !== undefined && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50">
          <Label className="text-sm text-muted-foreground">_seed_</Label>
          <Input
            type="number"
            min={0}
            value={config.seed}
            onChange={(event) =>
              onConfigChange({
                seed: Math.max(0, parseInt(event.target.value) || 0),
              })
            }
            className="w-24 h-8"
          />
        </div>
      )}
    </div>
  );
}

interface GeneratorSummaryProps {
  meta: GeneratorKindMeta;
  config: SelectionConfig;
  generatorKind: string;
  variantCount: number;
}

export function GeneratorSummary({
  meta,
  config,
  generatorKind,
  variantCount,
}: GeneratorSummaryProps) {
  const secondarySummary = getSecondarySelectionSummary(config);

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
      <Settings2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
      <div className="text-sm min-w-0">
        {meta.supportsPickArrange && (
          <p className="font-medium">
            {getPrimarySelectionSummary(config, generatorKind)}
          </p>
        )}
        {!meta.supportsPickArrange && (
          <p className="font-medium">
            {meta.description}
          </p>
        )}
        {secondarySummary && (
          <p className="text-xs text-muted-foreground mt-1">
            {secondarySummary}
          </p>
        )}
        <p className="text-xs text-orange-600 mt-1">
          Total: {variantCount} {meta.variantLabel}{variantCount !== 1 ? "s" : ""}
          {config.seed !== undefined && ` (seed: ${formatSelectionValue(config.seed)})`}
        </p>
      </div>
    </div>
  );
}

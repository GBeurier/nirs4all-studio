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

import { useTranslation } from "react-i18next";
import { Zap, Layers, Filter, Combine, Trash2, type LucideIcon } from "lucide-react";
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
  icon: LucideIcon;
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
  const { t } = useTranslation();
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
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 text-muted-foreground hover:text-destructive"
                  aria-label={t("pipelineEditor.config.container.removeChild", { name: child.name })}
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
  const { t } = useTranslation();
  const children = step.children ?? [];

  const handleParamChange = (key: string, value: string | number | boolean) => {
    onUpdate(step.id, {
      params: { ...step.params, [key]: value },
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30">
            <Zap className="h-5 w-5 text-violet-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.container.sampleAug.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.sampleAug.subtitle")}
              </p>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.container.sampleAug.count")}</Label>
              <Input
                type="number"
                value={Number(step.params.count) || 1}
                onChange={(e) =>
                  handleParamChange("count", parseInt(e.target.value) || 1)
                }
                min={1}
                className="h-9"
              />
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.sampleAug.countHint")}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.container.sampleAug.selection")}</Label>
              <Select
                value={String(step.params.selection || "random")}
                onValueChange={(v) => handleParamChange("selection", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="random">{t("pipelineEditor.config.container.sampleAug.selectRandom")}</SelectItem>
                  <SelectItem value="all">{t("pipelineEditor.config.container.sampleAug.selectAll")}</SelectItem>
                  <SelectItem value="sequential">{t("pipelineEditor.config.container.sampleAug.selectSequential")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.container.sampleAug.randomState")}</Label>
              <Input
                type="number"
                value={Number(step.params.random_state) || 42}
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
            label={t("pipelineEditor.config.container.sampleAug.transformers")}
            addLabel={t("pipelineEditor.config.container.sampleAug.addTransformer")}
            emptyLabel={t("pipelineEditor.config.container.sampleAug.noTransformers")}
            emptySubLabel={t("pipelineEditor.config.container.sampleAug.addTransformerHint")}
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
  const { t } = useTranslation();
  const children = step.children ?? [];
  const generatorOptions = step.generatorOptions;
  const isGeneratorMode = step.generatorKind === "or";

  const handleActionChange = (action: string) => {
    onUpdate(step.id, {
      params: { ...step.params, action },
    });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/30">
            <Layers className="h-5 w-5 text-fuchsia-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.container.featureAug.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.featureAug.subtitle")}
              </p>
            </div>
          </div>

          {/* Action Mode */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("pipelineEditor.config.container.featureAug.actionMode")}</Label>
            <Select
              value={String(step.params.action || "extend")}
              onValueChange={handleActionChange}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="extend">
                  {t("pipelineEditor.config.container.featureAug.extend")}
                </SelectItem>
                <SelectItem value="add">{t("pipelineEditor.config.container.featureAug.add")}</SelectItem>
                <SelectItem value="replace">
                  {t("pipelineEditor.config.container.featureAug.replace")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Generator Options */}
          {isGeneratorMode && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label className="text-sm font-medium">{t("pipelineEditor.config.container.featureAug.generatorOptions")}</Label>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">{t("pipelineEditor.config.container.featureAug.pick")}</Label>
                    <Input
                      type="text"
                      value={
                        generatorOptions?.pick !== undefined
                          ? Array.isArray(generatorOptions.pick)
                            ? JSON.stringify(generatorOptions.pick)
                            : generatorOptions.pick
                          : ""
                      }
                      onChange={(e) => {
                        const v = e.target.value;
                        const parsed = v.startsWith("[")
                          ? JSON.parse(v)
                          : parseInt(v) || undefined;
                        onUpdate(step.id, {
                          generatorOptions: { ...generatorOptions, pick: parsed },
                        });
                      }}
                      className="h-8"
                      placeholder={t("pipelineEditor.config.container.featureAug.pickPlaceholder")}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">
                      {t("pipelineEditor.config.container.featureAug.countLabel")}
                    </Label>
                    <Input
                      type="number"
                      value={generatorOptions?.count || ""}
                      onChange={(e) => {
                        onUpdate(step.id, {
                          generatorOptions: {
                            ...generatorOptions,
                            count: parseInt(e.target.value) || undefined,
                          },
                        });
                      }}
                      className="h-8"
                      placeholder={t("pipelineEditor.config.container.featureAug.countPlaceholder")}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          <ChildrenList
            children={children}
            label={t("pipelineEditor.config.container.transforms")}
            addLabel={t("pipelineEditor.config.container.addTransform")}
            emptyLabel={t("pipelineEditor.config.container.noTransforms")}
            emptySubLabel={t("pipelineEditor.config.container.addTransformHint")}
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
  const { t } = useTranslation();
  const children = step.children ?? [];
  const filterOrigin = step.filterOrigin ?? "sample_filter";

  const handleModeChange = (mode: string) => {
    onUpdate(step.id, {
      params: { ...step.params, mode },
    });
  };

  const handleReportChange = (report: boolean) => {
    onUpdate(step.id, {
      params: { ...step.params, report },
    });
  };

  const handleOriginChange = (origin: "sample_filter" | "exclude" | "tag") => {
    onUpdate(step.id, { filterOrigin: origin });
  };

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
            <Filter className="h-5 w-5 text-red-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.container.sampleFilter.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.sampleFilter.subtitle")}
              </p>
            </div>
          </div>

          {/* Configuration */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.container.sampleFilter.origin")}</Label>
              <Select value={filterOrigin} onValueChange={(value) => handleOriginChange(value as "sample_filter" | "exclude" | "tag")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="sample_filter">sample_filter</SelectItem>
                  <SelectItem value="exclude">exclude</SelectItem>
                  <SelectItem value="tag">tag</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.sampleFilter.originHint")}
              </p>
            </div>

            {filterOrigin !== "tag" && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">{t("pipelineEditor.config.container.sampleFilter.mode")}</Label>
              <Select
                value={String(step.params.mode || "any")}
                onValueChange={handleModeChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-popover">
                  <SelectItem value="any">
                    {t("pipelineEditor.config.container.sampleFilter.modeAny")}
                  </SelectItem>
                  <SelectItem value="all">
                    {t("pipelineEditor.config.container.sampleFilter.modeAll")}
                  </SelectItem>
                  <SelectItem value="vote">
                    {t("pipelineEditor.config.container.sampleFilter.modeVote")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            )}

            {filterOrigin === "sample_filter" && (
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <Label className="text-sm">{t("pipelineEditor.config.container.sampleFilter.report")}</Label>
                </div>
                <Switch
                  checked={Boolean(step.params.report ?? true)}
                  aria-label={t("pipelineEditor.config.container.sampleFilter.report")}
                  onCheckedChange={handleReportChange}
                />
              </div>
            )}
          </div>

          <Separator />

          <ChildrenList
            children={children}
            label={t("pipelineEditor.config.container.sampleFilter.filters")}
            addLabel={t("pipelineEditor.config.container.sampleFilter.addFilter")}
            emptyLabel={t("pipelineEditor.config.container.sampleFilter.noFilters")}
            emptySubLabel={t("pipelineEditor.config.container.sampleFilter.addFilterHint")}
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
  const { t } = useTranslation();
  const children = step.children ?? [];

  return (
    <>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-teal-500/10 border border-teal-500/30">
            <Combine className="h-5 w-5 text-teal-500" />
            <div>
              <h4 className="font-medium text-sm">{t("pipelineEditor.config.container.concat.title")}</h4>
              <p className="text-xs text-muted-foreground">
                {t("pipelineEditor.config.container.concat.subtitle")}
              </p>
            </div>
          </div>

          <Separator />

          <ChildrenList
            children={children}
            label={t("pipelineEditor.config.container.transforms")}
            addLabel={t("pipelineEditor.config.container.addTransform")}
            emptyLabel={t("pipelineEditor.config.container.noTransforms")}
            emptySubLabel={t("pipelineEditor.config.container.addTransformHint")}
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

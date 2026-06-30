import { GitBranch, Layers, X, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState, type ReactNode } from "react";
import type { MergeConfig, MergePredictionSource } from "../../types";
import {
  clearStructuredSources,
  createDefaultPredictionSource,
  formatStructuredSourcesDraft,
  getMergeSourceState,
  parseStructuredSourcesDraft,
  toggleFeatureSourcesInConfig,
  togglePredictionSourcesInConfig,
} from "./MergeRenderer.helpers";

interface SourcesTabProps {
  mergeConfig: MergeConfig;
  onConfigChange: (config: MergeConfig) => void;
}

interface SourceToggleCardProps {
  enabled: boolean;
  icon: LucideIcon;
  title: string;
  description: string;
  badge?: string;
  tone: "blue" | "green";
  onToggle: () => void;
  children: ReactNode;
}

const SOURCE_TONE_CLASSES = {
  blue: {
    activeHeader: "bg-blue-500/10 border-b border-blue-500/20",
    inactiveHeader: "bg-muted/30 hover:bg-muted/50",
    toggleActive: "bg-blue-500 justify-end",
    toggleInactive: "bg-muted-foreground/30 justify-start",
    icon: "text-blue-500",
    badge: "bg-blue-500/20 text-blue-600",
  },
  green: {
    activeHeader: "bg-green-500/10 border-b border-green-500/20",
    inactiveHeader: "bg-muted/30 hover:bg-muted/50",
    toggleActive: "bg-green-500 justify-end",
    toggleInactive: "bg-muted-foreground/30 justify-start",
    icon: "text-green-500",
    badge: "bg-green-500/20 text-green-600",
  },
} as const;

function SourceToggleCard({
  enabled,
  icon: Icon,
  title,
  description,
  badge,
  tone,
  onToggle,
  children,
}: SourceToggleCardProps) {
  const classes = SOURCE_TONE_CLASSES[tone];

  return (
    <div className="rounded-lg border overflow-hidden">
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer transition-colors ${
          enabled ? classes.activeHeader : classes.inactiveHeader
        }`}
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-5 rounded-full flex items-center p-0.5 transition-colors ${
              enabled ? classes.toggleActive : classes.toggleInactive
            }`}
          >
            <div className="w-4 h-4 rounded-full bg-white shadow-sm" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${classes.icon}`} />
              <span className="font-medium text-sm">{title}</span>
              {enabled && badge && (
                <Badge
                  variant="secondary"
                  className={`text-[10px] h-5 ${classes.badge}`}
                >
                  {badge}
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
      </div>

      {enabled && (
        <div className="p-4" onClick={(event) => event.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}

export function SourcesTab({ mergeConfig, onConfigChange }: SourcesTabProps) {
  const {
    predictionsEnabled,
    featuresEnabled,
  } = getMergeSourceState(mergeConfig);
  const predictionCount = mergeConfig.predictions?.length ?? 0;
  const featureCount = mergeConfig.features?.length ?? 0;
  const [sourcesDraft, setSourcesDraft] = useState(() =>
    formatStructuredSourcesDraft(mergeConfig.sources)
  );

  useEffect(() => {
    setSourcesDraft(formatStructuredSourcesDraft(mergeConfig.sources));
  }, [mergeConfig.sources]);

  const handleSourcesBlur = () => {
    const parsed = parseStructuredSourcesDraft(sourcesDraft);

    if (parsed.status === "empty") {
      onConfigChange(clearStructuredSources(mergeConfig));
      return;
    }

    if (parsed.status === "invalid") {
      setSourcesDraft(formatStructuredSourcesDraft(mergeConfig.sources));
      return;
    }

    onConfigChange({
      ...mergeConfig,
      mode: "sources",
      sources: parsed.value,
    });
  };

  return (
    <div className="p-4 space-y-4">
      <SourceToggleCard
        enabled={predictionsEnabled}
        icon={GitBranch}
        title="Predictions"
        description="Merge model predictions from branches"
        badge={
          predictionCount > 0
            ? `${predictionCount} source${predictionCount !== 1 ? "s" : ""}`
            : undefined
        }
        tone="blue"
        onToggle={() =>
          onConfigChange(togglePredictionSourcesInConfig(mergeConfig))
        }
      >
        <PredictionSourcesSection
          predictions={mergeConfig.predictions ?? []}
          onChange={(predictions) =>
            onConfigChange({ ...mergeConfig, predictions })
          }
        />
      </SourceToggleCard>

      <SourceToggleCard
        enabled={featuresEnabled}
        icon={Layers}
        title="Features"
        description="Merge transformed features from branches"
        badge={
          featureCount > 0
            ? `${featureCount} branch${featureCount !== 1 ? "es" : ""}`
            : undefined
        }
        tone="green"
        onToggle={() => onConfigChange(toggleFeatureSourcesInConfig(mergeConfig))}
      >
        <FeatureSourcesSection
          features={mergeConfig.features ?? []}
          onChange={(features) => onConfigChange({ ...mergeConfig, features })}
        />
      </SourceToggleCard>

      <StructuredSourcesSection
        mergeConfig={mergeConfig}
        sourcesDraft={sourcesDraft}
        onDraftChange={setSourcesDraft}
        onBlur={handleSourcesBlur}
        onConfigChange={onConfigChange}
      />

      <Separator />

      <OutputOptionsSection
        mergeConfig={mergeConfig}
        onConfigChange={onConfigChange}
      />
    </div>
  );
}

interface StructuredSourcesSectionProps {
  mergeConfig: MergeConfig;
  sourcesDraft: string;
  onDraftChange: (draft: string) => void;
  onBlur: () => void;
  onConfigChange: (config: MergeConfig) => void;
}

function StructuredSourcesSection({
  mergeConfig,
  sourcesDraft,
  onDraftChange,
  onBlur,
  onConfigChange,
}: StructuredSourcesSectionProps) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Label className="text-sm font-medium">Structured Source Payload</Label>
          <p className="text-xs text-muted-foreground mt-1">
            Use this for canonical merge source payloads such as{" "}
            <code>"concat"</code> or nested JSON objects.
          </p>
        </div>
        {mergeConfig.sources !== undefined && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => onConfigChange(clearStructuredSources(mergeConfig))}
          >
            Clear
          </Button>
        )}
      </div>
      <Textarea
        value={sourcesDraft}
        onChange={(event) => onDraftChange(event.target.value)}
        onBlur={onBlur}
        rows={5}
        className="font-mono text-xs"
        placeholder='concat or {"left": [0], "right": [1]}'
      />
    </div>
  );
}

interface OutputOptionsSectionProps {
  mergeConfig: MergeConfig;
  onConfigChange: (config: MergeConfig) => void;
}

function OutputOptionsSection({
  mergeConfig,
  onConfigChange,
}: OutputOptionsSectionProps) {
  return (
    <div className="space-y-3">
      <Label className="text-sm font-medium">Output Options</Label>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
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
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="predictions">Predictions</SelectItem>
              <SelectItem value="features">Features</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
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
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-popover">
              <SelectItem value="warn">Warn</SelectItem>
              <SelectItem value="error">Error</SelectItem>
              <SelectItem value="drop">Drop</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        How to handle missing data from branches
      </p>
    </div>
  );
}

interface PredictionSourcesSectionProps {
  predictions: MergePredictionSource[];
  onChange: (predictions: MergePredictionSource[]) => void;
}

function PredictionSourcesSection({
  predictions,
  onChange,
}: PredictionSourcesSectionProps) {
  const addSource = () => {
    onChange([...predictions, createDefaultPredictionSource()]);
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
                onChange={(event) =>
                  updateSource(idx, {
                    branch: parseInt(event.target.value, 10),
                  })
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
                  onChange={(event) =>
                    updateSource(idx, {
                      select: { top_k: parseInt(event.target.value, 10) },
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

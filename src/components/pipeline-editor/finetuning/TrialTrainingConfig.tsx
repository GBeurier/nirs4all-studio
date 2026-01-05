/**
 * TrialTrainingConfig - Quick training params used during hyperparameter search trials
 *
 * These are fixed values (not ranges) used for each trial during Optuna search.
 * Lower values (e.g., 50 epochs) speed up the search process.
 * After finding the best hyperparameters, the "Best Model Training" params are used
 * for final training with higher values (e.g., 500 epochs).
 */

import { useState, useMemo, useCallback } from "react";
import { Plus, Timer, Hash, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FinetuneConfig } from "../types";
import { hasTrainParams, type StaticParamPreset } from "./types";
import { trialTrainParamPresets } from "./presets";

interface TrialTrainingConfigProps {
  config: FinetuneConfig;
  onUpdate: (updates: Partial<FinetuneConfig>) => void;
  modelName: string;
}

export function TrialTrainingConfig({
  config,
  onUpdate,
  modelName,
}: TrialTrainingConfigProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for models that support training parameters
  const supportsTrainParams = useMemo(
    () => hasTrainParams(modelName),
    [modelName]
  );

  // Get current trial training config
  const trialConfig = config.trial_train_params ?? {};

  // Get used parameter names
  const usedParams = useMemo(() => {
    return new Set(Object.keys(trialConfig));
  }, [trialConfig]);

  const unusedPresets = useMemo(
    () => trialTrainParamPresets.filter((p) => !usedParams.has(p.name)),
    [usedParams]
  );

  const handleUpdateTrialConfig = useCallback(
    (key: string, value: number | undefined) => {
      const newConfig = { ...trialConfig, [key]: value };
      // Remove undefined values
      Object.keys(newConfig).forEach((k) => {
        if (newConfig[k] === undefined) {
          delete newConfig[k];
        }
      });
      onUpdate({ trial_train_params: Object.keys(newConfig).length > 0 ? newConfig : undefined });
    },
    [trialConfig, onUpdate]
  );

  const handleAddParam = (preset: StaticParamPreset) => {
    handleUpdateTrialConfig(preset.name, preset.default);
    setShowAddPopover(false);
  };

  const handleRemoveParam = (paramName: string) => {
    handleUpdateTrialConfig(paramName, undefined);
  };

  // Don't render if model doesn't support training params
  if (!supportsTrainParams) return null;

  // Check if there are any params set
  const hasParams = usedParams.size > 0;

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Label className="text-sm font-medium flex items-center gap-2">
            <Timer className="h-4 w-4 text-sky-500" />
            Trial Training (Quick)
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fast training per trial (e.g., 50 epochs)
          </p>
        </div>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-sky-500/50 text-sky-500 hover:bg-sky-500/10 flex-shrink-0"
              disabled={unusedPresets.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Trial Training Params</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Quick training for each search trial
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-1">
                {unusedPresets.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleAddParam(preset)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{preset.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {preset.default}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {preset.description}
                    </p>
                  </button>
                ))}
                {unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All trial parameters added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {!hasParams ? (
        <div className="text-center py-3 rounded-lg border border-dashed border-sky-500/30">
          <p className="text-xs text-muted-foreground">
            Uses default trial training settings
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(usedParams).map((paramName) => {
            const value = trialConfig[paramName];
            return (
              <div
                key={paramName}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-sky-500/30 bg-sky-500/5"
              >
                <Hash className="h-4 w-4 text-sky-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Label className="text-sm font-medium truncate block">{paramName}</Label>
                </div>
                <Input
                  type="number"
                  value={value ?? ""}
                  onChange={(e) =>
                    handleUpdateTrialConfig(
                      paramName,
                      parseFloat(e.target.value) || 0
                    )
                  }
                  className="w-20 h-7 text-xs font-mono flex-shrink-0"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                  onClick={() => handleRemoveParam(paramName)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Info callout */}
      {hasParams && (
        <div className="flex items-start gap-2 p-2 rounded-lg bg-sky-500/5 border border-sky-500/20">
          <Timer className="h-3.5 w-3.5 text-sky-500 flex-shrink-0 mt-0.5" />
          <p className="text-[11px] text-muted-foreground">
            These values are used for quick training during each trial to speed up hyperparameter search.
          </p>
        </div>
      )}
    </div>
  );
}

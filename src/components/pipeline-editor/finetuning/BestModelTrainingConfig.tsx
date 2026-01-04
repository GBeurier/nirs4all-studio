/**
 * BestModelTrainingConfig - Static training params for best model training
 */

import { useState, useMemo, useCallback } from "react";
import { Plus, Target, Hash, Trash2, Lightbulb } from "lucide-react";
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
import type { PipelineStep } from "../types";
import { isNeuralNetworkModel, type StaticParamPreset } from "./types";
import { staticTrainParamPresets } from "./presets";

interface BestModelTrainingConfigProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
  modelName: string;
}

export function BestModelTrainingConfig({
  step,
  onUpdate,
  modelName,
}: BestModelTrainingConfigProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for neural network models
  const isNeuralNetwork = useMemo(
    () => isNeuralNetworkModel(modelName),
    [modelName]
  );

  // Get current training config
  const trainingConfig = step.trainingConfig ?? { epochs: 100, batch_size: 32 };

  // Get used parameter names
  const usedParams = useMemo(() => {
    const params = new Set<string>();
    if (trainingConfig.epochs !== undefined) params.add("epochs");
    if (trainingConfig.batch_size !== undefined) params.add("batch_size");
    if (trainingConfig.learning_rate !== undefined) params.add("learning_rate");
    if (trainingConfig.patience !== undefined) params.add("patience");
    if (trainingConfig.verbose !== undefined) params.add("verbose");
    return params;
  }, [trainingConfig]);

  const unusedPresets = useMemo(
    () => staticTrainParamPresets.filter((p) => !usedParams.has(p.name)),
    [usedParams]
  );

  const handleUpdateTrainingConfig = useCallback(
    (key: string, value: number | undefined) => {
      const newConfig = { ...trainingConfig, [key]: value };
      // Remove undefined values
      Object.keys(newConfig).forEach((k) => {
        if (newConfig[k as keyof typeof newConfig] === undefined) {
          delete newConfig[k as keyof typeof newConfig];
        }
      });
      onUpdate({ trainingConfig: newConfig });
    },
    [trainingConfig, onUpdate]
  );

  const handleAddParam = (preset: StaticParamPreset) => {
    handleUpdateTrainingConfig(preset.name, preset.default);
    setShowAddPopover(false);
  };

  const handleRemoveParam = (paramName: string) => {
    handleUpdateTrainingConfig(paramName, undefined);
  };

  // Don't render if not a neural network model
  if (!isNeuralNetwork) return null;

  // Check if there are any params set
  const hasParams = usedParams.size > 0;

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4 text-emerald-500" />
            Best Model Training
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Fixed training params for final model (after tuning)
          </p>
        </div>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-emerald-500/50 text-emerald-500 hover:bg-emerald-500/10"
              disabled={unusedPresets.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Training Param
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Best Model Training</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Fixed params for final training
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
                        default: {preset.default}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {preset.description}
                    </p>
                  </button>
                ))}
                {unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    All training parameters added
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {!hasParams ? (
        <div className="text-center py-4 rounded-lg border border-dashed border-emerald-500/30">
          <p className="text-sm text-muted-foreground">
            No fixed training parameters
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add epochs, batch_size, etc. for final model training
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {Array.from(usedParams).map((paramName) => {
            const preset = staticTrainParamPresets.find(
              (p) => p.name === paramName
            );
            const value = trainingConfig[paramName as keyof typeof trainingConfig];
            return (
              <div
                key={paramName}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5"
              >
                <Hash className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <Label className="text-sm font-medium">{paramName}</Label>
                  {preset && (
                    <p className="text-xs text-muted-foreground">
                      {preset.description}
                    </p>
                  )}
                </div>
                <Input
                  type="number"
                  value={value ?? ""}
                  onChange={(e) =>
                    handleUpdateTrainingConfig(
                      paramName,
                      parseFloat(e.target.value) || 0
                    )
                  }
                  className="w-24 h-8 text-xs font-mono"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveParam(paramName)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* Info box */}
      <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
        <Lightbulb className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground">
          <p>
            These are <strong>fixed</strong> training parameters used when
            training the final best model after Optuna finds optimal
            hyperparameters. Use more epochs here than during tuning for better
            convergence.
          </p>
        </div>
      </div>
    </div>
  );
}

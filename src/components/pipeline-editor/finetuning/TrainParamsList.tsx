/**
 * TrainParamsList - Training parameters for neural network models
 */

import { useState, useMemo } from "react";
import { Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { FinetuneParamConfig } from "../types";
import { isNeuralNetworkModel, type ParamPreset } from "./types";
import { trainParamPresets } from "./presets";
import { FinetuneParamEditor } from "./FinetuneParamEditor";

interface TrainParamsListProps {
  params: FinetuneParamConfig[];
  onUpdate: (params: FinetuneParamConfig[]) => void;
  modelName: string;
}

export function TrainParamsList({
  params,
  onUpdate,
  modelName,
}: TrainParamsListProps) {
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for neural network models
  const isNeuralNetwork = useMemo(
    () => isNeuralNetworkModel(modelName),
    [modelName]
  );

  // Filter out already-added params
  const unusedPresets = useMemo(
    () => trainParamPresets.filter((p) => !params.find((ep) => ep.name === p.name)),
    [params]
  );

  const handleAddParam = (preset: ParamPreset) => {
    const newParam: FinetuneParamConfig = {
      name: preset.name,
      type: preset.type,
      low: preset.low,
      high: preset.high,
      step: preset.step,
      choices: preset.choices,
    };
    onUpdate([...params, newParam]);
    setShowAddPopover(false);
  };

  const handleUpdateParam = (
    index: number,
    updates: Partial<FinetuneParamConfig>
  ) => {
    const newParams = [...params];
    newParams[index] = { ...newParams[index], ...updates };
    onUpdate(newParams);
  };

  const handleRemoveParam = (index: number) => {
    onUpdate(params.filter((_, i) => i !== index));
  };

  // Don't render if not a neural network model
  if (!isNeuralNetwork) return null;

  return (
    <div className="space-y-3">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-medium flex items-center gap-2">
            <Zap className="h-4 w-4 text-amber-500" />
            Training Parameters
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Tune training hyperparameters (epochs, batch_size, etc.)
          </p>
        </div>
        <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs border-amber-500/50 text-amber-500 hover:bg-amber-500/10"
              disabled={unusedPresets.length === 0}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add Training Param
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">Training Parameters</h4>
              <p className="text-xs text-muted-foreground mt-1">
                Add training hyperparameters to tune
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
                      <Badge variant="outline" className="text-[10px]">
                        {preset.type}
                      </Badge>
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

      {params.length === 0 ? (
        <div className="text-center py-4 rounded-lg border border-dashed">
          <p className="text-sm text-muted-foreground">
            No training parameters to tune
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Add epochs, batch_size, learning_rate, etc.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {params.map((param, index) => (
            <FinetuneParamEditor
              key={param.name}
              param={param}
              onUpdate={(updates) => handleUpdateParam(index, updates)}
              onRemove={() => handleRemoveParam(index)}
              existingParams={params.map((p) => p.name)}
              modelName={modelName}
            />
          ))}
        </div>
      )}
    </div>
  );
}

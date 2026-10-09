/**
 * TrainParamsList - Training parameters to be finetuned (ranges for Optuna search)
 *
 * These are RANGES that Optuna will search through during hyperparameter optimization.
 * Example: batch_size from 16 to 256, learning_rate from 0.0001 to 0.1
 */

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
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
import { hasTrainParams, type ParamPreset } from "./types";
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
  const { t } = useTranslation();
  const [showAddPopover, setShowAddPopover] = useState(false);

  // Only show for models that have training parameters (neural networks, boosting)
  const supportsTrainParams = useMemo(
    () => hasTrainParams(modelName),
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

  // Don't render if model doesn't support training params
  if (!supportsTrainParams) return null;

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-500" />
              {t("pipelineEditor.finetune.train.title")}
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("pipelineEditor.finetune.train.hint")}
            </p>
          </div>
          <Popover open={showAddPopover} onOpenChange={setShowAddPopover}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs border-amber-500/50 text-amber-500 hover:bg-amber-500/10 flex-shrink-0"
                disabled={unusedPresets.length === 0}
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                {t("common.add")}
              </Button>
            </PopoverTrigger>
          <PopoverContent align="end" className="w-64 bg-popover p-0">
            <div className="p-3 border-b border-border">
              <h4 className="font-medium text-sm">{t("pipelineEditor.finetune.train.popTitle")}</h4>
              <p className="text-xs text-muted-foreground mt-1">
                {t("pipelineEditor.finetune.train.popHint")}
              </p>
            </div>
            <ScrollArea className="max-h-64">
              <div className="p-2 space-y-1">
                {unusedPresets.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handleAddParam(preset)}
                    className="w-full text-left px-3 py-2 rounded-lg hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{preset.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {preset.type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t(preset.descriptionKey)}
                    </p>
                  </button>
                ))}
                {unusedPresets.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    {t("pipelineEditor.finetune.train.allAdded")}
                  </p>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>
      </div>

      {params.length === 0 ? (
        <div className="text-center py-3 rounded-lg border border-dashed">
          <p className="text-xs text-muted-foreground">
            {t("pipelineEditor.finetune.train.none")}
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
    </>
  );
}

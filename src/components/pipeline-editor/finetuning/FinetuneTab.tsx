/**
 * FinetuneTab - Main tab content for model step finetuning
 */

import { useMemo, useCallback } from "react";
import { Sparkles, Settings2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import type { PipelineStep, FinetuneConfig, FinetuneParamConfig } from "../types";
import { FinetuneEnableToggle } from "./FinetuneEnableToggle";
import { FinetuneSearchConfig } from "./FinetuneSearchConfig";
import { FinetuneParamList } from "./FinetuneParamList";
import { TrainParamsList } from "./TrainParamsList";
import { BestModelTrainingConfig } from "./BestModelTrainingConfig";
import { getPresetsForModel } from "./presets";

/**
 * Default finetuning configuration
 */
export const defaultFinetuneConfig: FinetuneConfig = {
  enabled: false,
  n_trials: 50,
  timeout: undefined,
  approach: "grouped",
  eval_mode: "best",
  model_params: [],
};

interface FinetuneTabProps {
  step: PipelineStep;
  onUpdate: (updates: Partial<PipelineStep>) => void;
}

export function FinetuneTab({ step, onUpdate }: FinetuneTabProps) {
  // Initialize or get existing config
  const config = step.finetuneConfig ?? defaultFinetuneConfig;

  // Get available parameters from step params
  const availableParams = useMemo(
    () =>
      Object.keys(step.params).filter((p) => typeof step.params[p] === "number"),
    [step.params]
  );

  // Update config
  const handleConfigUpdate = useCallback(
    (updates: Partial<FinetuneConfig>) => {
      onUpdate({
        finetuneConfig: { ...config, ...updates },
      });
    },
    [config, onUpdate]
  );

  // Toggle enabled
  const handleToggle = useCallback(
    (enabled: boolean) => {
      if (enabled && (!config.model_params || config.model_params.length === 0)) {
        // Auto-add first numeric param when enabling
        const firstParam = availableParams[0];
        const presets = getPresetsForModel(step.name);
        const matchingPreset = presets.find((p) =>
          availableParams.includes(p.name)
        );

        onUpdate({
          finetuneConfig: {
            ...config,
            enabled: true,
            model_params: matchingPreset
              ? [
                  {
                    name: matchingPreset.name,
                    type: matchingPreset.type,
                    low: matchingPreset.low,
                    high: matchingPreset.high,
                    step: matchingPreset.step,
                    choices: matchingPreset.choices,
                  },
                ]
              : firstParam
              ? [{ name: firstParam, type: "int", low: 1, high: 10 }]
              : [],
          },
        });
      } else {
        handleConfigUpdate({ enabled });
      }
    },
    [config, onUpdate, handleConfigUpdate, availableParams, step.name]
  );

  // Update params
  const handleParamsUpdate = useCallback(
    (params: FinetuneParamConfig[]) => {
      handleConfigUpdate({ model_params: params });
    },
    [handleConfigUpdate]
  );

  return (
    <div className="space-y-6 p-4">
      {/* Enable toggle */}
      <FinetuneEnableToggle
        enabled={config.enabled}
        onToggle={handleToggle}
        paramCount={config.model_params?.length ?? 0}
      />

      {/* Configuration (only shown when enabled) */}
      {config.enabled && (
        <>
          <Separator />

          {/* Search configuration */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Settings2 className="h-4 w-4" />
              Search Configuration
            </Label>
            <FinetuneSearchConfig config={config} onUpdate={handleConfigUpdate} />
          </div>

          <Separator />

          {/* Parameters to optimize */}
          <FinetuneParamList
            params={config.model_params ?? []}
            onUpdate={handleParamsUpdate}
            modelName={step.name}
            availableParams={availableParams}
          />

          {/* Training Parameters (for neural network models) */}
          <TrainParamsList
            params={config.train_params ?? []}
            onUpdate={(params) => handleConfigUpdate({ train_params: params })}
            modelName={step.name}
          />

          {/* Best Model Training Parameters (static, for final training after tuning) */}
          <BestModelTrainingConfig
            step={step}
            onUpdate={onUpdate}
            modelName={step.name}
          />

          {/* Summary */}
          {((config.model_params && config.model_params.length > 0) ||
            (config.train_params && config.train_params.length > 0)) && (
            <>
              <Separator />
              <div className="flex items-start gap-3 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <Sparkles className="h-5 w-5 text-purple-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium text-foreground">
                    Optuna will explore {config.n_trials} configurations
                  </p>
                  {config.model_params && config.model_params.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Model params ({config.model_params.length}):{" "}
                      {config.model_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                  {config.train_params && config.train_params.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Training params ({config.train_params.length}):{" "}
                      {config.train_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

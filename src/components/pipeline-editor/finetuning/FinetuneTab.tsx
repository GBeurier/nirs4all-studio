/**
 * FinetuneTab - Main tab content for model step finetuning
 *
 * Manages 3 distinct types of training parameters:
 * 1. Model Params (Tunable) - Model hyperparameters to search (e.g., n_components: 1-30)
 * 2. Training Params (Tunable) - Training hyperparameters to search (e.g., batch_size: 16-256)
 * 3. Trial Training (Quick) - Fixed fast training params per trial (e.g., 50 epochs)
 * 4. Best Model Training - Fixed final training params (e.g., 500 epochs)
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
import { TrialTrainingConfig } from "./TrialTrainingConfig";
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
    <div className="space-y-4 p-4">
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
          <div className="space-y-2">
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

          {/* Training Parameters to Tune (ranges for Optuna) */}
          <TrainParamsList
            params={config.train_params ?? []}
            onUpdate={(params) => handleConfigUpdate({ train_params: params })}
            modelName={step.name}
          />

          {/* Trial Training Config (quick fixed params during search) */}
          <TrialTrainingConfig
            config={config}
            onUpdate={handleConfigUpdate}
            modelName={step.name}
          />

          {/* Best Model Training Parameters (fixed final training after tuning) */}
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
              <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/30">
                <Sparkles className="h-4 w-4 text-purple-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs min-w-0 space-y-1">
                  <p className="font-medium text-foreground">
                    {config.n_trials} trials will be explored
                  </p>
                  {config.model_params && config.model_params.length > 0 && (
                    <p className="text-muted-foreground truncate">
                      <span className="text-foreground/70">Tuning model:</span> {config.model_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                  {config.train_params && config.train_params.length > 0 && (
                    <p className="text-muted-foreground truncate">
                      <span className="text-foreground/70">Tuning training:</span> {config.train_params.map((p) => p.name).join(", ")}
                    </p>
                  )}
                  {config.trial_train_params && Object.keys(config.trial_train_params).length > 0 && (
                    <p className="text-muted-foreground truncate">
                      <span className="text-foreground/70">Per-trial:</span> {Object.entries(config.trial_train_params).map(([k, v]) => `${k}=${v}`).join(", ")}
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

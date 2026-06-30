/**
 * ModelRenderer - Model step configuration renderer
 *
 * Specialized renderer for model steps that includes:
 * - Parameters tab with algorithm selection
 * - Finetuning tab for Optuna hyperparameter optimization
 * - Training tab for deep learning models (epochs, batch size, etc.)
 *
 * Features:
 * - Lazy loading of FinetuneTab with preload on hover
 *
 * Phase 3 Implementation - Component Refactoring
 * @see docs/_internals/implementation_roadmap.md
 */

import { useCallback, useState } from "react";
import { type PipelineStep } from "../../types";
import { StepActions } from "./StepActions";
import type { ParameterRendererProps } from "./types";
import { getModelRendererViewState } from "./ModelRendererData";
import { ModelConfigTabs } from "./ModelRendererTabs";

/**
 * ModelRenderer - Tabbed configuration for model steps
 *
 * Four tabs:
 * 1. Parameters - Model selection and hyperparameters
 * 2. Finetuning - Optuna hyperparameter optimization
 * 3. Refit - Refit configuration (retrain on full data after CV)
 * 4. Training - Deep learning training config (only for DL models)
 */
export function ModelRenderer({
  step,
  onUpdate,
  onRemove,
  onDuplicate,
  renderParamInput,
  handleResetParams,
  currentOption,
}: ParameterRendererProps) {
  const [activeTab, setActiveTab] = useState("parameters");

  const viewState = getModelRendererViewState(step, currentOption);

  const handleStepUpdate = useCallback(
    (updates: Partial<PipelineStep>) => {
      onUpdate(step.id, updates);
    },
    [onUpdate, step.id]
  );

  const handleConfigureFinetuning = useCallback(() => {
    setActiveTab("finetuning");
  }, []);

  return (
    <>
      <ModelConfigTabs
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
        step={step}
        viewState={viewState}
        renderParamInput={renderParamInput}
        onResetParams={handleResetParams}
        onConfigureFinetuning={handleConfigureFinetuning}
        onUpdateStep={handleStepUpdate}
      />

      <StepActions
        stepId={step.id}
        onDuplicate={onDuplicate}
        onRemove={onRemove}
      />
    </>
  );
}

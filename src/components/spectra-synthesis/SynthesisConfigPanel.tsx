/**
 * SynthesisConfigPanel - Right panel for step configuration
 *
 * Displays configuration form for the selected step.
 */

import { Settings } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSynthesisBuilder } from "./contexts";
import { getStepDefinition } from "./definitions";
import { FeaturesConfig } from "./config/FeaturesConfig";
import { TargetsConfig } from "./config/TargetsConfig";
import { ClassificationConfig } from "./config/ClassificationConfig";
import { PartitionsConfig } from "./config/PartitionsConfig";
import { MetadataConfig } from "./config/MetadataConfig";
import { BatchEffectsConfig } from "./config/BatchEffectsConfig";
import { NonlinearConfig } from "./config/NonlinearConfig";
import { TargetComplexityConfig } from "./config/TargetComplexityConfig";
import { ComplexLandscapeConfig } from "./config/ComplexLandscapeConfig";
import type { SynthesisStep, SynthesisStepType } from "./types";
import { cn } from "@/lib/utils";

interface SynthesisConfigPanelProps {
  className?: string;
}

export function SynthesisConfigPanel({ className }: SynthesisConfigPanelProps) {
  const { state, getSelectedStep, updateStep } = useSynthesisBuilder();
  const selectedStep = getSelectedStep();

  const handleParamsChange = (params: Record<string, unknown>) => {
    if (selectedStep) {
      updateStep(selectedStep.id, params);
    }
  };

  return (
    <div className={cn("flex flex-col h-full", className)}>
      <div className="p-4 border-b">
        <h2 className="text-sm font-semibold">Configuration</h2>
        <p className="text-xs text-muted-foreground mt-1">
          {selectedStep
            ? `Configure ${getStepDefinition(selectedStep.type)?.name}`
            : "Select a step to configure"}
        </p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {selectedStep ? (
            <ConfigRenderer
              step={selectedStep}
              onParamsChange={handleParamsChange}
            />
          ) : (
            <EmptyState />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

interface ConfigRendererProps {
  step: SynthesisStep;
  onParamsChange: (params: Record<string, unknown>) => void;
}

function ConfigRenderer({ step, onParamsChange }: ConfigRendererProps) {
  const definition = getStepDefinition(step.type);
  if (!definition) return null;

  // Render the appropriate config component based on step type
  switch (step.type) {
    case "features":
      return (
        <FeaturesConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "targets":
      return (
        <TargetsConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "classification":
      return (
        <ClassificationConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "partitions":
      return (
        <PartitionsConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "metadata":
      return (
        <MetadataConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "batch_effects":
      return (
        <BatchEffectsConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "nonlinear_targets":
      return (
        <NonlinearConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "target_complexity":
      return (
        <TargetComplexityConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    case "complex_landscape":
      return (
        <ComplexLandscapeConfig
          params={step.params}
          definition={definition}
          onChange={onParamsChange}
        />
      );
    default:
      return <GenericConfig step={step} onParamsChange={onParamsChange} />;
  }
}

// Generic config for steps without specific components
interface GenericConfigProps {
  step: SynthesisStep;
  onParamsChange: (params: Record<string, unknown>) => void;
}

function GenericConfig({ step, onParamsChange }: GenericConfigProps) {
  const definition = getStepDefinition(step.type);
  if (!definition) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Settings className="h-4 w-4" />
        <span className="text-sm">Configuration for {definition.name}</span>
      </div>
      <pre className="text-xs bg-muted p-2 rounded overflow-auto">
        {JSON.stringify(step.params, null, 2)}
      </pre>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Settings className="h-6 w-6 text-muted-foreground" />
      </div>
      <h3 className="mt-4 text-sm font-medium">No Step Selected</h3>
      <p className="mt-2 text-xs text-muted-foreground max-w-[200px]">
        Select a step from the builder to configure its parameters
      </p>
    </div>
  );
}

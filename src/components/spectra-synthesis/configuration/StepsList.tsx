/**
 * StepsList - Accordion-style step configuration
 *
 * Cleaner interaction model:
 * - Each step type shown as a row with checkbox to add/remove
 * - Clicking an added step expands its configuration inline
 * - Categories group related steps
 */

import { useMemo, useState } from "react";
import {
  Waves,
  Target,
  Database,
  Sparkles,
  Brain,
  FileOutput,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useSynthesisBuilder } from "../contexts";
import {
  SYNTHESIS_CATEGORIES,
  getStepsByCategory,
  getStepDefinition,
} from "../definitions";
import { FeaturesConfig } from "../config/FeaturesConfig";
import { TargetsConfig } from "../config/TargetsConfig";
import { ClassificationConfig } from "../config/ClassificationConfig";
import { PartitionsConfig } from "../config/PartitionsConfig";
import { MetadataConfig } from "../config/MetadataConfig";
import { BatchEffectsConfig } from "../config/BatchEffectsConfig";
import { NonlinearConfig } from "../config/NonlinearConfig";
import { TargetComplexityConfig } from "../config/TargetComplexityConfig";
import { ComplexLandscapeConfig } from "../config/ComplexLandscapeConfig";
import type { SynthesisStep, SynthesisStepDefinition } from "../types";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Waves,
  Target,
  Database,
  Sparkles,
  Brain,
  FileOutput,
};

interface StepsListProps {
  className?: string;
}

export function StepsList({ className }: StepsListProps) {
  const { state, addStep, removeStep, updateStep, toggleStep } =
    useSynthesisBuilder();

  const activeStepsCount = useMemo(
    () => state.steps.filter((s) => s.enabled).length,
    [state.steps]
  );

  // Track which step is expanded for config
  const [expandedStep, setExpandedStep] = useState<string | undefined>(
    undefined
  );

  const handleStepToggle = (
    stepDef: SynthesisStepDefinition,
    isCurrentlyAdded: boolean
  ) => {
    if (isCurrentlyAdded) {
      const step = state.steps.find((s) => s.type === stepDef.type);
      if (step) {
        removeStep(step.id);
        if (expandedStep === step.id) {
          setExpandedStep(undefined);
        }
      }
    } else {
      addStep(stepDef.type);
      // Auto-expand the newly added step
      setTimeout(() => {
        const newStep = state.steps.find((s) => s.type === stepDef.type);
        if (newStep) {
          setExpandedStep(newStep.id);
        }
      }, 0);
    }
  };

  const handleParamsChange =
    (stepId: string) => (params: Record<string, unknown>) => {
      updateStep(stepId, params);
    };

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between px-1 mb-2">
        <h3 className="text-sm font-semibold">Builder Steps</h3>
        <Badge variant="secondary" className="text-xs">
          {activeStepsCount} active
        </Badge>
      </div>

      <Accordion
        type="single"
        collapsible
        value={expandedStep}
        onValueChange={setExpandedStep}
        className="space-y-1"
      >
        {SYNTHESIS_CATEGORIES.filter((cat) => cat.id !== "output").map(
          (category) => (
            <CategoryGroup
              key={category.id}
              category={category}
              state={state}
              expandedStep={expandedStep}
              onStepToggle={handleStepToggle}
              onEnableToggle={toggleStep}
              onParamsChange={handleParamsChange}
            />
          )
        )}
      </Accordion>
    </div>
  );
}

interface CategoryGroupProps {
  category: (typeof SYNTHESIS_CATEGORIES)[0];
  state: ReturnType<typeof useSynthesisBuilder>["state"];
  expandedStep: string | undefined;
  onStepToggle: (
    stepDef: SynthesisStepDefinition,
    isCurrentlyAdded: boolean
  ) => void;
  onEnableToggle: (id: string) => void;
  onParamsChange: (stepId: string) => (params: Record<string, unknown>) => void;
}

function CategoryGroup({
  category,
  state,
  onStepToggle,
  onEnableToggle,
  onParamsChange,
}: CategoryGroupProps) {
  const steps = getStepsByCategory(category.id);
  const Icon = CATEGORY_ICONS[category.icon] || Sparkles;

  // Count added steps in this category
  const addedCount = steps.filter((s) =>
    state.steps.some((added) => added.type === s.type)
  ).length;

  return (
    <div className="rounded-lg border bg-card/50">
      {/* Category header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium flex-1">{category.label}</span>
        {addedCount > 0 && (
          <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
            {addedCount}
          </Badge>
        )}
      </div>

      {/* Steps in category */}
      <div className="p-1">
        {steps.map((stepDef) => {
          const addedStep = state.steps.find((s) => s.type === stepDef.type);
          const isAdded = !!addedStep;

          return (
            <StepRow
              key={stepDef.id}
              definition={stepDef}
              addedStep={addedStep}
              onToggleAdd={() => onStepToggle(stepDef, isAdded)}
              onToggleEnabled={() => addedStep && onEnableToggle(addedStep.id)}
              onParamsChange={
                addedStep ? onParamsChange(addedStep.id) : () => {}
              }
            />
          );
        })}
      </div>
    </div>
  );
}

interface StepRowProps {
  definition: SynthesisStepDefinition;
  addedStep?: SynthesisStep;
  onToggleAdd: () => void;
  onToggleEnabled: () => void;
  onParamsChange: (params: Record<string, unknown>) => void;
}

function StepRow({
  definition,
  addedStep,
  onToggleAdd,
  onToggleEnabled,
  onParamsChange,
}: StepRowProps) {
  const isAdded = !!addedStep;
  const isEnabled = addedStep?.enabled ?? false;

  if (!isAdded) {
    // Not added - simple row with checkbox to add
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
        onClick={onToggleAdd}
      >
        <Checkbox checked={false} className="h-4 w-4" />
        <span className="text-sm flex-1">{definition.name}</span>
        <span className="text-[10px] text-muted-foreground">
          .{definition.method}()
        </span>
      </div>
    );
  }

  // Added - accordion item with config
  return (
    <AccordionItem
      value={addedStep.id}
      className={cn(
        "border rounded-md mb-1",
        definition.color.border,
        definition.color.bg,
        !isEnabled && "opacity-50"
      )}
    >
      <AccordionTrigger className="px-2 py-1.5 hover:no-underline [&[data-state=open]>svg]:rotate-90">
        <div className="flex items-center gap-2 flex-1">
          <Checkbox
            checked={true}
            className="h-4 w-4"
            onClick={(e) => {
              e.stopPropagation();
              onToggleAdd();
            }}
          />
          <span className={cn("text-sm font-medium", definition.color.text)}>
            {definition.name}
          </span>
          <span className="text-[10px] text-muted-foreground">
            .{definition.method}()
          </span>
        </div>
        <div
          className="flex items-center gap-2 mr-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Switch
            checked={isEnabled}
            onCheckedChange={onToggleEnabled}
            className="h-4 w-7"
          />
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3 pt-1">
        <StepConfig
          step={addedStep}
          definition={definition}
          onParamsChange={onParamsChange}
        />
      </AccordionContent>
    </AccordionItem>
  );
}

interface StepConfigProps {
  step: SynthesisStep;
  definition: SynthesisStepDefinition;
  onParamsChange: (params: Record<string, unknown>) => void;
}

function StepConfig({ step, definition, onParamsChange }: StepConfigProps) {
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
      return (
        <div className="text-xs text-muted-foreground">
          <pre className="bg-muted p-2 rounded overflow-auto max-h-32">
            {JSON.stringify(step.params, null, 2)}
          </pre>
        </div>
      );
  }
}

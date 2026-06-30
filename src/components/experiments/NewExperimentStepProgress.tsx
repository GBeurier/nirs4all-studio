import { Check, Database, Filter, GitBranch, Play, type LucideIcon } from "lucide-react";

import {
  buildNewExperimentStepProgress,
  NEW_EXPERIMENT_DATASETS_STEP,
  NEW_EXPERIMENT_LAUNCH_STEP,
  NEW_EXPERIMENT_PIPELINES_STEP,
  NEW_EXPERIMENT_REVIEW_STEP,
  NEW_EXPERIMENT_RUNTIME_GROUPING_STEP,
  type NewExperimentWizardStep,
} from "@/lib/experimentWizardFlow";
import { cn } from "@/lib/utils";

const wizardStepIcons: Record<NewExperimentWizardStep, LucideIcon> = {
  [NEW_EXPERIMENT_PIPELINES_STEP]: GitBranch,
  [NEW_EXPERIMENT_DATASETS_STEP]: Database,
  [NEW_EXPERIMENT_RUNTIME_GROUPING_STEP]: Filter,
  [NEW_EXPERIMENT_REVIEW_STEP]: Check,
  [NEW_EXPERIMENT_LAUNCH_STEP]: Play,
};

export interface NewExperimentStepProgressProps {
  currentStep: NewExperimentWizardStep;
}

export function NewExperimentStepProgress({ currentStep }: NewExperimentStepProgressProps) {
  const wizardSteps = buildNewExperimentStepProgress(currentStep);

  return (
    <nav aria-label="Experiment steps" className="mx-auto flex max-w-4xl items-center justify-between">
      <ol className="flex w-full items-center justify-between">
        {wizardSteps.map((step) => {
          const StepIcon = wizardStepIcons[step.id];

          return (
            <li
              key={step.id}
              aria-current={step.isActive ? "step" : undefined}
              className="flex items-center"
            >
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                    step.isActive
                      ? "border-primary bg-primary text-primary-foreground"
                      : step.isCompleted
                        ? "border-chart-1 bg-chart-1 text-primary-foreground"
                        : "border-border bg-card text-muted-foreground",
                  )}
                >
                  {step.isCompleted ? <Check className="h-5 w-5" /> : <StepIcon className="h-5 w-5" />}
                </div>
                <span
                  className={cn(
                    "mt-2 text-xs",
                    step.isActive ? "font-medium text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {!step.isLast && (
                <div className={cn("mx-2 h-0.5 w-16", step.isCompleted ? "bg-chart-1" : "bg-border")} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

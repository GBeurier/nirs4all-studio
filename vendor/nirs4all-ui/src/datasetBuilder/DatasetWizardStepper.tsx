import type { ReactNode } from "react";

import { cx } from "./_cx.js";
import { icon, type BuilderIconKey } from "./icons.js";
import { STRINGS } from "./locale.js";
import type { Locale } from "./roles.js";
import type { WizardStep } from "./types.js";

const STEP_ORDER: WizardStep[] = ["source", "role", "columns", "validation"];

export interface DatasetWizardStepperProps {
  activeStep: WizardStep;
  completedSteps?: WizardStep[];
  onStepClick?: (step: WizardStep) => void;
  locale?: Locale;
  icons?: Partial<Record<BuilderIconKey, ReactNode>> | undefined;
  className?: string;
}

/** Horizontal 4-step wizard header (Source / Rôle / Colonnes / Validation). */
export function DatasetWizardStepper({
  activeStep,
  completedSteps = [],
  onStepClick,
  locale = "fr",
  icons,
  className,
}: DatasetWizardStepperProps) {
  const t = STRINGS[locale];
  const completed = new Set(completedSteps);
  const activeIndex = STEP_ORDER.indexOf(activeStep);

  return (
    <ol className={cx("dsb-stepper", className)}>
      {STEP_ORDER.map((step, index) => {
        const isDone = completed.has(step) || index < activeIndex;
        const isActive = step === activeStep;
        const state = isActive ? "active" : isDone ? "done" : "todo";
        return (
          <li key={step} className="dsb-stepper__item" data-state={state}>
            <button
              type="button"
              className="dsb-stepper__button"
              onClick={onStepClick ? () => onStepClick(step) : undefined}
              disabled={!onStepClick}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="dsb-stepper__marker" aria-hidden="true">
                {isDone ? icon("check", icons) : index + 1}
              </span>
              <span className="dsb-stepper__label">
                <span className="dsb-stepper__index">{index + 1}.</span> {t.steps[step]}
              </span>
            </button>
            {index < STEP_ORDER.length - 1 ? <span className="dsb-stepper__line" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}

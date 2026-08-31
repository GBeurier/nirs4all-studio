import type { ReactNode } from 'react';

import { cx } from './_cx.js';

export interface StepProgressItem {
  id: string;
  label: string;
  /** optional short caption under the label */
  caption?: string;
}

export type StepState = 'completed' | 'active' | 'upcoming';

export interface StepProgressProps {
  steps: readonly StepProgressItem[];
  /** id of the active step (preferred) */
  activeId?: string | null;
  /** index of the active step (fallback if `activeId` is absent) */
  activeIndex?: number | null;
  /** click handler (only fired for enabled steps — completed or active) */
  onSelect?: (id: string, index: number) => void;
  /** allow navigating to upcoming steps too (default false) */
  allowUpcoming?: boolean;

  className?: string;
  stepClassName?: string;
  completedClassName?: string;
  activeClassName?: string;
  upcomingClassName?: string;
  markerClassName?: string;
  labelClassName?: string;
  captionClassName?: string;
  /** custom marker (else the 1-based index / a check for completed) */
  renderMarker?: (state: StepState, index: number) => ReactNode;
}

/**
 * Numbered-circle workflow stepper (§3 rail: Préparer → Calibrer → Utiliser).
 * Presentational; the host owns which step is active and what selecting does.
 */
export function StepProgress({
  steps,
  activeId,
  activeIndex,
  onSelect,
  allowUpcoming = false,
  className,
  stepClassName,
  completedClassName,
  activeClassName,
  upcomingClassName,
  markerClassName,
  labelClassName,
  captionClassName,
  renderMarker,
}: StepProgressProps) {
  const active = resolveActiveIndex(steps, activeId, activeIndex);
  return (
    <ol className={className}>
      {steps.map((step, index) => {
        const state: StepState = index < active ? 'completed' : index === active ? 'active' : 'upcoming';
        const stateClass = state === 'completed' ? completedClassName
          : state === 'active' ? activeClassName
            : upcomingClassName;
        const enabled = !!onSelect && (state !== 'upcoming' || allowUpcoming);
        return (
          <li
            key={step.id}
            className={cx(stepClassName, stateClass)}
            data-step-id={step.id}
            data-step-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
            onClick={enabled ? () => onSelect?.(step.id, index) : undefined}
          >
            <span className={markerClassName}>
              {renderMarker ? renderMarker(state, index) : index + 1}
            </span>
            <span className={labelClassName}>{step.label}</span>
            {step.caption ? <span className={captionClassName}>{step.caption}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function resolveActiveIndex(
  steps: readonly StepProgressItem[],
  activeId: string | null | undefined,
  activeIndex: number | null | undefined,
): number {
  if (activeId != null) {
    const found = steps.findIndex((s) => s.id === activeId);
    if (found >= 0) return found;
  }
  if (typeof activeIndex === 'number' && Number.isFinite(activeIndex)) {
    return Math.max(0, Math.min(steps.length - 1, Math.trunc(activeIndex)));
  }
  return 0;
}

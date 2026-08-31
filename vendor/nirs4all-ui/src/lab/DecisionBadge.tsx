import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  buildDecisionView,
  type DecisionIcon,
  type DecisionInput,
  type DecisionThresholds,
  type DecisionView,
} from './decision.js';
import type { Locale } from './locale.js';

export interface DecisionBadgeProps {
  /** raw applicability signals — the badge computes the decision */
  input?: DecisionInput;
  /** per-method thresholds (used with `input`) */
  thresholds?: DecisionThresholds | null;
  /** a precomputed decision view (takes precedence over `input`) */
  view?: DecisionView | null;
  /** language for generated text (default 'fr') */
  locale?: Locale;
  /** host-provided icons keyed by the decision icon token */
  icons?: Partial<Record<DecisionIcon, ReactNode>>;
  /** show the label text (default true) */
  showLabel?: boolean;
  /** override the label */
  label?: string | null;
  /** apply the view's colour/tint tokens by default (default true; false = host styles fully) */
  applyTone?: boolean;
  /** container class; defaults to the view's suggested colour + tint tokens */
  className?: string;
  /** override the auto colour/tint tokens */
  toneClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
  title?: string;
}

/**
 * Compact traffic-light badge for one decision (🟢🟠🔴🔵). Presentational only:
 * the colour comes from the pure decision view-model; the host supplies the icon
 * nodes and may override any class.
 */
export function DecisionBadge({
  input,
  thresholds,
  view,
  locale = 'fr',
  icons,
  showLabel = true,
  label,
  applyTone = true,
  className,
  toneClassName,
  iconClassName,
  labelClassName,
  title,
}: DecisionBadgeProps) {
  const v = view ?? buildDecisionView(input ?? {}, thresholds, locale);
  const icon = icons?.[v.icon] ?? null;
  const tone = toneClassName ?? (applyTone ? cx(v.colorClass, v.bgClass) : undefined);
  return (
    <span
      className={cx(className, tone)}
      data-decision={v.color}
      title={title ?? v.reason}
    >
      {icon ? <span className={iconClassName}>{icon}</span> : null}
      {showLabel ? <span className={labelClassName}>{label ?? v.label}</span> : null}
    </span>
  );
}

import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  DECISION_DISPLAY,
  type DecisionColor,
  type DecisionIcon,
} from './decision.js';
import { loc, type Locale } from './locale.js';

/** Order the four colours are shown in the legend. */
const LEGEND_ORDER: readonly DecisionColor[] = ['reliable', 'caution', 'out_of_domain', 'informative'];

export interface TrafficLightLegendProps {
  /** host icons keyed by decision icon token */
  icons?: Partial<Record<DecisionIcon, ReactNode>>;
  /** restrict to a subset of colours, in a custom order */
  colors?: readonly DecisionColor[];
  /** show the authorized-action line under each colour (default true) */
  showAction?: boolean;
  /** apply each colour's tokens by default (default true) */
  applyTone?: boolean;
  /** language for the labels/actions (default 'fr') */
  locale?: Locale;

  className?: string;
  itemClassName?: string;
  toneClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
  actionClassName?: string;
}

/**
 * Pedagogical legend of the four-colour decision contract (§4bis). Reads the
 * shared `DECISION_DISPLAY` catalogue so the legend can never drift from the
 * decisions the app actually makes. Presentational.
 */
export function TrafficLightLegend({
  icons,
  colors = LEGEND_ORDER,
  showAction = true,
  applyTone = true,
  locale = 'fr',
  className,
  itemClassName,
  toneClassName,
  iconClassName,
  labelClassName,
  actionClassName,
}: TrafficLightLegendProps) {
  return (
    <ul className={className}>
      {colors.map((color) => {
        const d = DECISION_DISPLAY[color];
        const icon = icons?.[d.icon] ?? null;
        const toneFg = applyTone ? d.colorClass : undefined;
        return (
          <li key={color} className={cx(itemClassName, toneClassName ?? (applyTone ? d.bgClass : undefined))} data-decision={color}>
            {icon ? <span className={cx(iconClassName, toneFg)}>{icon}</span> : null}
            <span className={cx(labelClassName, toneFg)}>{loc(d.label, locale)}</span>
            {showAction ? <span className={actionClassName}>{loc(d.action, locale)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

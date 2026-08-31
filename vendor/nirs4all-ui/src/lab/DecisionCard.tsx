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

export interface DecisionCardProps {
  /** the sample this prediction concerns */
  sampleId?: string | null;
  /** predicted value (host formats numbers as it wishes via `formatValue`) */
  predicted?: number | string | null;
  /** half-width or full label of the conformal interval, e.g. "± 0.42" */
  interval?: string | null;
  /** the target unit (e.g. "%") */
  unit?: string | null;

  input?: DecisionInput;
  thresholds?: DecisionThresholds | null;
  view?: DecisionView | null;
  /** language for generated text (default 'fr') */
  locale?: Locale;

  icons?: Partial<Record<DecisionIcon, ReactNode>>;
  /** render-prop for the "see detail" affordance (else a default label is shown) */
  renderDetailLink?: (view: DecisionView) => ReactNode;
  /** show a detail affordance at all (default true — §4bis requires one) */
  showDetail?: boolean;
  /** default detail affordance label when `renderDetailLink` is absent */
  detailLabel?: string;

  formatValue?: (value: number | string) => ReactNode;

  /** apply the view's colour/tint tokens by default (default true; false = host styles fully) */
  applyTone?: boolean;

  className?: string;
  toneClassName?: string;
  headerClassName?: string;
  valueClassName?: string;
  intervalClassName?: string;
  labelClassName?: string;
  reasonClassName?: string;
  actionClassName?: string;
  confidenceClassName?: string;
  detailClassName?: string;
  iconClassName?: string;
}

/**
 * The per-prediction reliability card (§3 Écran 5). ALWAYS shows: status +
 * main reason + authorized action + confidence + a detail affordance — never a
 * bare colour. Presentational; the decision comes from the pure view-model.
 */
export function DecisionCard({
  sampleId,
  predicted,
  interval,
  unit,
  input,
  thresholds,
  view,
  locale = 'fr',
  icons,
  renderDetailLink,
  showDetail = true,
  detailLabel,
  formatValue,
  applyTone = true,
  className,
  toneClassName,
  headerClassName,
  valueClassName,
  intervalClassName,
  labelClassName,
  reasonClassName,
  actionClassName,
  confidenceClassName,
  detailClassName,
  iconClassName,
}: DecisionCardProps) {
  const v = view ?? buildDecisionView(input ?? {}, thresholds, locale);
  const icon = icons?.[v.icon] ?? null;
  const toneFg = applyTone ? v.colorClass : undefined;
  const toneBg = toneClassName ?? (applyTone ? v.bgClass : undefined);
  const valueNode = predicted == null
    ? null
    : formatValue
      ? formatValue(predicted)
      : `${predicted}${unit ? ` ${unit}` : ''}`;
  const detail = renderDetailLink
    ? renderDetailLink(v)
    : showDetail
      ? <span className={detailClassName} data-detail>{detailLabel ?? (locale === 'en' ? 'See details' : 'Voir le détail')}</span>
      : null;

  return (
    <article
      className={cx(className, toneBg)}
      data-decision={v.color}
      data-sample-id={sampleId ?? undefined}
    >
      <header className={headerClassName}>
        {icon ? <span className={cx(iconClassName, toneFg)}>{icon}</span> : null}
        <span className={cx(labelClassName, toneFg)}>{v.label}</span>
        <span className={confidenceClassName} data-confidence={v.confidence}>{confidenceLabel(v.confidence, locale)}</span>
      </header>
      {valueNode != null ? (
        <div>
          <strong className={valueClassName}>{valueNode}</strong>
          {interval ? <span className={intervalClassName}>{interval}</span> : null}
        </div>
      ) : null}
      <p className={reasonClassName}>{v.reason}</p>
      <p className={actionClassName}>{v.action}</p>
      {detail}
    </article>
  );
}

function confidenceLabel(confidence: DecisionView['confidence'], locale: Locale): string {
  const en = locale === 'en';
  if (confidence === 'high') return en ? 'high confidence' : 'confiance élevée';
  if (confidence === 'medium') return en ? 'medium confidence' : 'confiance moyenne';
  return en ? 'low confidence' : 'confiance faible';
}

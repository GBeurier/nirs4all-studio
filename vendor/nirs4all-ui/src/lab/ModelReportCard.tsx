import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  buildModelReportView,
  type MetricInterpretation,
  type ModelMetricsInput,
  type ModelReportThresholds,
  type ModelReportView,
} from './modelReport.js';
import type { Locale } from './locale.js';

export interface ModelReportCardProps {
  metrics?: ModelMetricsInput;
  thresholds?: ModelReportThresholds | null;
  /** precomputed view (takes precedence) */
  view?: ModelReportView | null;
  /** language for generated text (default 'fr') */
  locale?: Locale;

  title?: ReactNode;
  /** render a metric row (else the default label + value + reading) */
  renderMetric?: (metric: MetricInterpretation) => ReactNode;
  /** per-metric tone → className (host maps good/fair/poor/neutral) */
  metricToneClassName?: Partial<Record<MetricInterpretation['tone'], string>>;

  /** apply the grade colour/tint tokens by default (default true) */
  applyTone?: boolean;
  className?: string;
  toneClassName?: string;
  headerClassName?: string;
  verdictClassName?: string;
  gradeLabelClassName?: string;
  metricsClassName?: string;
  metricRowClassName?: string;
  metricLabelClassName?: string;
  metricValueClassName?: string;
  metricReadingClassName?: string;
  empty?: ReactNode;
}

/** The model "bulletin" (§3 Écran 4). Presentational; grade from the view-model. */
export function ModelReportCard({
  metrics,
  thresholds,
  view,
  locale = 'fr',
  title,
  renderMetric,
  metricToneClassName,
  applyTone = true,
  className,
  toneClassName,
  headerClassName,
  verdictClassName,
  gradeLabelClassName,
  metricsClassName,
  metricRowClassName,
  metricLabelClassName,
  metricValueClassName,
  metricReadingClassName,
  empty,
}: ModelReportCardProps) {
  const v = view ?? (metrics ? buildModelReportView(metrics, thresholds, locale) : null);
  if (!v) return empty == null ? null : <>{empty}</>;

  const toneFg = applyTone ? v.colorClass : undefined;
  return (
    <article className={cx(className, toneClassName ?? (applyTone ? v.bgClass : undefined))} data-grade={v.grade}>
      <header className={headerClassName}>
        {title}
        <span className={cx(gradeLabelClassName, toneFg)}>{v.gradeLabel}</span>
        <span className={cx(verdictClassName, toneFg)}>{v.verdict}</span>
      </header>
      <dl className={metricsClassName}>
        {v.metrics.map((m) => renderMetric ? (
          <div key={m.key}>{renderMetric(m)}</div>
        ) : (
          <div
            key={m.key}
            className={cx(metricRowClassName, metricToneClassName?.[m.tone])}
            data-metric={m.key}
            data-tone={m.tone}
          >
            <dt className={metricLabelClassName}>{m.label}</dt>
            <dd className={metricValueClassName}>{m.display}</dd>
            <dd className={metricReadingClassName}>{m.reading}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

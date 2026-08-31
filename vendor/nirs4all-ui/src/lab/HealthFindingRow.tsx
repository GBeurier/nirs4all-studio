import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  buildHealthFindingView,
  formatAffected,
  type HealthFindingInput,
  type HealthFindingView,
  type HealthIcon,
} from './health.js';

export interface HealthFindingRowProps {
  finding?: HealthFindingInput;
  /** a precomputed view (takes precedence) */
  view?: HealthFindingView | null;
  icons?: Partial<Record<HealthIcon, ReactNode>>;
  /** render-prop for the action control (button/select) */
  renderAction?: (view: HealthFindingView) => ReactNode;
  /** expandable "why does it matter?" content */
  explanation?: ReactNode;

  /** apply the severity colour/tint tokens by default (default true) */
  applyTone?: boolean;
  className?: string;
  toneClassName?: string;
  iconClassName?: string;
  titleClassName?: string;
  detailClassName?: string;
  affectedClassName?: string;
  actionLabelClassName?: string;
  empty?: ReactNode;
}

/** One row of the "Santé des données" check-list (§3 Écran 2). Presentational. */
export function HealthFindingRow({
  finding,
  view,
  icons,
  renderAction,
  explanation,
  applyTone = true,
  className,
  toneClassName,
  iconClassName,
  titleClassName,
  detailClassName,
  affectedClassName,
  actionLabelClassName,
  empty,
}: HealthFindingRowProps) {
  const v = view ?? (finding ? buildHealthFindingView(finding) : null);
  if (!v) return empty == null ? null : <>{empty}</>;

  const icon = icons?.[v.icon] ?? null;
  const affected = formatAffected(v.affectedCount);
  const action = renderAction
    ? renderAction(v)
    : <span className={actionLabelClassName}>{v.actionLabel}</span>;

  return (
    <li
      className={cx(className, toneClassName ?? (applyTone ? v.bgClass : undefined))}
      data-finding-id={v.id}
      data-severity={v.severity}
    >
      {icon ? <span className={cx(iconClassName, applyTone ? v.colorClass : undefined)}>{icon}</span> : null}
      <div>
        <span className={titleClassName}>{v.title}</span>
        {v.detail ? <span className={detailClassName}>{v.detail}</span> : null}
        {affected ? <span className={affectedClassName}>{affected}</span> : null}
        {explanation}
      </div>
      {action}
    </li>
  );
}

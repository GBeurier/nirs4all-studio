import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  getSampleStatusDisplay,
  type SampleStatusDisplay,
  type SampleStatusIcon,
} from './sampleStatus.js';

export interface SampleStatusBadgeProps {
  status?: string | null;
  /** a precomputed display (takes precedence) */
  display?: SampleStatusDisplay | null;
  icons?: Partial<Record<SampleStatusIcon, ReactNode>>;
  showLabel?: boolean;
  label?: string | null;
  /** apply the status colour/tint tokens by default (default true) */
  applyTone?: boolean;
  className?: string;
  toneClassName?: string;
  iconClassName?: string;
  labelClassName?: string;
  title?: string;
}

/** Badge for a sample's lifecycle status (§1bis). Presentational. */
export function SampleStatusBadge({
  status,
  display,
  icons,
  showLabel = true,
  label,
  applyTone = true,
  className,
  toneClassName,
  iconClassName,
  labelClassName,
  title,
}: SampleStatusBadgeProps) {
  const d: SampleStatusDisplay = display ?? getSampleStatusDisplay(status);
  const icon = icons?.[d.icon] ?? null;
  return (
    <span
      className={cx(className, toneClassName ?? (applyTone ? cx(d.colorClass, d.bgClass) : undefined))}
      data-sample-status={d.status}
      title={title ?? d.description}
    >
      {icon ? <span className={iconClassName}>{icon}</span> : null}
      {showLabel ? <span className={labelClassName}>{label ?? d.label}</span> : null}
    </span>
  );
}

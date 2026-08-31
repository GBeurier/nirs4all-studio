import type { ReactNode } from 'react';

import { cx } from './_cx.js';
import {
  buildWorklistViews,
  type SafetyFlag,
  type WorklistItemInput,
  type WorklistItemView,
} from './worklist.js';
import type { Locale } from './locale.js';

export interface WorklistTableProps {
  items?: readonly WorklistItemInput[];
  /** precomputed, already-sorted views (takes precedence) */
  views?: readonly WorklistItemView[] | null;
  /** language for generated labels (default 'fr') */
  locale?: Locale;
  /** host icons keyed by safety flag */
  safetyIcons?: Partial<Record<SafetyFlag, ReactNode>>;
  /** column headers (host-localized); omit to hide the header */
  headers?: { rank?: string; sampleId?: string; barcode?: string; reason?: string; safety?: string };
  /** render the barcode cell (e.g. a scannable code); default = text */
  renderBarcode?: (barcode: string, item: WorklistItemView) => ReactNode;

  className?: string;
  theadClassName?: string;
  rowClassName?: string;
  cellClassName?: string;
  safetyClassName?: string;
  empty?: ReactNode;
}

/**
 * The HPLC / re-measure worklist table (§3 Écran 3 output) — the bridge to the
 * bench. Presentational; rows come from the pure worklist view-model.
 */
export function WorklistTable({
  items,
  views,
  locale = 'fr',
  safetyIcons,
  headers,
  renderBarcode,
  className,
  theadClassName,
  rowClassName,
  cellClassName,
  safetyClassName,
  empty,
}: WorklistTableProps) {
  const rows = views ?? (items ? buildWorklistViews(items, locale) : []);
  if (rows.length === 0) return empty == null ? null : <>{empty}</>;

  return (
    <table className={className}>
      {headers ? (
        <thead className={theadClassName}>
          <tr>
            {headers.rank ? <th>{headers.rank}</th> : null}
            {headers.sampleId ? <th>{headers.sampleId}</th> : null}
            {headers.barcode ? <th>{headers.barcode}</th> : null}
            {headers.reason ? <th>{headers.reason}</th> : null}
            {headers.safety ? <th>{headers.safety}</th> : null}
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row) => {
          const icon = safetyIcons?.[row.safety] ?? null;
          return (
            <tr
              key={row.sampleId}
              className={rowClassName}
              data-sample-id={row.sampleId}
              data-safety={row.safety}
            >
              {headers?.rank ? <td className={cellClassName}>{row.rank ?? ''}</td> : null}
              <td className={cellClassName}>{row.sampleId}</td>
              {headers?.barcode ? (
                <td className={cellClassName}>
                  {row.barcode
                    ? (renderBarcode ? renderBarcode(row.barcode, row) : row.barcode)
                    : ''}
                </td>
              ) : null}
              {headers?.reason ? <td className={cellClassName}>{row.reasonLabel ?? ''}</td> : null}
              <td className={cx(cellClassName, safetyClassName, row.safetyColorClass)}>
                {icon ? <span>{icon}</span> : null}
                <span>{row.safetyLabel}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

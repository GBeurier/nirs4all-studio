import type { ReactNode } from "react";

import {
  buildDatasetPreview,
  type DatasetPreviewBadge,
  type DatasetPreviewInput,
  type DatasetPreviewStat,
  type DatasetPreviewView,
} from "../dataset/index.js";

export interface DatasetPreviewCardProps {
  dataset?: DatasetPreviewInput | null;
  view?: DatasetPreviewView | null;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  badgeListClassName?: string;
  badgeClassName?: string | ((badge: DatasetPreviewBadge) => string | undefined);
  statListClassName?: string;
  statClassName?: string | ((stat: DatasetPreviewStat) => string | undefined);
  statLabelClassName?: string;
  statValueClassName?: string;
  statDetailClassName?: string;
  empty?: ReactNode;
  renderBadge?: (badge: DatasetPreviewBadge) => ReactNode;
  renderStat?: (stat: DatasetPreviewStat) => ReactNode;
}

function resolveClassName<T>(
  className: string | ((item: T) => string | undefined) | undefined,
  item: T,
): string | undefined {
  return typeof className === "function" ? className(item) : className;
}

function defaultStatNode(
  stat: DatasetPreviewStat,
  labelClassName: string | undefined,
  valueClassName: string | undefined,
  detailClassName: string | undefined,
) {
  return (
    <>
      <dt className={labelClassName}>{stat.label}</dt>
      <dd className={valueClassName}>{stat.value}</dd>
      {stat.detail ? <span className={detailClassName}>{stat.detail}</span> : null}
    </>
  );
}

export function DatasetPreviewCard({
  dataset,
  view,
  className,
  headerClassName,
  titleClassName,
  descriptionClassName,
  badgeListClassName,
  badgeClassName,
  statListClassName,
  statClassName,
  statLabelClassName,
  statValueClassName,
  statDetailClassName,
  empty,
  renderBadge,
  renderStat,
}: DatasetPreviewCardProps) {
  const preview = view ?? buildDatasetPreview(dataset);
  if (!preview) return empty == null ? null : <>{empty}</>;

  return (
    <article className={className} data-dataset-id={preview.id ?? undefined}>
      <header className={headerClassName}>
        <strong className={titleClassName}>{preview.title}</strong>
        {preview.description ? (
          <p className={descriptionClassName}>{preview.description}</p>
        ) : null}
      </header>

      {preview.badges.length > 0 ? (
        <div className={badgeListClassName}>
          {preview.badges.map((badge) => (
            <span className={resolveClassName(badgeClassName, badge)} key={badge.id}>
              {renderBadge ? renderBadge(badge) : badge.label}
            </span>
          ))}
        </div>
      ) : null}

      {preview.stats.length > 0 ? (
        <dl className={statListClassName}>
          {preview.stats.map((stat) => (
            <div className={resolveClassName(statClassName, stat)} key={stat.id}>
              {renderStat
                ? renderStat(stat)
                : defaultStatNode(stat, statLabelClassName, statValueClassName, statDetailClassName)}
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

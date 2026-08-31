import type { ReactNode } from "react";

export interface DatasetResultCardProps {
  title: string;
  description?: string;
  taskLabel?: string;
  bestScore?: { metric: string; value: string };
  model?: string;
  sampleCount?: number;
  featureCount?: number;
  tags?: readonly string[];
  status?: string;
  renderTag?: (tag: string) => ReactNode;
  className?: string;
  headerClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  taskClassName?: string;
  scoreClassName?: string;
  modelClassName?: string;
  statListClassName?: string;
  statClassName?: string;
  statLabelClassName?: string;
  statValueClassName?: string;
  tagListClassName?: string;
  tagClassName?: string;
  statusClassName?: string;
  empty?: ReactNode;
}

export function DatasetResultCard({
  title,
  description,
  taskLabel,
  bestScore,
  model,
  sampleCount,
  featureCount,
  tags,
  status,
  renderTag,
  className,
  headerClassName,
  titleClassName,
  descriptionClassName,
  taskClassName,
  scoreClassName,
  modelClassName,
  statListClassName,
  statClassName,
  statLabelClassName,
  statValueClassName,
  tagListClassName,
  tagClassName,
  statusClassName,
  empty,
}: DatasetResultCardProps) {
  if (!title) return empty == null ? null : <>{empty}</>;

  const tagList = tags ?? [];
  const hasStats = sampleCount != null || featureCount != null;

  return (
    <article className={className} data-status={status}>
      <header className={headerClassName}>
        <strong className={titleClassName}>{title}</strong>
        {taskLabel ? <span className={taskClassName}>{taskLabel}</span> : null}
        {status ? <span className={statusClassName}>{status}</span> : null}
      </header>

      {description ? <p className={descriptionClassName}>{description}</p> : null}

      {bestScore ? (
        <span className={scoreClassName}>
          {bestScore.metric} {bestScore.value}
        </span>
      ) : null}

      {model ? <span className={modelClassName}>{model}</span> : null}

      {hasStats ? (
        <dl className={statListClassName}>
          {sampleCount != null ? (
            <div className={statClassName}>
              <dt className={statLabelClassName}>Samples</dt>
              <dd className={statValueClassName}>{sampleCount}</dd>
            </div>
          ) : null}
          {featureCount != null ? (
            <div className={statClassName}>
              <dt className={statLabelClassName}>Features</dt>
              <dd className={statValueClassName}>{featureCount}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {tagList.length > 0 ? (
        <div className={tagListClassName}>
          {tagList.map((tag) => (
            <span className={tagClassName} key={tag}>
              {renderTag ? renderTag(tag) : tag}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}

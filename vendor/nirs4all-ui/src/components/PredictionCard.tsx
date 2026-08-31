import type { ReactNode } from "react";

export interface PredictionCardProps {
  sampleId: string;
  predicted: number | string;
  unit?: string;
  interval?: string;
  targetLabel?: string;
  meta?: readonly { label: string; value: string }[];
  formatValue?: (value: number | string) => ReactNode;
  children?: ReactNode;
  className?: string;
  headerClassName?: string;
  sampleIdClassName?: string;
  targetClassName?: string;
  valueClassName?: string;
  unitClassName?: string;
  intervalClassName?: string;
  metaListClassName?: string;
  metaRowClassName?: string;
  metaLabelClassName?: string;
  metaValueClassName?: string;
}

export function PredictionCard({
  sampleId,
  predicted,
  unit,
  interval,
  targetLabel,
  meta,
  formatValue,
  children,
  className,
  headerClassName,
  sampleIdClassName,
  targetClassName,
  valueClassName,
  unitClassName,
  intervalClassName,
  metaListClassName,
  metaRowClassName,
  metaLabelClassName,
  metaValueClassName,
}: PredictionCardProps) {
  const rows = meta ?? [];

  return (
    <article className={className} data-sample-id={sampleId}>
      <header className={headerClassName}>
        <span className={sampleIdClassName}>{sampleId}</span>
        {targetLabel ? <span className={targetClassName}>{targetLabel}</span> : null}
      </header>

      <p>
        <strong className={valueClassName}>
          {formatValue ? formatValue(predicted) : predicted}
        </strong>
        {unit ? <span className={unitClassName}>{unit}</span> : null}
        {interval ? <span className={intervalClassName}>{interval}</span> : null}
      </p>

      {rows.length > 0 ? (
        <dl className={metaListClassName}>
          {rows.map((row) => (
            <div className={metaRowClassName} key={row.label}>
              <dt className={metaLabelClassName}>{row.label}</dt>
              <dd className={metaValueClassName}>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {children}
    </article>
  );
}

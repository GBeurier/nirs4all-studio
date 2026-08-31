import type { ReactNode } from "react";

export interface PerClassRow {
  label: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface PerClassTableProps {
  rows: readonly PerClassRow[];
  headers?: {
    class?: string;
    precision?: string;
    recall?: string;
    f1?: string;
    support?: string;
  };
  valueFormat?: (value: number) => string;
  className?: string;
  theadClassName?: string;
  rowClassName?: string;
  cellClassName?: string;
  labelCellClassName?: string;
  empty?: ReactNode;
}

export function PerClassTable({
  rows,
  headers,
  valueFormat,
  className,
  theadClassName,
  rowClassName,
  cellClassName,
  labelCellClassName,
  empty,
}: PerClassTableProps) {
  if (rows.length === 0) return empty == null ? null : <>{empty}</>;

  const formatRate = valueFormat ?? ((value: number) => value.toFixed(3));
  const formatSupport = valueFormat ?? ((value: number) => String(Math.round(value)));

  return (
    <table className={className}>
      {headers ? (
        <thead className={theadClassName}>
          <tr>
            <th className={labelCellClassName}>{headers.class ?? "Class"}</th>
            <th className={cellClassName}>{headers.precision ?? "Precision"}</th>
            <th className={cellClassName}>{headers.recall ?? "Recall"}</th>
            <th className={cellClassName}>{headers.f1 ?? "F1"}</th>
            <th className={cellClassName}>{headers.support ?? "Support"}</th>
          </tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row) => (
          <tr className={rowClassName} data-class={row.label} key={row.label}>
            <th className={labelCellClassName} scope="row">{row.label}</th>
            <td className={cellClassName}>{formatRate(row.precision)}</td>
            <td className={cellClassName}>{formatRate(row.recall)}</td>
            <td className={cellClassName}>{formatRate(row.f1)}</td>
            <td className={cellClassName}>{formatSupport(row.support)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

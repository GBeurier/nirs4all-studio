import type { ReactNode } from "react";

export interface RankingRow {
  rank: number;
  name: string;
  score: string;
  detail?: string;
  highlight?: boolean;
}

export interface RankingsTableProps {
  rows: readonly RankingRow[];
  metricLabel?: string;
  headers?: { rank?: string; name?: string; detail?: string };
  className?: string;
  theadClassName?: string;
  rowClassName?: string;
  highlightRowClassName?: string;
  cellClassName?: string;
  rankClassName?: string;
  nameClassName?: string;
  scoreClassName?: string;
  empty?: ReactNode;
}

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  const resolved = classNames.filter(Boolean);
  return resolved.length > 0 ? resolved.join(" ") : undefined;
}

export function RankingsTable({
  rows,
  metricLabel = "Score",
  headers,
  className,
  theadClassName,
  rowClassName,
  highlightRowClassName,
  cellClassName,
  rankClassName,
  nameClassName,
  scoreClassName,
  empty,
}: RankingsTableProps) {
  if (rows.length === 0) return empty == null ? null : <>{empty}</>;

  const hasDetail = rows.some((row) => row.detail != null);

  return (
    <table className={className}>
      <thead className={theadClassName}>
        <tr>
          <th className={rankClassName}>{headers?.rank ?? "#"}</th>
          <th className={nameClassName}>{headers?.name ?? "Name"}</th>
          <th className={scoreClassName}>{metricLabel}</th>
          {hasDetail ? <th className={cellClassName}>{headers?.detail ?? "Detail"}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr
            className={row.highlight
              ? joinClassNames(rowClassName, highlightRowClassName)
              : rowClassName}
            data-highlight={row.highlight ? "true" : undefined}
            key={`${row.rank}-${row.name}`}
          >
            <td className={rankClassName}>{row.rank}</td>
            <th className={nameClassName} scope="row">{row.name}</th>
            <td className={scoreClassName}>{row.score}</td>
            {hasDetail ? <td className={cellClassName}>{row.detail}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

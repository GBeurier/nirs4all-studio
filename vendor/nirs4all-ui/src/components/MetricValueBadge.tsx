import {
  formatMetricDisplayName,
  formatMetricValue,
  getMetricDefinition,
  isBetterScore,
  parseScoreNumber,
} from "../score/index.js";

export interface MetricValueBadgeProps {
  metric?: string | null;
  value?: number | string | null;
  compareTo?: number | string | null;
  label?: string | null;
  className?: string;
  metricClassName?: string;
  valueClassName?: string;
  directionClassName?: string;
  betterClassName?: string;
  worseClassName?: string;
  equalClassName?: string;
  title?: string;
  showDirection?: boolean;
}

type MetricValueComparison = "better" | "worse" | "equal";

function resolveComparison(
  value: number | string | null | undefined,
  compareTo: number | string | null | undefined,
  metric: string | null | undefined,
): MetricValueComparison | null {
  const parsedValue = parseScoreNumber(value);
  const parsedComparison = parseScoreNumber(compareTo);
  if (parsedValue == null || parsedComparison == null) return null;
  if (parsedValue === parsedComparison) return "equal";
  return isBetterScore(parsedValue, parsedComparison, metric) ? "better" : "worse";
}

function joinClassNames(...classNames: Array<string | undefined>): string | undefined {
  const resolved = classNames.filter(Boolean);
  return resolved.length > 0 ? resolved.join(" ") : undefined;
}

export function MetricValueBadge({
  metric,
  value,
  compareTo,
  label,
  className,
  metricClassName,
  valueClassName,
  directionClassName,
  betterClassName,
  worseClassName,
  equalClassName,
  title,
  showDirection = true,
}: MetricValueBadgeProps) {
  const definition = getMetricDefinition(metric);
  const displayLabel = label ?? definition?.abbreviation ?? formatMetricDisplayName(metric);
  const comparison = resolveComparison(value, compareTo, metric);
  const comparisonClassName = comparison === "better"
    ? betterClassName
    : comparison === "worse"
      ? worseClassName
      : comparison === "equal"
        ? equalClassName
        : undefined;

  return (
    <span
      className={joinClassNames(className, comparisonClassName)}
      data-metric={definition?.key ?? metric ?? undefined}
      title={title}
    >
      <span className={metricClassName}>{displayLabel}</span>
      <strong className={valueClassName}>{formatMetricValue(value, metric ?? undefined)}</strong>
      {showDirection && comparison ? (
        <span className={directionClassName}>{comparison}</span>
      ) : null}
    </span>
  );
}

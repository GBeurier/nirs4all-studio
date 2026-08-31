import type { ReactNode } from "react";

export interface ScoreCardMetric {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}

export interface ScoreCardNode {
  id: string;
  label: string;
  kind?: string;
  metrics?: readonly ScoreCardMetric[];
  children?: readonly ScoreCardNode[];
}

export interface ScoreCardTreeProps {
  nodes: readonly ScoreCardNode[];
  defaultOpen?: boolean;
  renderMetric?: (metric: ScoreCardMetric) => ReactNode;
  className?: string;
  nodeClassName?: string;
  summaryClassName?: string;
  labelClassName?: string;
  kindClassName?: string;
  metricsClassName?: string;
  metricClassName?: string;
  metricLabelClassName?: string;
  metricValueClassName?: string;
  childrenClassName?: string;
  empty?: ReactNode;
}

export function ScoreCardTree({
  nodes,
  defaultOpen = true,
  renderMetric,
  className,
  nodeClassName,
  summaryClassName,
  labelClassName,
  kindClassName,
  metricsClassName,
  metricClassName,
  metricLabelClassName,
  metricValueClassName,
  childrenClassName,
  empty,
}: ScoreCardTreeProps) {
  if (nodes.length === 0) return empty == null ? null : <>{empty}</>;

  function renderMetrics(metrics: readonly ScoreCardMetric[]) {
    if (metrics.length === 0) return null;
    return (
      <span className={metricsClassName}>
        {metrics.map((metric) => (
          <span className={metricClassName} data-tone={metric.tone} key={metric.label}>
            {renderMetric ? renderMetric(metric) : (
              <>
                <span className={metricLabelClassName}>{metric.label}</span>
                <span className={metricValueClassName}>{metric.value}</span>
              </>
            )}
          </span>
        ))}
      </span>
    );
  }

  function renderNode(node: ScoreCardNode) {
    const metrics = node.metrics ?? [];
    const children = node.children ?? [];
    return (
      <details className={nodeClassName} data-kind={node.kind} key={node.id} open={defaultOpen}>
        <summary className={summaryClassName}>
          <span className={labelClassName}>{node.label}</span>
          {node.kind ? <span className={kindClassName}>{node.kind}</span> : null}
          {renderMetrics(metrics)}
        </summary>
        {children.length > 0 ? (
          <div className={childrenClassName}>{children.map(renderNode)}</div>
        ) : null}
      </details>
    );
  }

  return <div className={className}>{nodes.map(renderNode)}</div>;
}

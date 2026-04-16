/**
 * HeroMetrics — primary verdict strip above the chart section.
 *
 * Surfaces CV + refit scores as large tabular-nums digits so the reader
 * gets the "how did this chain score" answer before scrolling.
 */

import { cn } from "@/lib/utils";

interface HeroMetricsProps {
  cvVal: number | null | undefined;
  cvTest: number | null | undefined;
  cvTrain: number | null | undefined;
  foldCount: number | null | undefined;
  finalTest: number | null | undefined;
  metric: string;
}

function formatScore(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1000 || (abs < 0.01 && abs > 0)) return value.toExponential(1);
  return value.toFixed(4);
}

interface CardProps {
  label: string;
  value: string;
  accent?: "primary" | "success" | "muted";
  hint?: string;
}

function MetricCard({ label, value, accent = "muted", hint }: CardProps) {
  const valueColor =
    accent === "primary"
      ? "text-primary"
      : accent === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-foreground";
  const ring =
    accent === "primary"
      ? "ring-primary/25 shadow-[0_1px_0_hsl(var(--primary)/0.15)_inset]"
      : accent === "success"
      ? "ring-emerald-500/25"
      : "ring-border";
  return (
    <div
      className={cn(
        "min-w-0 rounded-lg border bg-card px-3 py-2.5 ring-1",
        ring,
      )}
    >
      <div className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular-nums leading-none",
          valueColor,
        )}
      >
        {value}
      </div>
      {hint && (
        <div className="mt-1 truncate text-[10px] text-muted-foreground">{hint}</div>
      )}
    </div>
  );
}

export function HeroMetrics({
  cvVal,
  cvTest,
  cvTrain,
  foldCount,
  finalTest,
  metric,
}: HeroMetricsProps) {
  const hasFinal = finalTest != null;
  return (
    <div
      className={cn(
        "grid gap-2",
        hasFinal ? "grid-cols-2 md:grid-cols-5" : "grid-cols-2 md:grid-cols-4",
      )}
    >
      <MetricCard label={`CV Val · ${metric}`} value={formatScore(cvVal)} accent="primary" />
      <MetricCard label="CV Test" value={formatScore(cvTest)} />
      <MetricCard label="CV Train" value={formatScore(cvTrain)} />
      {hasFinal && (
        <MetricCard label="Refit Test" value={formatScore(finalTest)} accent="success" />
      )}
      <MetricCard
        label="Folds"
        value={foldCount != null ? String(foldCount) : "—"}
        hint={foldCount === 1 ? "single fit" : undefined}
      />
    </div>
  );
}

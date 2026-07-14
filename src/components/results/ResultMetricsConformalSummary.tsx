import {
  FileSpreadsheet,
  Ruler,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  exportRowsCsv,
  sanitizeFilename,
} from "@/components/predictions/viewer/export";
import type {
  ConformalCoverageOption,
  ConformalCoverageStripSegment,
  ConformalCoverageStripTone,
  ConformalGuaranteeTone,
  ConformalMetricRow,
} from "@/ui/conformal";
import type { ResultConformalSummaryData } from "./resultDetailData";

interface ResultMetricsConformalSummaryProps {
  summary: ResultConformalSummaryData | null;
}

interface ConformalMetricCsvRow {
  coverage: number;
  coverage_gap: number;
  coverage_gap_direction: string;
  mean_interval_score: number;
  mean_width: number;
  median_width: number;
  n_covered: number;
  n_missed_above: number;
  n_missed_below: number;
  n_samples: number;
  observed_coverage: number;
  unit: string;
}

export const CONFORMAL_METRIC_CSV_COLUMNS: (keyof ConformalMetricCsvRow)[] = [
  "coverage",
  "observed_coverage",
  "coverage_gap",
  "coverage_gap_direction",
  "mean_width",
  "median_width",
  "mean_interval_score",
  "n_covered",
  "n_samples",
  "n_missed_below",
  "n_missed_above",
  "unit",
];

const guaranteeBadgeVariant: Record<ConformalGuaranteeTone, "default" | "secondary" | "destructive" | "outline"> = {
  success: "default",
  error: "destructive",
  muted: "outline",
};

function formatFingerprint(fingerprint: string | null): string {
  if (!fingerprint) return "No fingerprint";
  return fingerprint.length > 24
    ? `${fingerprint.slice(0, 12)}…${fingerprint.slice(-8)}`
    : fingerprint;
}

function coverageOptionVariant(option: ConformalCoverageOption): "default" | "secondary" | "outline" {
  if (option.selected) return "default";
  if (option.materialized) return "secondary";
  return "outline";
}

function coverageOptionLabel(option: ConformalCoverageOption): string {
  const flags = [
    option.selected ? "selected" : null,
    option.calibrated ? "calibrated" : null,
    option.materialized ? "materialized" : "not materialized",
  ].filter(Boolean);
  return `${option.label} · ${flags.join(", ")}`;
}

export function buildConformalMetricCsvRows(summary: ResultConformalSummaryData): ConformalMetricCsvRow[] {
  return summary.metrics.map(row => ({
    coverage: row.coverage,
    coverage_gap: row.coverageGap,
    coverage_gap_direction: row.coverageGapDirection,
    mean_interval_score: row.meanIntervalScore,
    mean_width: row.meanWidth,
    median_width: row.medianWidth,
    n_covered: row.nCovered,
    n_missed_above: row.missedAbove,
    n_missed_below: row.missedBelow,
    n_samples: row.nSamples,
    observed_coverage: row.observedCoverage,
    unit: row.unit,
  }));
}

export function buildConformalMetricCsvFilename(summary: ResultConformalSummaryData): string {
  return `conformal_${sanitizeFilename(summary.fingerprint ?? "metrics")}_coverage_metrics.csv`;
}

const coverageStripToneClass: Record<ConformalCoverageStripTone, string> = {
  calibrated: "border-blue-500/35 bg-blue-500/15 text-blue-950 dark:text-blue-100",
  materialized: "border-primary/35 bg-primary/15 text-primary",
  selected: "border-emerald-500/45 bg-emerald-500/20 text-emerald-950 dark:text-emerald-100",
  unavailable: "border-dashed border-border/60 bg-muted/10 text-muted-foreground",
};

const coverageGapBadgeVariant: Record<ConformalMetricRow["coverageGapDirection"], "default" | "secondary" | "destructive"> = {
  exact: "default",
  over: "secondary",
  under: "destructive",
};

function ConformalCoverageStrip({ segments }: { segments: ConformalCoverageStripSegment[] }) {
  if (segments.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Coverage strip</p>
          <p className="text-[11px] text-muted-foreground">
            Visual projection of calibrated, selected, and materialized coverages.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {segments.length} coverage{segments.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="relative mb-2 h-2 rounded-full bg-muted">
        {segments.map(segment => (
          <span
            key={segment.coverage}
            className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-foreground shadow-sm"
            style={{ left: `${segment.positionPercent}%` }}
            title={`${segment.coverageLabel} · ${segment.tone}`}
          />
        ))}
      </div>

      <div className="grid gap-1 sm:grid-cols-2">
        {segments.map(segment => (
          <div
            key={`${segment.coverage}-detail`}
            className={`rounded border px-2 py-1 text-[11px] ${coverageStripToneClass[segment.tone]}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{segment.coverageLabel}</span>
              <span>{segment.tone}</span>
            </div>
            <p className="text-muted-foreground">
              qhat {segment.qhatLabel ?? "—"} · mean width {segment.meanWidthLabel ?? "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConformalMetricTable({ rows }: { rows: ConformalMetricRow[] }) {
  if (rows.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-border/60 bg-muted/10 p-2.5">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-foreground">Coverage metrics</p>
          <p className="text-[11px] text-muted-foreground">
            Attached conformal metric sets; Studio displays them without recomputing observed coverage or interval scores.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {rows.length} coverage{rows.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          <div className="grid grid-cols-6 gap-1 border-b border-border/60 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            <span>Coverage</span>
            <span>Observed</span>
            <span>Gap</span>
            <span>Mean width</span>
            <span>Interval score</span>
            <span>Misses</span>
          </div>
          <div className="divide-y divide-border/50">
            {rows.map(row => (
              <div
                key={`${row.coverage}-${row.unit}-${row.nSamples}`}
                className="grid grid-cols-6 items-center gap-1 py-1.5 text-[11px]"
              >
                <span className="font-medium text-foreground">{row.coverageLabel}</span>
                <span>{row.observedCoverageLabel}</span>
                <Badge variant={coverageGapBadgeVariant[row.coverageGapDirection]} className="w-fit text-[10px]">
                  {row.coverageGapLabel}
                </Badge>
                <span>{row.meanWidthLabel}</span>
                <span>{row.meanIntervalScoreLabel}</span>
                <span className="text-muted-foreground">
                  {row.missedBelow} below · {row.missedAbove} above · {row.nCovered}/{row.nSamples} covered
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResultMetricsConformalSummary({ summary }: ResultMetricsConformalSummaryProps) {
  if (!summary) return null;

  const handleExportMetrics = () => {
    exportRowsCsv(
      buildConformalMetricCsvRows(summary),
      CONFORMAL_METRIC_CSV_COLUMNS,
      buildConformalMetricCsvFilename(summary),
    );
  };

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h4 className="flex items-center gap-2 text-sm font-medium">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            Conformal prediction
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {summary.method} · {summary.unit} · {summary.nPredictions} predictions
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
          {summary.metrics.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={handleExportMetrics}
            >
              <FileSpreadsheet className="h-3 w-3" />
              Metrics CSV
            </Button>
          )}
          <Badge variant={guaranteeBadgeVariant[summary.guarantee.tone]} className="text-[10px]">
            {summary.guarantee.label}
          </Badge>
          {summary.guarantee.coverageLabel !== "—" && (
            <Badge variant="outline" className="text-[10px]">
              {summary.guarantee.coverageLabel}
            </Badge>
          )}
          {summary.guarantee.effectiveEngine !== "unknown" && (
            <Badge variant="outline" className="max-w-48 break-all text-[10px]">
              {summary.guarantee.effectiveEngine}
            </Badge>
          )}
        </div>
      </div>

      <ConformalCoverageStrip segments={summary.coverageStrip} />

      <ConformalMetricTable rows={summary.metrics} />

      <div className="mb-3 flex flex-wrap gap-1.5">
        {summary.coverages.map(option => (
          <Badge
            key={option.coverage}
            variant={coverageOptionVariant(option)}
            className={option.disabled ? "text-[10px] opacity-60" : "text-[10px]"}
          >
            {coverageOptionLabel(option)}
          </Badge>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        {summary.intervals.map(interval => (
          <div key={interval.coverage} className="rounded border border-border/50 bg-background/60 px-2 py-1">
            <span className="text-muted-foreground">{interval.coverageLabel} interval</span>
            <div className="font-medium text-foreground">
              qhat {interval.qhatLabel} · mean width {interval.meanWidthLabel}
            </div>
            <p className="text-muted-foreground">{interval.nSamples} samples</p>
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{summary.guarantee.scope}</span>
        {summary.guarantee.requestedEngine !== "unknown" && summary.guarantee.requestedEngine !== summary.guarantee.effectiveEngine && (
          <Badge variant="outline" className="text-[10px]">
            requested engine: {summary.guarantee.requestedEngine}
          </Badge>
        )}
        {summary.guarantee.calibrationReplaySource && (
          <Badge variant="outline" className="text-[10px]">
            calibration replay: {summary.guarantee.calibrationReplayLabel}
          </Badge>
        )}
        {summary.guarantee.tuningCalibrationSource && (
          <Badge variant="outline" className="text-[10px]">
            tuning calibration: {summary.guarantee.tuningCalibrationLabel}
          </Badge>
        )}
        <Badge variant="outline" className="max-w-48 break-all text-[10px]">
          {formatFingerprint(summary.fingerprint)}
        </Badge>
      </div>

      {summary.guarantee.invalidationReasons.length > 0 && (
        <p className="mt-2 break-words text-[11px] text-destructive">
          Invalidated: {summary.guarantee.invalidationReasons.join(", ")}
        </p>
      )}
      {summary.guarantee.limitations.length > 0 && (
        <p className="mt-2 break-words text-[11px] text-muted-foreground">
          Limitations: {summary.guarantee.limitations.join("; ")}
        </p>
      )}
    </div>
  );
}

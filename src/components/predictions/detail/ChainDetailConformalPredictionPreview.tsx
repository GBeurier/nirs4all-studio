import { useEffect, useMemo, useState } from "react";
import { Ruler } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChainDetailConformalSummary } from "./useChainDetailPanelState";

interface ChainDetailConformalPredictionPreviewProps {
  maxRows?: number;
  onSelectedCoverageChange?: (coverage: number) => void;
  selectedCoverage?: number | null;
  summary: ChainDetailConformalSummary | null;
}

export function ChainDetailConformalPredictionPreview({
  maxRows = 5,
  onSelectedCoverageChange,
  selectedCoverage,
  summary,
}: ChainDetailConformalPredictionPreviewProps) {
  const defaultCoverage = useMemo(() => resolveDefaultCoverage(summary), [summary]);
  const [localSelectedCoverage, setLocalSelectedCoverage] = useState<number | null>(defaultCoverage);

  useEffect(() => {
    setLocalSelectedCoverage(defaultCoverage);
  }, [defaultCoverage]);

  if (!summary || summary.rows.length === 0) return null;

  const activeCoverage = selectedCoverage ?? localSelectedCoverage;
  const rows = summary.rows.slice(0, maxRows);
  const remainingRows = Math.max(0, summary.rows.length - rows.length);
  const selectedCoverageLabel = summary.coverages.find(option => option.coverage === activeCoverage)?.label;

  function handleCoverageChange(coverage: number): void {
    setLocalSelectedCoverage(coverage);
    onSelectedCoverageChange?.(coverage);
  }

  return (
    <div className="rounded-2xl border border-border/70 bg-card/60 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            Calibrated prediction preview
          </div>
          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
            Materialized prediction intervals from the attached calibrated result. Studio displays these bounds as produced by nirs4all and does not recompute coverage.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px]">
          {summary.rows.length} rows
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <Badge variant={summary.guarantee.tone === "error" ? "destructive" : "outline"} className="text-[10px]">
          {summary.guarantee.label}
        </Badge>
        <span>{summary.guarantee.scope}</span>
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
      </div>

      {summary.coverages.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] text-muted-foreground">Coverage</span>
          {summary.coverages.map(option => (
            <button
              key={option.coverage}
              type="button"
              className={[
                "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                option.coverage === activeCoverage
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
                option.disabled ? "cursor-not-allowed opacity-50 hover:bg-background" : "",
              ].join(" ")}
              disabled={option.disabled}
              onClick={() => handleCoverageChange(option.coverage)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-border/60">
        <div className="grid grid-cols-[minmax(90px,0.8fr)_minmax(80px,0.6fr)_minmax(0,1.8fr)] gap-2 border-b border-border/60 bg-muted/40 px-3 py-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
          <span>Sample</span>
          <span>Prediction</span>
          <span>{selectedCoverageLabel ? `${selectedCoverageLabel} interval` : "Intervals"}</span>
        </div>
        <div className="divide-y divide-border/60">
          {rows.map(row => (
            <div
              key={`${row.index}:${row.sampleId ?? "sample"}`}
              className="grid grid-cols-[minmax(90px,0.8fr)_minmax(80px,0.6fr)_minmax(0,1.8fr)] gap-2 px-3 py-2 text-xs"
            >
              <span className="truncate text-muted-foreground">
                {row.sampleId ?? `#${row.index + 1}`}
              </span>
              <span className="font-mono font-medium">{row.yPredLabel}</span>
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {row.intervals
                  .filter(interval => activeCoverage === null || interval.coverage === activeCoverage)
                  .map(interval => (
                  <Badge
                    key={`${row.index}:${interval.coverage}`}
                    variant="secondary"
                    className="max-w-full truncate text-[10px]"
                  >
                    {interval.coverageLabel}: {interval.lowerLabel}–{interval.upperLabel}
                  </Badge>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>

      {remainingRows > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Showing {rows.length} of {summary.rows.length} calibrated prediction rows. Full-table pagination belongs to the dedicated prediction viewer.
        </p>
      )}
    </div>
  );
}

function resolveDefaultCoverage(summary: ChainDetailConformalSummary | null): number | null {
  if (!summary) return null;
  return summary.coverages.find(option => option.selected && option.materialized)?.coverage
    ?? summary.coverages.find(option => option.materialized)?.coverage
    ?? summary.rows[0]?.intervals[0]?.coverage
    ?? null;
}
